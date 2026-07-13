import asyncio
import json
import os
import sys

import aiohttp
import pytest
from aiohttp import web

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bridge.server import build_app
from projector.calibration import ProjectorCalibration

WEBAPP_DIR = os.path.join(os.path.dirname(__file__), "..", "webapp")


async def _start(app):
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return runner, port


def test_config_endpoint_reports_mat_and_canvas_size(tmp_path):
    async def scenario():
        app = build_app(
            webapp_dir=WEBAPP_DIR,
            shots_log_path=str(tmp_path / "shots_log.jsonl"),
            mat_state_path=str(tmp_path / "mat_state.json"),
            mat_width_mm=1234.0,
            mat_height_mm=5678.0,
            canvas_width=800,
            canvas_height=600,
            calibration_path=str(tmp_path / "no_such_calibration.json"),
        )
        runner, port = await _start(app)
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.get(f"http://127.0.0.1:{port}/api/config")
                data = await resp.json()
        finally:
            await runner.cleanup()
        return data

    data = asyncio.run(scenario())
    assert data["matWidthMm"] == 1234.0
    assert data["matHeightMm"] == 5678.0
    assert data["canvasWidth"] == 800
    assert data["canvasHeight"] == 600
    assert data["cssMatrix3d"] is None


def test_config_endpoint_includes_css_matrix_when_calibration_exists(tmp_path):
    calibration_path = str(tmp_path / "calibration.json")
    ProjectorCalibration(
        canvas_size=(800, 600),
        projector_corners=[(100, 80), (700, 60), (760, 620), (90, 640)],
    ).save(calibration_path)

    async def scenario():
        app = build_app(
            webapp_dir=WEBAPP_DIR,
            shots_log_path=str(tmp_path / "shots_log.jsonl"),
            mat_state_path=str(tmp_path / "mat_state.json"),
            mat_width_mm=1000.0,
            mat_height_mm=1500.0,
            canvas_width=800,
            canvas_height=600,
            calibration_path=calibration_path,
        )
        runner, port = await _start(app)
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.get(f"http://127.0.0.1:{port}/api/config")
                data = await resp.json()
        finally:
            await runner.cleanup()
        return data

    data = asyncio.run(scenario())
    assert data["cssMatrix3d"] is not None
    assert data["cssMatrix3d"].startswith("matrix3d(")


def test_index_serves_the_kiosk_page(tmp_path):
    async def scenario():
        app = build_app(
            webapp_dir=WEBAPP_DIR,
            shots_log_path=str(tmp_path / "shots_log.jsonl"),
            mat_state_path=str(tmp_path / "mat_state.json"),
            mat_width_mm=1000.0,
            mat_height_mm=1500.0,
            canvas_width=1920,
            canvas_height=1080,
            calibration_path=str(tmp_path / "no_such_calibration.json"),
        )
        runner, port = await _start(app)
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.get(f"http://127.0.0.1:{port}/")
                text = await resp.text()
        finally:
            await runner.cleanup()
        return text

    text = asyncio.run(scenario())
    assert "FOCUS Clone" in text


def test_websocket_broadcasts_new_shots_and_mat_state(tmp_path):
    shots_log_path = str(tmp_path / "shots_log.jsonl")
    mat_state_path = str(tmp_path / "mat_state.json")

    async def scenario():
        app = build_app(
            webapp_dir=WEBAPP_DIR,
            shots_log_path=shots_log_path,
            mat_state_path=mat_state_path,
            mat_width_mm=1000.0,
            mat_height_mm=1500.0,
            canvas_width=1920,
            canvas_height=1080,
            calibration_path=str(tmp_path / "no_such_calibration.json"),
        )
        runner, port = await _start(app)
        try:
            async with aiohttp.ClientSession() as session:
                ws = await session.ws_connect(f"http://127.0.0.1:{port}/ws")

                # Give the tail tasks a moment to start polling, then append a shot.
                await asyncio.sleep(0.3)
                with open(shots_log_path, "a") as f:
                    f.write(json.dumps({"shot": {"ShotNumber": 1, "BallData": {"Speed": 148.5}}}) + "\n")

                shot_msg = json.loads(await asyncio.wait_for(ws.receive_str(), timeout=3))

                with open(mat_state_path, "w") as f:
                    json.dump({"calibrated": True, "feet_settled": True}, f)

                mat_msg = json.loads(await asyncio.wait_for(ws.receive_str(), timeout=3))

                await ws.close()
        finally:
            await runner.cleanup()
        return shot_msg, mat_msg

    shot_msg, mat_msg = asyncio.run(scenario())

    assert shot_msg["type"] == "shot"
    assert shot_msg["shot"]["ShotNumber"] == 1

    assert mat_msg["type"] == "mat_state"
    assert mat_msg["state"]["feet_settled"] is True
