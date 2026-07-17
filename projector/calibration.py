"""
Projector output mapping: keystone-correct whatever gets rendered so it
lands as an undistorted rectangle on the physical floor, regardless of
projector angle/position.

One-time calibration: someone stands where the golfer will stand and
identifies the 4 corners of the intended output area as seen on the
actual floor (e.g. by clicking them on a live preview of a test pattern).
That gives us 4 points in projector-output pixel space corresponding to
the 4 corners of our render canvas, which is enough to solve a homography
(canvas-space -> projector-output-space) via cv2.getPerspectiveTransform.

Two ways to apply the result, both derived from the same homography:
1. `warp_image()` - physically warp a rendered frame with OpenCV before
   sending it out (useful for a Python-rendered pipeline, and for the
   test pattern / preview tooling here).
2. `homography_to_css_matrix3d()` - convert the same homography into a
   CSS `matrix3d(...)` transform string, so a browser-based renderer (the
   Phase 5 kiosk web app) can pre-warp its own fullscreen canvas directly
   via CSS and output straight to the projector's HDMI input with no
   separate capture/warp process in the loop.
"""
import argparse
import json
from dataclasses import asdict, dataclass
from typing import List, Tuple

import cv2
import numpy as np

Point = Tuple[float, float]


@dataclass
class ProjectorCalibration:
    canvas_size: Tuple[int, int]  # (width, height) of the render canvas
    projector_corners: List[Point]  # 4 points in projector-output pixel space,
    # in the order: top-left, top-right, bottom-right, bottom-left of the
    # canvas as it should appear on the floor.

    def homography(self) -> np.ndarray:
        w, h = self.canvas_size
        src = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
        dst = np.array(self.projector_corners, dtype=np.float32)
        h_matrix = cv2.getPerspectiveTransform(src, dst)
        return h_matrix

    def warp_image(self, canvas_frame: np.ndarray, output_size: Tuple[int, int]) -> np.ndarray:
        h_matrix = self.homography()
        return cv2.warpPerspective(canvas_frame, h_matrix, output_size)

    def to_css_matrix3d(self) -> str:
        return homography_to_css_matrix3d(self.homography())

    def save(self, path: str):
        with open(path, "w") as f:
            json.dump(asdict(self), f, indent=2)

    @classmethod
    def load(cls, path: str) -> "ProjectorCalibration":
        with open(path) as f:
            data = json.load(f)
        return cls(canvas_size=tuple(data["canvas_size"]), projector_corners=[tuple(p) for p in data["projector_corners"]])


def homography_to_css_matrix3d(h_matrix: np.ndarray) -> str:
    """
    Convert a 2D planar homography (3x3, maps (x,y,1) -> (x',y',w')) into
    a CSS `matrix3d(...)` transform string that applies the same mapping
    to an element with `transform-origin: 0 0`.

    CSS matrix3d(m11,m12,m13,m14, m21,...,m44) is column-major: applying
    it to (x,y,0,1) gives x' = m11*x + m21*y + m41, y' = m12*x + m22*y +
    m42, w' = m14*x + m24*y + m44 (then the browser divides by w'). So the
    homography's rows map directly onto matrix3d's columns; z just needs
    an inert (0,0,1,0) column since our source points are always z=0.
    """
    h = h_matrix / h_matrix[2, 2]  # normalize scale so w-row is comparable across calibrations
    m11, m12, m13 = h[0]
    m21, m22, m23 = h[1]
    m31, m32, m33 = h[2]

    values = [
        m11, m21, 0, m31,
        m12, m22, 0, m32,
        0, 0, 1, 0,
        m13, m23, 0, m33,
    ]
    return "matrix3d(" + ", ".join(f"{v:.8f}" for v in values) + ")"


def run_interactive_calibration(canvas_size: Tuple[int, int], camera_or_video, save_path: str):
    """
    Interactive calibration tool: shows a live preview (from a camera
    pointed at the floor, or a pre-recorded video/photo) so the operator
    can click the 4 corners of the projected test pattern as it actually
    lands on the floor. Requires a display and is not automated-testable
    - covered instead by unit tests on the pure homography math above.
    """
    cap = cv2.VideoCapture(camera_or_video)
    if not cap.isOpened():
        raise RuntimeError(f"could not open source: {camera_or_video!r}")

    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise RuntimeError("could not read a frame to calibrate against")

    clicked: List[Point] = []
    window = "Click 4 corners: top-left, top-right, bottom-right, bottom-left"

    def on_click(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(clicked) < 4:
            clicked.append((float(x), float(y)))

    cv2.namedWindow(window)
    cv2.setMouseCallback(window, on_click)

    while len(clicked) < 4:
        preview = frame.copy()
        for i, (x, y) in enumerate(clicked):
            cv2.circle(preview, (int(x), int(y)), 6, (0, 255, 0), -1)
            cv2.putText(preview, str(i + 1), (int(x) + 8, int(y)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imshow(window, preview)
        if cv2.waitKey(20) & 0xFF == 27:  # Esc aborts
            cv2.destroyAllWindows()
            raise KeyboardInterrupt("calibration aborted")

    cv2.destroyAllWindows()
    calibration = ProjectorCalibration(canvas_size=canvas_size, projector_corners=clicked)
    calibration.save(save_path)
    return calibration


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--canvas-width", type=int, default=1920)
    parser.add_argument("--canvas-height", type=int, default=1080)
    parser.add_argument("--camera", type=int, help="Camera index pointed at the floor")
    parser.add_argument("--video", type=str, help="Video/photo path instead of a live camera")
    parser.add_argument("--save", type=str, default="projector_calibration.json")
    args = parser.parse_args()

    source = args.video if args.video else args.camera
    if source is None:
        parser.error("must pass either --camera or --video")

    calibration = run_interactive_calibration((args.canvas_width, args.canvas_height), source, args.save)
    print(f"saved calibration to {args.save}")
    print(f"CSS matrix3d: {calibration.to_css_matrix3d()}")


if __name__ == "__main__":
    main()
