"""
Headless-browser walkthrough of the setup wizard (webapp/setup.html):
step navigation, the max-3 stat picker limit, drag-based projector corner
calibration, and the save flow's fallback to downloading config files when
no bridge server is present (as is the case serving plain static files).
"""
import http.server
import json
import threading
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


def test_stat_picker_enforces_max_of_four(server_url, browser):
    page = browser.new_page()
    page.goto(f"{server_url}/setup.html")

    page.click("#next-btn")  # -> step 1 (stats)
    checkboxes = page.query_selector_all("#stat-options input[type=checkbox]")
    assert len(checkboxes) >= 5

    # Uncheck the 4 that are pre-selected by default, then check 5 different ones.
    for cb in checkboxes:
        if cb.is_checked():
            cb.click()

    for cb in checkboxes[:5]:
        cb.click()

    checked = [cb for cb in checkboxes if cb.is_checked()]
    assert len(checked) == 4, "expected the 5th checkbox click to be rejected by the max-4 rule"

    selected = page.evaluate("window.__focusWizardDebug.getSelectedStats()")
    assert len(selected) == 4
    page.close()


def test_corner_drag_updates_calibration_state(server_url, browser):
    page = browser.new_page()
    page.goto(f"{server_url}/setup.html")
    page.click("#next-btn")  # step 1
    page.click("#next-btn")  # step 2 (projector)

    before = page.evaluate("window.__focusWizardDebug.getCorners()")
    assert before == [[0, 0], [1920, 0], [1920, 1080], [0, 1080]]

    box = page.eval_on_selector("#calibration-canvas", "el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }")
    # Top-left handle sits near display-space (0,0); drag it inward/down.
    start_x, start_y = box["x"] + 2, box["y"] + 2
    end_x, end_y = box["x"] + 60, box["y"] + 40

    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(end_x, end_y, steps=5)
    page.mouse.up()

    after = page.evaluate("window.__focusWizardDebug.getCorners()")
    assert after[0] != [0, 0], "expected dragging the top-left handle to change its stored corner"
    # The other 3 corners should be untouched.
    assert after[1] == [1920, 0]
    assert after[2] == [1920, 1080]
    assert after[3] == [0, 1080]
    page.close()


def test_reset_corners_restores_identity_quad(server_url, browser):
    page = browser.new_page()
    page.goto(f"{server_url}/setup.html")
    page.click("#next-btn")
    page.click("#next-btn")

    box = page.eval_on_selector("#calibration-canvas", "el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y}; }")
    page.mouse.move(box["x"] + 2, box["y"] + 2)
    page.mouse.down()
    page.mouse.move(box["x"] + 80, box["y"] + 80, steps=5)
    page.mouse.up()

    moved = page.evaluate("window.__focusWizardDebug.getCorners()")
    assert moved[0] != [0, 0]

    page.click("#reset-corners")
    reset = page.evaluate("window.__focusWizardDebug.getCorners()")
    assert reset == [[0, 0], [1920, 0], [1920, 1080], [0, 1080]]
    page.close()


def test_review_step_shows_current_selections(server_url, browser):
    page = browser.new_page()
    page.goto(f"{server_url}/setup.html")
    page.fill("#mat-width", "1200")
    page.fill("#mat-height", "1800")
    page.click("#next-btn")
    page.click("#next-btn")
    page.click("#next-btn")  # step 3 (review)

    summary_text = page.eval_on_selector("#review-summary", "el => el.textContent")
    summary = json.loads(summary_text)
    assert summary["matWidthMm"] == 1200
    assert summary["matHeightMm"] == 1800
    assert len(summary["stats"]) <= 4
    page.close()


def test_save_without_bridge_server_falls_back_to_download(server_url, browser):
    page = browser.new_page()
    page.goto(f"{server_url}/setup.html")
    page.click("#next-btn")
    page.click("#next-btn")
    page.click("#next-btn")

    with page.expect_download() as download_info:
        page.click("#save-btn")
    download = download_info.value
    assert download.suggested_filename == "config.json"

    status_text = page.eval_on_selector("#save-status", "el => el.textContent")
    assert "downloaded config.json" in status_text
    page.close()
