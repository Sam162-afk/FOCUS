# Phase 5 & 6: Renderer + Bridge (wiring it all together)

## Renderer (`webapp/`)

A plain HTML/CSS/JS kiosk page (no build step, no framework — matches the
plan's "browser in kiosk mode" recommendation):

- `index.html` — fullscreen black page, `#stage` div (gets the projector
  keystone transform applied to it) containing a `<canvas id="field">`,
  plus a small connection-status indicator.
- `js/animation.js` — pure functions turning GSPro-style shot JSON into a
  top-down shot-shape curve: a quadratic Bezier from the impact point,
  initial direction from `HLA`, bending further from the target line as
  a function of `SpinAxis` compounding with distance (`CarryDistance`).
  This is a **stylized reconstruction**, not a physics simulation — see
  the project plan's framing note. No DOM dependency, so it's unit
  tested directly under Node (`tests/webapp/test_animation.js`).
- `js/render.js` — canvas drawing: pure-black background, the
  camera-tracked alignment line (lime), the animated shot path (white,
  progressively revealed with an ease-out curve), and a 2-3 line stat
  overlay. Also DOM-independent (takes a 2D context) and unit tested with
  a mock context (`tests/webapp/test_render.js`), plus a real headless-
  Chromium test (`tests/webapp/test_app_browser.py`) that actually reads
  back canvas pixels to confirm it paints what's expected in a real
  browser.
- `js/app.js` — glues it together: fetches `/api/config` (mat size,
  canvas size, keystone transform), opens a WebSocket to `/ws`, redraws
  the alignment line on every `mat_state` message, and re-triggers the
  shot animation on every `shot` message.

## Bridge (`bridge/server.py`)

A single `aiohttp` process — the "Main App" / bridge from the
architecture diagram:

- Serves `webapp/` as static files, plus `/api/config` (mat/canvas
  dimensions and the CSS `matrix3d` string, read from
  `projector_calibration.json` if one exists).
- `/ws` — WebSocket endpoint; every connected browser gets pushed:
  - `{"type": "shot", "shot": {...}}` whenever a new line is appended to
    `shots_log.jsonl` (written by `proxy/gspro_proxy.py`).
  - `{"type": "mat_state", "state": {...}}` whenever `mat_state.json`
    (written by `vision/mat_tracker.py`) changes.

Processes are deliberately decoupled via plain files rather than direct
pipes/sockets between them — each of the proxy, vision tracker, and
bridge can be started, stopped, and restarted independently, matching the
plan's phased build order (and making it easy to develop/test one piece
without the others running).

## Running the whole stack together

Five terminals (or your process manager of choice):

```bash
# 1. Stand-in for GSPro (skip once real GSPro is running)
python3 proxy/fake_gspro.py --port 0920

# 2. GSPro data-tap proxy
python3 proxy/gspro_proxy.py --listen-port 0921 --gspro-host 127.0.0.1 --gspro-port 0920 \
    --shot-log shots_log.jsonl

# 3. Vision tracker (against a live camera once mounted, or a video file for now)
python3 -m vision.mat_tracker --camera 0 --state-file mat_state.json

# 4. Bridge server
python3 -m bridge.server --shots-log shots_log.jsonl --mat-state-file mat_state.json --port 8000

# 5. Kiosk browser, fullscreen, pointed at:
#    http://localhost:8000/
```

Then feed sample shots through the proxy with
`python3 proxy/fake_club_optix.py --host 127.0.0.1 --port 0921` to see
the animation trigger end-to-end before real hardware is in the loop.

This full chain (fake GSPro → proxy → bridge → real headless-browser
render, and separately a live mat-tracking update reaching the browser's
alignment line) was manually verified end-to-end during development.

## What's still hardware-dependent / not yet done

- Real ArUco marker placement + camera mount (Phase 2 code is tested
  against synthetic frames, not a physical mat/camera yet).
- Real projector keystone calibration (Phase 3's interactive tool needs a
  camera pointed at an actual projected test pattern).
- Confirming Club Optix can actually be pointed at the proxy (the
  original Phase 0 risk item — see `docs/phase0-data-tap.md`; the proxy
  itself is built and tested, but not yet validated against real Club
  Optix / GSPro traffic).
- Phase 7 (polish): on-site contrast/timing tuning, and a settings screen
  for choosing which 2-3 stats to display (currently hardcoded in
  `app.js`'s `computeStatsLines`).
