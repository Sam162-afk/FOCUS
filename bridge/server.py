"""
Bridge server: the "Main App" / "Renderer bridge" from the architecture
diagram. Single aiohttp process that:

  - Serves the kiosk web app (webapp/) as static files.
  - Serves /api/config with mat dimensions, canvas size, and (if a
    projector calibration file exists) the CSS matrix3d keystone
    transform for the render stage.
  - Tails shots_log.jsonl (written by proxy/gspro_proxy.py) and
    mat_state.json (written by vision/mat_tracker.py) and broadcasts new
    shots / mat-tracking updates to every connected browser over a
    single /ws WebSocket endpoint.

This deliberately decouples the three processes (GSPro proxy, vision
tracker, renderer) via plain files rather than direct pipes, so each can
be developed, run, and restarted independently - matching the plan's
phased build order.

Run with:
    python3 -m bridge.server --shots-log shots_log.jsonl --mat-state-file mat_state.json
"""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from aiohttp import web, WSMsgType

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from projector.calibration import ProjectorCalibration  # noqa: E402

POLL_INTERVAL_SECONDS = 0.15

WEBAPP_DIR_KEY = web.AppKey("webapp_dir", Path)
SHOTS_LOG_PATH_KEY = web.AppKey("shots_log_path", str)
MAT_STATE_PATH_KEY = web.AppKey("mat_state_path", str)
CONFIG_FILE_PATH_KEY = web.AppKey("config_file_path", str)
CALIBRATION_PATH_KEY = web.AppKey("calibration_path", str)
WEBSOCKETS_KEY = web.AppKey("websockets", set)
CONFIG_KEY = web.AppKey("config", dict)
SHOTS_TASK_KEY = web.AppKey("shots_task", asyncio.Task)
MAT_STATE_TASK_KEY = web.AppKey("mat_state_task", asyncio.Task)


def load_persisted_config(config_path: str) -> dict:
    """Settings previously saved by the setup wizard (POST /api/setup), if any."""
    if not config_path or not os.path.exists(config_path):
        return {}
    try:
        with open(config_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def build_config(mat_width_mm: float, mat_height_mm: float, canvas_width: int, canvas_height: int, calibration_path: str, stats=None):
    config = {
        "matWidthMm": mat_width_mm,
        "matHeightMm": mat_height_mm,
        "canvasWidth": canvas_width,
        "canvasHeight": canvas_height,
        "stats": stats,
        "cssMatrix3d": None,
    }
    if calibration_path and os.path.exists(calibration_path):
        calibration = ProjectorCalibration.load(calibration_path)
        config["cssMatrix3d"] = calibration.to_css_matrix3d()
    return config


async def handle_index(request: web.Request):
    webapp_dir = request.app[WEBAPP_DIR_KEY]
    return web.FileResponse(webapp_dir / "index.html")


async def handle_config(request: web.Request):
    return web.json_response(request.app[CONFIG_KEY])


async def handle_setup(request: web.Request):
    """Persist settings from the setup wizard (webapp/setup.html) and apply them immediately."""
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid JSON body"}, status=400)

    mat_width_mm = payload.get("matWidthMm")
    mat_height_mm = payload.get("matHeightMm")
    if not (isinstance(mat_width_mm, (int, float)) and mat_width_mm > 0):
        return web.json_response({"error": "matWidthMm must be a positive number"}, status=400)
    if not (isinstance(mat_height_mm, (int, float)) and mat_height_mm > 0):
        return web.json_response({"error": "matHeightMm must be a positive number"}, status=400)

    current = request.app[CONFIG_KEY]
    canvas_width = payload.get("canvasWidth") or current["canvasWidth"]
    canvas_height = payload.get("canvasHeight") or current["canvasHeight"]
    stats = payload.get("stats")
    projector_corners = payload.get("projectorCorners")

    persisted = {
        "matWidthMm": mat_width_mm,
        "matHeightMm": mat_height_mm,
        "canvasWidth": canvas_width,
        "canvasHeight": canvas_height,
        "stats": stats,
    }
    with open(request.app[CONFIG_FILE_PATH_KEY], "w") as f:
        json.dump(persisted, f, indent=2)

    if projector_corners:
        if len(projector_corners) != 4:
            return web.json_response({"error": "projectorCorners must have exactly 4 points"}, status=400)
        calibration = ProjectorCalibration(
            canvas_size=(canvas_width, canvas_height),
            projector_corners=[tuple(p) for p in projector_corners],
        )
        calibration.save(request.app[CALIBRATION_PATH_KEY])

    new_config = build_config(
        mat_width_mm, mat_height_mm, canvas_width, canvas_height, request.app[CALIBRATION_PATH_KEY], stats
    )
    request.app[CONFIG_KEY].clear()
    request.app[CONFIG_KEY].update(new_config)
    return web.json_response({"ok": True})


async def handle_ws(request: web.Request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    request.app[WEBSOCKETS_KEY].add(ws)
    try:
        async for msg in ws:
            if msg.type == WSMsgType.ERROR:
                break
    finally:
        request.app[WEBSOCKETS_KEY].discard(ws)
    return ws


async def broadcast(app: web.Application, message: dict):
    payload = json.dumps(message)
    dead = set()
    for ws in app[WEBSOCKETS_KEY]:
        try:
            await ws.send_str(payload)
        except ConnectionResetError:
            dead.add(ws)
    app[WEBSOCKETS_KEY].difference_update(dead)


async def tail_shots_log(app: web.Application, path: str):
    """Poll a JSONL file for newly appended lines and broadcast each as a shot."""
    last_size = 0
    while path and os.path.exists(path):
        last_size = os.path.getsize(path)
        break

    while True:
        if path and os.path.exists(path):
            size = os.path.getsize(path)
            if size > last_size:
                with open(path) as f:
                    f.seek(last_size)
                    new_data = f.read()
                last_size = size
                for line in new_data.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    await broadcast(app, {"type": "shot", "shot": entry.get("shot", entry)})
            elif size < last_size:
                last_size = 0  # file was truncated/rotated
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def tail_mat_state(app: web.Application, path: str):
    """Poll mat_state.json (rewritten wholesale each frame) for changes and broadcast it."""
    last_mtime = None
    while True:
        if path and os.path.exists(path):
            mtime = os.path.getmtime(path)
            if mtime != last_mtime:
                last_mtime = mtime
                try:
                    with open(path) as f:
                        state = json.load(f)
                except (json.JSONDecodeError, OSError):
                    state = None
                if state is not None:
                    await broadcast(app, {"type": "mat_state", "state": state})
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def start_background_tasks(app: web.Application):
    app[SHOTS_TASK_KEY] = asyncio.create_task(tail_shots_log(app, app[SHOTS_LOG_PATH_KEY]))
    app[MAT_STATE_TASK_KEY] = asyncio.create_task(tail_mat_state(app, app[MAT_STATE_PATH_KEY]))


async def cleanup_background_tasks(app: web.Application):
    for key in (SHOTS_TASK_KEY, MAT_STATE_TASK_KEY):
        app[key].cancel()


def build_app(
    webapp_dir: str,
    shots_log_path: str,
    mat_state_path: str,
    mat_width_mm: float,
    mat_height_mm: float,
    canvas_width: int,
    canvas_height: int,
    calibration_path: str,
    config_file_path: str = "config.json",
) -> web.Application:
    # Settings previously saved via the setup wizard override the CLI/default
    # values, so restarting the bridge picks up whatever was last configured.
    persisted = load_persisted_config(config_file_path)
    mat_width_mm = persisted.get("matWidthMm", mat_width_mm)
    mat_height_mm = persisted.get("matHeightMm", mat_height_mm)
    canvas_width = persisted.get("canvasWidth", canvas_width)
    canvas_height = persisted.get("canvasHeight", canvas_height)
    stats = persisted.get("stats")

    app = web.Application()
    app[WEBAPP_DIR_KEY] = Path(webapp_dir)
    app[SHOTS_LOG_PATH_KEY] = shots_log_path
    app[MAT_STATE_PATH_KEY] = mat_state_path
    app[CONFIG_FILE_PATH_KEY] = config_file_path
    app[CALIBRATION_PATH_KEY] = calibration_path
    app[WEBSOCKETS_KEY] = set()
    app[CONFIG_KEY] = build_config(mat_width_mm, mat_height_mm, canvas_width, canvas_height, calibration_path, stats)

    app.router.add_get("/", handle_index)
    app.router.add_get("/api/config", handle_config)
    app.router.add_post("/api/setup", handle_setup)
    app.router.add_get("/ws", handle_ws)
    app.router.add_static("/", webapp_dir, name="static")

    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--webapp-dir", default=os.path.join(os.path.dirname(__file__), "..", "webapp"))
    parser.add_argument("--shots-log", default="shots_log.jsonl")
    parser.add_argument("--mat-state-file", default="mat_state.json")
    parser.add_argument("--projector-calibration", default="projector_calibration.json")
    parser.add_argument("--config-file", default="config.json", help="Settings saved by the setup wizard (webapp/setup.html)")
    parser.add_argument("--mat-width-mm", type=float, default=1000.0)
    parser.add_argument("--mat-height-mm", type=float, default=1500.0)
    parser.add_argument("--canvas-width", type=int, default=1920)
    parser.add_argument("--canvas-height", type=int, default=1080)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    app = build_app(
        webapp_dir=args.webapp_dir,
        shots_log_path=args.shots_log,
        mat_state_path=args.mat_state_file,
        mat_width_mm=args.mat_width_mm,
        mat_height_mm=args.mat_height_mm,
        canvas_width=args.canvas_width,
        canvas_height=args.canvas_height,
        calibration_path=args.projector_calibration,
        config_file_path=args.config_file,
    )
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
