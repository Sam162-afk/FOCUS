"""
Headless-browser smoke test for the kiosk renderer (webapp/). Serves the
static files, stubs out /api/config and the WebSocket-driven data (by
calling the same functions app.js exposes indirectly through window
globals), and verifies:
  - the CSS matrix3d transform from a fake projector calibration actually
    gets applied to #stage
  - the canvas renders a pure-black background (per the design constraint)
  - injecting a shot via the exposed FocusAnim/FocusRender globals and
    manually driving one animation frame draws visible (non-black) pixels

This exercises the real browser + real canvas 2D context, which the pure
Node unit tests (test_animation.js, test_render.js) intentionally mock
out.
"""
import http.server
import json
import threading
import time
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

WEBAPP_DIR = Path(__file__).resolve().parents[2] / "webapp"
CHROMIUM_PATH = "/opt/pw-browsers/chromium"


@pytest.fixture(scope="module")
def server_url():
    handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(*args, directory=str(WEBAPP_DIR), **kwargs)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    httpd.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROMIUM_PATH)
        yield b
        b.close()


def test_stage_applies_css_matrix3d_from_config(server_url, browser):
    page = browser.new_page()
    fake_matrix = "matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 50,30,0,1)"

    def handle_config(route):
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "matWidthMm": 1000,
                "matHeightMm": 1500,
                "canvasWidth": 800,
                "canvasHeight": 600,
                "cssMatrix3d": fake_matrix,
            }),
        )

    page.route("**/api/config", handle_config)
    page.goto(f"{server_url}/index.html")
    page.wait_for_timeout(300)

    transform = page.eval_on_selector("#stage", "el => getComputedStyle(el).transform")
    assert transform != "none", "expected a computed transform matrix on #stage"

    canvas_width = page.eval_on_selector("#field", "el => el.width")
    assert canvas_width == 800

    page.close()


def test_canvas_renders_black_background_by_default(server_url, browser):
    page = browser.new_page()
    page.route("**/api/config", lambda route: route.fulfill(status=404, body="not found"))
    page.goto(f"{server_url}/index.html")
    page.wait_for_timeout(300)

    pixel = page.evaluate(
        """() => {
            const canvas = document.getElementById('field');
            const ctx = canvas.getContext('2d');
            const data = ctx.getImageData(10, 10, 1, 1).data;
            return [data[0], data[1], data[2]];
        }"""
    )
    assert pixel == [0, 0, 0]
    page.close()


def test_injected_shot_draws_visible_pixels_on_canvas(server_url, browser):
    page = browser.new_page()
    page.route("**/api/config", lambda route: route.fulfill(status=404, body="not found"))
    page.goto(f"{server_url}/index.html")
    page.wait_for_timeout(300)

    # Drive the same drawing functions app.js uses, directly, to check the
    # real browser canvas actually paints a visible shot path + stats -
    # independent of whether a bridge server / WebSocket is available.
    result = page.evaluate(
        """() => {
            const canvas = document.getElementById('field');
            const ctx = canvas.getContext('2d');
            FocusRender.clearCanvas(ctx, canvas.width, canvas.height);

            const shot = { BallData: { HLA: 5, SpinAxis: 15, CarryDistance: 220, Speed: 148 },
                           ClubData: { Path: -2.1, FaceToTarget: -1.5, Speed: 99 } };
            const path = FocusAnim.sampleShotPath(shot, {}, 60);
            FocusRender.drawShotPath(ctx, canvas.width, canvas.height, path, 1.0);
            FocusRender.drawStatsOverlay(ctx, canvas.width, ['Club Path: -2.1', 'Smash Factor: 1.49']);

            // Sample exactly where the midpoint of the drawn path lands,
            // computed the same way drawShotPath places it.
            const midPoint = path[Math.floor(path.length / 2)];
            const canvasPt = FocusRender.shotPointToCanvas(midPoint, canvas.width, canvas.height);
            const data = ctx.getImageData(Math.round(canvasPt.x), Math.round(canvasPt.y), 1, 1).data;
            return [data[0], data[1], data[2]];
        }"""
    )
    assert result != [0, 0, 0], "expected the shot path to paint non-black pixels"
    page.close()


def test_clubhead_approach_and_impact_marker_render_on_real_canvas(server_url, browser):
    page = browser.new_page()
    page.route("**/api/config", lambda route: route.fulfill(status=404, body="not found"))
    page.goto(f"{server_url}/index.html")
    page.wait_for_timeout(300)

    result = page.evaluate(
        """() => {
            const canvas = document.getElementById('field');
            const ctx = canvas.getContext('2d');

            const shot = { ClubData: { Path: 8, FaceToTarget: -2, ClosureRate: 250,
                                        HorizontalFaceImpact: 0.6, VerticalFaceImpact: 0 } };
            const state = FocusClubhead.computeClubheadState(shot);

            FocusRender.clearCanvas(ctx, canvas.width, canvas.height);
            const midFrame = FocusClubhead.sampleClubheadFrame(state, 0.5);
            FocusRender.drawClubhead(ctx, canvas.width, canvas.height, state, midFrame);
            const midPos = FocusRender.shotPointToCanvas(midFrame.position, canvas.width, canvas.height);
            // Scan a box around the clubhead center for any non-black pixel - robust
            // to the wireframe's rotation angle, which varies with ClosureRate/progress.
            const box = ctx.getImageData(Math.round(midPos.x - 30), Math.round(midPos.y - 30), 60, 60).data;
            let midHit = false;
            for (let i = 0; i < box.length; i += 4) {
                if (box[i] || box[i + 1] || box[i + 2]) { midHit = true; break; }
            }

            FocusRender.clearCanvas(ctx, canvas.width, canvas.height);
            const impactFrame = FocusClubhead.sampleClubheadFrame(state, 1);
            FocusRender.drawClubhead(ctx, canvas.width, canvas.height, state, impactFrame);
            const impactPos = FocusRender.shotPointToCanvas(impactFrame.position, canvas.width, canvas.height);
            const markerX = impactPos.x + state.horizontalImpactNorm * 34;
            const markerData = ctx.getImageData(Math.round(markerX), Math.round(impactPos.y), 1, 1).data;

            return { midHit, marker: [markerData[0], markerData[1], markerData[2]] };
        }"""
    )
    assert result["midHit"], "expected the clubhead wireframe to paint visible pixels mid-approach"
    assert result["marker"] != [0, 0, 0], "expected the toe/heel impact marker to paint a visible pixel at impact"
    page.close()
