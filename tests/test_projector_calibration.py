import os
import re
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from projector.calibration import ProjectorCalibration, homography_to_css_matrix3d

CANVAS_SIZE = (400, 300)  # width, height
# A deliberately skewed/keystoned quad in "projector output" pixel space.
PROJECTOR_CORNERS = [
    (120, 80),   # top-left
    (760, 60),   # top-right
    (800, 620),  # bottom-right
    (100, 640),  # bottom-left
]


def make_calibration():
    return ProjectorCalibration(canvas_size=CANVAS_SIZE, projector_corners=PROJECTOR_CORNERS)


def test_warp_image_maps_canvas_corners_to_projector_corners():
    calibration = make_calibration()
    w, h = CANVAS_SIZE
    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    marker_size = 10
    # Paint a distinct color swatch at each canvas corner.
    colors = {
        "top-left": (0, 0, 255),
        "top-right": (0, 255, 0),
        "bottom-right": (255, 0, 0),
        "bottom-left": (0, 255, 255),
    }
    canvas[0:marker_size, 0:marker_size] = colors["top-left"]
    canvas[0:marker_size, w - marker_size:w] = colors["top-right"]
    canvas[h - marker_size:h, w - marker_size:w] = colors["bottom-right"]
    canvas[h - marker_size:h, 0:marker_size] = colors["bottom-left"]

    output_size = (900, 700)
    warped = calibration.warp_image(canvas, output_size)

    assert warped.shape == (output_size[1], output_size[0], 3)

    def sample(pt):
        x, y = int(pt[0]), int(pt[1])
        return tuple(int(v) for v in warped[y, x])

    # Sample a couple pixels inward from each expected projector corner
    # (the exact corner pixel can land right on the seam of the swatch).
    tl = sample((PROJECTOR_CORNERS[0][0] + 4, PROJECTOR_CORNERS[0][1] + 4))
    assert tl == colors["top-left"]

    br = sample((PROJECTOR_CORNERS[2][0] - 4, PROJECTOR_CORNERS[2][1] - 4))
    assert br == colors["bottom-right"]


def test_homography_to_css_matrix3d_matches_direct_homography():
    calibration = make_calibration()
    h_matrix = calibration.homography()
    css_string = calibration.to_css_matrix3d()

    match = re.match(r"matrix3d\((.+)\)", css_string)
    assert match is not None
    values = [float(v) for v in match.group(1).split(",")]
    assert len(values) == 16

    # Reconstruct the column-major 4x4 CSS matrix.
    css_matrix = np.array(values, dtype=np.float64).reshape(4, 4).T

    test_points = [(0, 0), (CANVAS_SIZE[0], 0), (CANVAS_SIZE[0], CANVAS_SIZE[1]), (0, CANVAS_SIZE[1]), (200, 150)]
    for x, y in test_points:
        vec = np.array([x, y, 0, 1], dtype=np.float64)
        out = css_matrix @ vec
        css_x, css_y, _, css_w = out
        css_x, css_y = css_x / css_w, css_y / css_w

        direct = cv2.perspectiveTransform(np.array([[[x, y]]], dtype=np.float32), h_matrix)
        direct_x, direct_y = direct[0, 0]

        assert css_x == pytest.approx(direct_x, abs=1e-3)
        assert css_y == pytest.approx(direct_y, abs=1e-3)


def test_save_and_load_round_trip(tmp_path):
    calibration = make_calibration()
    path = str(tmp_path / "calibration.json")
    calibration.save(path)

    loaded = ProjectorCalibration.load(path)

    assert loaded.canvas_size == calibration.canvas_size
    assert loaded.projector_corners == calibration.projector_corners
    assert np.allclose(loaded.homography(), calibration.homography())
