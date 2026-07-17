import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from vision.foot_detector import FootDetector

CANVAS_SIZE = (640, 480)  # width, height
BG_COLOR = (40, 120, 40)  # greenish mat
FOOT_COLOR = (10, 10, 10)  # dark shoes
LEFT_FOOT_CENTER = (220, 300)
RIGHT_FOOT_CENTER = (380, 300)
FOOT_SIZE = (40, 90)  # width, height


def make_background_frame():
    frame = np.zeros((CANVAS_SIZE[1], CANVAS_SIZE[0], 3), dtype=np.uint8)
    frame[:, :] = BG_COLOR
    return frame


def make_frame_with_feet(jitter=0):
    frame = make_background_frame()
    for cx, cy in (LEFT_FOOT_CENTER, RIGHT_FOOT_CENTER):
        cx, cy = cx + jitter, cy + jitter
        w, h = FOOT_SIZE
        x0, y0 = int(cx - w / 2), int(cy - h / 2)
        x1, y1 = int(cx + w / 2), int(cy + h / 2)
        frame[y0:y1, x0:x1] = FOOT_COLOR
    return frame


def test_settles_and_locates_feet_after_stance_holds():
    detector = FootDetector(
        min_area=500, max_area=20000, history=60, settle_frames=8, settle_tolerance_px=6,
        background_learn_frames=25,
    )

    # Learn the background with a run of empty frames (golfer not yet in view).
    for _ in range(30):
        detector.update(make_background_frame())

    # Golfer steps in and holds a stance for enough frames to settle.
    result = None
    for _ in range(12):
        result = detector.update(make_frame_with_feet())

    assert result.feet is not None
    assert result.settled is True

    (lx, ly), (rx, ry) = result.feet
    assert lx == pytest.approx(LEFT_FOOT_CENTER[0], abs=6)
    assert ly == pytest.approx(LEFT_FOOT_CENTER[1], abs=6)
    assert rx == pytest.approx(RIGHT_FOOT_CENTER[0], abs=6)
    assert ry == pytest.approx(RIGHT_FOOT_CENTER[1], abs=6)


def test_not_settled_while_still_moving():
    detector = FootDetector(
        min_area=500, max_area=20000, history=60, settle_frames=8, settle_tolerance_px=6,
        background_learn_frames=25,
    )

    for _ in range(30):
        detector.update(make_background_frame())

    # Feet position drifts each frame - never settles.
    result = None
    for i in range(12):
        result = detector.update(make_frame_with_feet(jitter=i * 3))

    assert result.settled is False
