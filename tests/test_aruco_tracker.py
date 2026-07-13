import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from vision.aruco_tracker import ArucoMatTracker, DEFAULT_ARUCO_DICT


def make_synthetic_frame(marker_pixel_centers, marker_size_px=80, canvas_size=(900, 700)):
    """Paste generated ArUco markers onto a blank canvas at given pixel centers."""
    canvas = np.full((canvas_size[1], canvas_size[0], 3), 255, dtype=np.uint8)
    dictionary = cv2.aruco.getPredefinedDictionary(DEFAULT_ARUCO_DICT)

    for marker_id, (cx, cy) in marker_pixel_centers.items():
        marker_img = cv2.aruco.generateImageMarker(dictionary, marker_id, marker_size_px)
        marker_bgr = cv2.cvtColor(marker_img, cv2.COLOR_GRAY2BGR)
        x0, y0 = int(cx - marker_size_px / 2), int(cy - marker_size_px / 2)
        canvas[y0:y0 + marker_size_px, x0:x0 + marker_size_px] = marker_bgr

    return canvas


# Pixel-space layout: a clean axis-aligned rectangle (no perspective skew),
# so we can assert exact-ish round trips.
PIXEL_CORNERS = {
    0: (150, 100),  # back-left
    1: (750, 100),  # back-right
    2: (750, 600),  # front-right
    3: (150, 600),  # front-left
}
MAT_WIDTH_MM = 1000.0
MAT_HEIGHT_MM = 1500.0


def test_detect_markers_finds_all_four():
    frame = make_synthetic_frame(PIXEL_CORNERS)
    tracker = ArucoMatTracker(mat_width_mm=MAT_WIDTH_MM, mat_height_mm=MAT_HEIGHT_MM)

    centers = tracker.detect_markers(frame)

    assert set(centers.keys()) == {0, 1, 2, 3}
    for marker_id, expected in PIXEL_CORNERS.items():
        got = centers[marker_id]
        assert got[0] == pytest.approx(expected[0], abs=3)
        assert got[1] == pytest.approx(expected[1], abs=3)


def test_process_frame_calibrates_and_maps_corners_to_mat_space():
    frame = make_synthetic_frame(PIXEL_CORNERS)
    tracker = ArucoMatTracker(mat_width_mm=MAT_WIDTH_MM, mat_height_mm=MAT_HEIGHT_MM)

    result = tracker.process_frame(frame)

    assert result.calibrated
    assert result.num_markers_found == 4
    assert result.reprojection_error_mm < 5.0

    # id0 pixel center should map close to mat-space origin (0, 0)
    mat_pt = tracker.pixel_to_mat(result.homography, PIXEL_CORNERS[0])
    assert mat_pt[0] == pytest.approx(0.0, abs=5)
    assert mat_pt[1] == pytest.approx(0.0, abs=5)

    # id2 (front-right) should map close to (mat_width, mat_height)
    mat_pt2 = tracker.pixel_to_mat(result.homography, PIXEL_CORNERS[2])
    assert mat_pt2[0] == pytest.approx(MAT_WIDTH_MM, abs=5)
    assert mat_pt2[1] == pytest.approx(MAT_HEIGHT_MM, abs=5)

    # Mat-space center should map back to roughly the pixel-space center.
    center_mat = (MAT_WIDTH_MM / 2, MAT_HEIGHT_MM / 2)
    pixel_pt = tracker.mat_to_pixel(result.homography_inv, center_mat)
    assert pixel_pt[0] == pytest.approx(450, abs=10)
    assert pixel_pt[1] == pytest.approx(350, abs=10)


def test_process_frame_holds_last_good_homography_when_marker_missing():
    tracker = ArucoMatTracker(mat_width_mm=MAT_WIDTH_MM, mat_height_mm=MAT_HEIGHT_MM)

    full_frame = make_synthetic_frame(PIXEL_CORNERS)
    first_result = tracker.process_frame(full_frame)
    assert first_result.calibrated

    partial_corners = dict(PIXEL_CORNERS)
    del partial_corners[2]  # simulate one marker occluded
    partial_frame = make_synthetic_frame(partial_corners)
    second_result = tracker.process_frame(partial_frame)

    assert second_result.num_markers_found == 3
    # Homography should still be available (held over from last good frame).
    assert second_result.calibrated
    np_all_close = np.allclose(second_result.homography, first_result.homography)
    assert np_all_close
