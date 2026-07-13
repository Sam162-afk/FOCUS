# FOCUS Clone — DIY Floor Projection Impact Readout

A software system that turns a projector + webcam + GSPro/launch monitor
into a floor-projected impact readout, similar to Foresight's FOCUS
system, at a fraction of the hardware cost. See `docs/project-plan.md`
for the full architecture and phased build plan this follows.

## Status

All software components from the plan are implemented and covered by
automated tests (Python + Node + a real headless-browser check). What's
left is hardware-dependent: mounting a real camera/projector and
validating against real GSPro/Club Optix traffic. See the per-phase docs
below for details and exact next steps.

| Phase | What | Status | Docs |
|---|---|---|---|
| 0/1 | GSPro TCP data-tap proxy | Built + tested | `docs/phase0-data-tap.md` |
| 2 | ArUco mat tracking + foot detection | Built + tested (synthetic frames) | `docs/phase2-vision-tracking.md` |
| 3 | Projector keystone mapping | Built + tested (homography math) | `docs/phase3-projector-mapping.md` |
| 4 | Ball-flight/impact reconstruction | Built + tested (part of Phase 5's `animation.js`) | `docs/phase5-6-renderer-and-bridge.md` |
| 5 | Kiosk web renderer | Built + tested (Node + headless Chromium) | `docs/phase5-6-renderer-and-bridge.md` |
| 6 | Bridge server (wires everything together) | Built + tested, verified end-to-end | `docs/phase5-6-renderer-and-bridge.md` |
| 7 | On-site polish | Not started — needs real hardware | — |

## Layout

- `proxy/` — GSPro TCP data-tap proxy + fake GSPro/Club Optix test doubles
- `vision/` — ArUco mat tracking, foot detection, combined mat tracker
- `projector/` — projector keystone calibration (homography + CSS matrix3d)
- `webapp/` — kiosk renderer (HTML/CSS/JS, no build step)
- `bridge/` — aiohttp server: serves the webapp, tails shot/mat-state
  files, and broadcasts updates over WebSocket
- `tests/` — Python (pytest), Node (`node --test`), and headless-browser
  (Playwright) tests
- `docs/` — project plan and per-phase notes

## Running the whole stack

```bash
pip install -r requirements.txt

# 1. Stand-in for GSPro (skip once real GSPro is running)
python3 proxy/fake_gspro.py --port 0920

# 2. GSPro data-tap proxy
python3 proxy/gspro_proxy.py --listen-port 0921 --gspro-host 127.0.0.1 --gspro-port 0920

# 3. Vision tracker (camera index once mounted, or --video path for now)
python3 -m vision.mat_tracker --camera 0

# 4. Bridge server (serves the renderer + wires everything together)
python3 -m bridge.server --port 8000

# 5. Open a browser at http://localhost:8000/ (fullscreen/kiosk mode on the projector)
```

Feed sample shots without real hardware via
`python3 proxy/fake_club_optix.py --host 127.0.0.1 --port 0921`.

See `docs/phase5-6-renderer-and-bridge.md` for the full walkthrough.

## Tests

```bash
pip install -r requirements-dev.txt

pytest tests/ --ignore=tests/webapp/test_app_browser.py  # Python unit tests
pytest tests/webapp/test_app_browser.py                   # headless-browser render check
node --test tests/webapp/test_animation.js tests/webapp/test_render.js  # JS unit tests
```
