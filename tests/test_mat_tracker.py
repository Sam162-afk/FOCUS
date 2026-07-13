import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from vision.aruco_tracker import DEFAULT_ARUCO_DICT
from vision.foot_detector import FootDetector
from vision.mat_tracker import MatTracker

CANVAS_SIZE = (900, 700)  # width, height
MAT_WIDTH_MM = 1000.0
MAT_HEIGHT_MM = 1500.0

# Axis-aligned marker rectangle, matching test_aruco_tracker.py's layout.
PIXEL_CORNERS = {
    0: (150, 100),
    1: (750, 100),
    2: (750, 600),
    3: (150, 600),
}

BG_COLOR = (255, 255, 255)
FOOT_COLOR = (10, 10, 10)
FOOT_SIZE = (30, 60)


def make_frame(foot_pixel_centers=None):
    canvas = np.full((CANVAS_SIZE[1], CANVAS_SIZE[0], 3), BG_COLOR, dtype=np.uint8)
    dictionary = cv2.aruco.getPredefinedDictionary(DEFAULT_ARUCO_DICT)
    marker_size_px = 80
    for marker_id, (cx, cy) in PIXEL_CORNERS.items():
        marker_img = cv2.aruco.generateImageMarker(dictionary, marker_id, marker_size_px)
        marker_bgr = cv2.cvtColor(marker_img, cv2.COLOR_GRAY2BGR)
        x0, y0 = int(cx - marker_size_px / 2), int(cy - marker_size_px / 2)
        canvas[y0:y0 + marker_size_px, x0:x0 + marker_size_px] = marker_bgr

    if foot_pixel_centers:
        for cx, cy in foot_pixel_centers:
            w, h = FOOT_SIZE
            x0, y0 = int(cx - w / 2), int(cy - h / 2)
            x1, y1 = int(cx + w / 2), int(cy + h / 2)
            canvas[y0:y1, x0:x1] = FOOT_COLOR

    return canvas


def test_square_stance_gives_near_zero_alignment():
    # Feet side-by-side at the same "downrange" pixel row -> mat-space
    # stance line should be parallel to mat x-axis -> alignment ~ 0 deg.
    foot_detector = FootDetector(min_area=200, max_area=5000, history=20, settle_frames=3, background_learn_frames=10)
    tracker = MatTracker(mat_width_mm=MAT_WIDTH_MM, mat_height_mm=MAT_HEIGHT_MM, foot_detector=foot_detector)

    for _ in range(10):
        tracker.process_frame(make_frame())

    left_px, right_px = (400, 400), (500, 400)
    state = None
    for _ in range(6):
        state = tracker.process_frame(make_frame([left_px, right_px]))

    assert state.calibrated
    assert state.feet_settled
    assert state.foot_mat_points_mm is not None
    assert state.alignment_deg == pytest.approx(0.0, abs=3)


def test_open_stance_gives_nonzero_alignment():
    # Right foot pulled "downrange" relative to left -> stance line is no
    # longer parallel to the x-axis -> nonzero alignment angle.
    foot_detector = FootDetector(min_area=200, max_area=5000, history=20, settle_frames=3, background_learn_frames=10)
    tracker = MatTracker(mat_width_mm=MAT_WIDTH_MM, mat_height_mm=MAT_HEIGHT_MM, foot_detector=foot_detector)

    for _ in range(10):
        tracker.process_frame(make_frame())

    left_px, right_px = (400, 400), (500, 460)
    state = None
    for _ in range(6):
        state = tracker.process_frame(make_frame([left_px, right_px]))

    assert state.calibrated
    assert state.alignment_deg is not None
    assert abs(state.alignment_deg) > 3
