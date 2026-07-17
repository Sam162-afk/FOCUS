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


def _build_app(tmp_path, **overrides):
    defaults = dict(
        webapp_dir=WEBAPP_DIR,
        shots_log_path=str(tmp_path / "shots_log.jsonl"),
        mat_state_path=str(tmp_path / "mat_state.json"),
        mat_width_mm=1000.0,
        mat_height_mm=1500.0,
        canvas_width=1920,
        canvas_height=1080,
        calibration_path=str(tmp_path / "projector_calibration.json"),
        config_file_path=str(tmp_path / "config.json"),
    )
    defaults.update(overrides)
    return build_app(**defaults)


def test_config_endpoint_reports_mat_and_canvas_size(tmp_path):
    async def scenario():
        app = _build_app(tmp_path, mat_width_mm=1234.0, mat_height_mm=5678.0, canvas_width=800, canvas_height=600)
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
    assert data["stats"] is None


def test_config_endpoint_includes_css_matrix_when_calibration_exists(tmp_path):
    calibration_path = str(tmp_path / "calibration.json")
    ProjectorCalibration(
        canvas_size=(800, 600),
        projector_corners=[(100, 80), (700, 60), (760, 620), (90, 640)],
    ).save(calibration_path)

    async def scenario():
        app = _build_app(tmp_path, canvas_width=800, canvas_height=600, calibration_path=calibration_path)
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
        app = _build_app(tmp_path)
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


def test_setup_html_is_served_as_a_static_file(tmp_path):
    async def scenario():
        app = _build_app(tmp_path)
        runner, port = await _start(app)
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.get(f"http://127.0.0.1:{port}/setup.html")
                text = await resp.text()
        finally:
            await runner.cleanup()
        return resp.status, text

    status, text = asyncio.run(scenario())
    assert status == 200
    assert "FOCUS Clone Setup" in text


def test_websocket_broadcasts_new_shots_and_mat_state(tmp_path):
    shots_log_path = str(tmp_path / "shots_log.jsonl")
    mat_state_path = str(tmp_path / "mat_state.json")

    async def scenario():
        app = _build_app(tmp_path, shots_log_path=shots_log_path, mat_state_path=mat_state_path)
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


def test_setup_post_persists_config_and_updates_live_config(tmp_path):
    config_file_path = str(tmp_path / "config.json")

    async def scenario():
        app = _build_app(tmp_path, config_file_path=config_file_path)
        runner, port = await _start(app)
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.post(
                    f"http://127.0.0.1:{port}/api/setup",
                    json={
                        "matWidthMm": 1100,
                        "matHeightMm": 1600,
                        "canvasWidth": 1920,
                        "canvasHeight": 1080,
                        "stats": ["clubPath", "carryDistance"],
                        "projectorCorners": None,
                    },
                )
                post_status = resp.status
                post_body = await resp.json()

                config_resp = await session.get(f"http://127.0.0.1:{port}/api/config")
                config_after = await config_resp.json()
        finally:
            await runner.cleanup()
        return post_status, post_body, config_after

    post_status, post_body, config_after = asyncio.run(scenario())

    assert post_status == 200
    assert post_body == {"ok": True}
    assert config_after["matWidthMm"] == 1100
    assert config_after["matHeightMm"] == 1600
    assert config_after["stats"] == ["clubPath", "carryDistance"]

    with open(config_file_path) as f:
        saved = json.load(f)
    assert saved["matWidthMm"] == 1100
    assert saved["stats"] == ["clubPath", "carryDistance"]


def test_setup_post_with_projector_corners_saves_calibration_file(tmp_path):
    calibration_path = str(tmp_path / "projector_calibration.json")

    async def scenario():
        app = _build_app(tmp_path, calibration_path=calibration_path)
        runner, port = await _start(app)
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.post(
                    f"http://127.0.0.1:{port}/api/setup",
                    json={
                        "matWidthMm": 1000,
                        "matHeightMm": 1500,
                        "canvasWidth": 1920,
                        "canvasHeight": 1080,
                        "stats": ["clubPath"],
                        "projectorCorners": [[50, 40], [1870, 30], [1900, 1060], [30, 1050]],
                    },
                )
                status = resp.status
                config_resp = await session.get(f"http://127.0.0.1:{port}/api/config")
                config_after = await config_resp.json()
        finally:
            await runner.cleanup()
        return status, config_after

    status, config_after = asyncio.run(scenario())

    assert status == 200
    assert config_after["cssMatrix3d"] is not None
    assert os.path.exists(calibration_path)

    calibration = ProjectorCalibration.load(calibration_path)
    assert calibration.canvas_size == (1920, 1080)
    assert len(calibration.projector_corners) == 4


def test_setup_post_rejects_invalid_mat_size(tmp_path):
    async def scenario():
        app = _build_app(tmp_path)
        runner, port = await _start(app)
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.post(
                    f"http://127.0.0.1:{port}/api/setup",
                    json={"matWidthMm": -5, "matHeightMm": 1500, "stats": []},
                )
                status = resp.status
        finally:
            await runner.cleanup()
        return status

    status = asyncio.run(scenario())
    assert status == 400


def test_persisted_config_is_loaded_on_next_startup(tmp_path):
    config_file_path = str(tmp_path / "config.json")
    with open(config_file_path, "w") as f:
        json.dump({"matWidthMm": 900, "matHeightMm": 1400, "canvasWidth": 1920, "canvasHeight": 1080, "stats": ["hla"]}, f)

    async def scenario():
        app = _build_app(tmp_path, config_file_path=config_file_path, mat_width_mm=1000.0, mat_height_mm=1500.0)
        runner, port = await _start(app)
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.get(f"http://127.0.0.1:{port}/api/config")
                data = await resp.json()
        finally:
            await runner.cleanup()
        return data

    data = asyncio.run(scenario())
    assert data["matWidthMm"] == 900
    assert data["matHeightMm"] == 1400
    assert data["stats"] == ["hla"]
