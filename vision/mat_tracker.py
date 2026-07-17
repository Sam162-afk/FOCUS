"""
Combines ArUco mat-space calibration with foot detection to produce a
single mat-state: is the mat calibrated, where are the feet in mat-space
(mm), and what's the stance/alignment angle relative to the target line.

Target line convention: mat-space +y is "downrange" (from the back
markers, id0/id1, towards the front markers, id3/id2 - see
aruco_tracker.py's docstring for the marker layout). A golfer stands
side-on to the target, so a square stance has its stance line (left foot
-> right foot) parallel to the target line (mat-space y-axis) - like the
two rails of a railroad track, not crossing it. alignment_deg is the
signed angle between the stance line and the mat y-axis: 0 = square,
nonzero = open/closed (exact sign-to-open/closed mapping depends on
handedness, left as a display-layer concern).

Runs as a CLI against a live camera or a video file, and continuously
writes the latest mat state as JSON to a file so the bridge process (see
bridge/server.py) can pick it up and forward it to the renderer.
"""
import argparse
import json
import math
import time
from dataclasses import asdict, dataclass
from typing import Optional, Tuple

import cv2

from vision.aruco_tracker import ArucoMatTracker
from vision.foot_detector import FootDetector

Point = Tuple[float, float]


@dataclass
class MatState:
    calibrated: bool
    num_markers_found: int
    reprojection_error_mm: Optional[float]
    feet_settled: bool
    foot_mat_points_mm: Optional[Tuple[Point, Point]]
    alignment_deg: Optional[float]
    timestamp: float


class MatTracker:
    def __init__(
        self,
        mat_width_mm: float = 1000.0,
        mat_height_mm: float = 1500.0,
        foot_detector: Optional[FootDetector] = None,
    ):
        self.aruco = ArucoMatTracker(mat_width_mm=mat_width_mm, mat_height_mm=mat_height_mm)
        self.feet = foot_detector or FootDetector()

    def process_frame(self, frame) -> MatState:
        aruco_result = self.aruco.process_frame(frame)
        foot_result = self.feet.update(frame)

        foot_mat_points = None
        alignment_deg = None
        if aruco_result.calibrated and foot_result.feet:
            left_px, right_px = foot_result.feet
            left_mat = self.aruco.pixel_to_mat(aruco_result.homography, left_px)
            right_mat = self.aruco.pixel_to_mat(aruco_result.homography, right_px)
            foot_mat_points = (left_mat, right_mat)

            dx = right_mat[0] - left_mat[0]
            dy = right_mat[1] - left_mat[1]
            # atan2(dx, dy) is 0 when the stance line is parallel to the
            # mat y-axis / target line (square stance); nonzero = open/closed.
            alignment_deg = math.degrees(math.atan2(dx, dy))

        return MatState(
            calibrated=aruco_result.calibrated,
            num_markers_found=aruco_result.num_markers_found,
            reprojection_error_mm=aruco_result.reprojection_error_mm,
            feet_settled=foot_result.settled,
            foot_mat_points_mm=foot_mat_points,
            alignment_deg=alignment_deg,
            timestamp=time.time(),
        )


def _write_state(state: MatState, path: str):
    with open(path, "w") as f:
        json.dump(asdict(state), f)


def run(source, mat_width_mm: float, mat_height_mm: float, state_path: str, fps_limit: float = 30.0):
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"could not open video source: {source!r}")

    tracker = MatTracker(mat_width_mm=mat_width_mm, mat_height_mm=mat_height_mm)
    min_frame_interval = 1.0 / fps_limit if fps_limit else 0.0

    try:
        while True:
            t0 = time.time()
            ok, frame = cap.read()
            if not ok:
                break

            state = tracker.process_frame(frame)
            _write_state(state, state_path)

            elapsed = time.time() - t0
            if min_frame_interval and elapsed < min_frame_interval:
                time.sleep(min_frame_interval - elapsed)
    finally:
        cap.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--camera", type=int, help="Camera device index (e.g. 0)")
    parser.add_argument("--video", type=str, help="Path to a video file (for testing without a live camera)")
    parser.add_argument("--mat-width-mm", type=float, default=1000.0)
    parser.add_argument("--mat-height-mm", type=float, default=1500.0)
    parser.add_argument("--state-file", type=str, default="mat_state.json")
    parser.add_argument("--fps-limit", type=float, default=30.0)
    args = parser.parse_args()

    if args.camera is None and not args.video:
        parser.error("must pass either --camera or --video")

    source = args.video if args.video else args.camera
    run(source, args.mat_width_mm, args.mat_height_mm, args.state_file, args.fps_limit)


if __name__ == "__main__":
    main()
