"""
Foot / stance detection via background subtraction + contour detection.

Simplest version per the project plan: once the golfer sets up and camera
motion settles, find the two largest roughly-stationary foreground blobs
(the shoes) via MOG2 background subtraction, and report them once their
positions have stayed put for several consecutive frames ("settled") so a
transient foreground blob (a hand passing through frame) doesn't get
reported as a foot.
"""
from collections import deque
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np

Point = Tuple[float, float]


@dataclass
class FootDetectionResult:
    feet: Optional[Tuple[Point, Point]]  # left-to-right by pixel x, or None
    settled: bool
    mask: np.ndarray


class FootDetector:
    def __init__(
        self,
        min_area: float = 800,
        max_area: float = 15000,
        history: int = 120,
        var_threshold: float = 25,
        settle_frames: int = 8,
        settle_tolerance_px: float = 6.0,
        background_learn_frames: Optional[int] = None,
        min_learning_rate: float = 0.0005,
    ):
        self.min_area = min_area
        self.max_area = max_area
        self.settle_frames = settle_frames
        self.settle_tolerance_px = settle_tolerance_px
        # After the initial learning window, drop the background learning
        # rate way down so a golfer standing still through their pre-shot
        # routine doesn't slowly get absorbed into the background model.
        self.background_learn_frames = background_learn_frames if background_learn_frames is not None else history
        self.min_learning_rate = min_learning_rate
        self._frames_seen = 0
        self._bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=history, varThreshold=var_threshold, detectShadows=False
        )
        self._recent_feet: deque = deque(maxlen=settle_frames)
        self._morph_kernel = np.ones((5, 5), np.uint8)

    def _foreground_mask(self, frame) -> np.ndarray:
        self._frames_seen += 1
        learning_rate = -1 if self._frames_seen <= self.background_learn_frames else self.min_learning_rate
        mask = self._bg_subtractor.apply(frame, learningRate=learning_rate)
        _, mask = cv2.threshold(mask, 200, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._morph_kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self._morph_kernel)
        return mask

    def _find_blobs(self, mask: np.ndarray) -> List[Tuple[float, float, float]]:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        blobs = []
        for c in contours:
            area = cv2.contourArea(c)
            if self.min_area <= area <= self.max_area:
                m = cv2.moments(c)
                if m["m00"] == 0:
                    continue
                cx = m["m10"] / m["m00"]
                cy = m["m01"] / m["m00"]
                blobs.append((cx, cy, area))
        blobs.sort(key=lambda b: -b[2])
        return blobs

    def update(self, frame) -> FootDetectionResult:
        mask = self._foreground_mask(frame)
        blobs = self._find_blobs(mask)

        feet = None
        if len(blobs) >= 2:
            top2 = sorted(blobs[:2], key=lambda b: b[0])  # left-to-right
            feet = ((top2[0][0], top2[0][1]), (top2[1][0], top2[1][1]))
            self._recent_feet.append(feet)
        else:
            self._recent_feet.clear()

        return FootDetectionResult(feet=feet, settled=self._is_settled(), mask=mask)

    def _is_settled(self) -> bool:
        if len(self._recent_feet) < self.settle_frames:
            return False

        left_pts = [f[0] for f in self._recent_feet]
        right_pts = [f[1] for f in self._recent_feet]

        def spread(pts):
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            return max(xs) - min(xs), max(ys) - min(ys)

        sx1, sy1 = spread(left_pts)
        sx2, sy2 = spread(right_pts)
        return all(v <= self.settle_tolerance_px for v in (sx1, sy1, sx2, sy2))
