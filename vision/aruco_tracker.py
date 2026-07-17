"""
ArUco marker tracking for mat-space calibration.

Four ArUco markers are placed at the fixed corners of the hitting/mat zone.
Every frame, we detect whichever markers are visible and, if all four are
found, solve a homography mapping camera pixel-space to real-world
mat-space (millimeters, origin at the marker-0 corner). This is meant to
run continuously: if the camera gets bumped, the next frame with all four
markers visible just re-solves the mapping, no manual recalibration step.

Marker layout convention (looking down at the mat from above, "forward"
being the target line direction away from the golfer):

    id 0 -------- id 1      (back-left --------- back-right)
      |             |
      |    mat      |
      |             |
    id 3 -------- id 2      (front-left -------- front-right)

Mat-space is (x, y) in millimeters with x increasing left->right (id0->id1)
and y increasing back->front (id0->id3), origin at id0's corner.
"""
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

import cv2
import numpy as np

DEFAULT_ARUCO_DICT = cv2.aruco.DICT_4X4_50

# Corner ids, in the fixed order (id0, id1, id2, id3) matching the layout
# in the module docstring, used to build the destination points for the
# homography solve.
CORNER_MARKER_IDS = (0, 1, 2, 3)


def default_mat_space_corners(mat_width_mm: float, mat_height_mm: float) -> Dict[int, Tuple[float, float]]:
    """Real-world (mm) coordinates of each corner marker's center, given mat size."""
    return {
        0: (0.0, 0.0),
        1: (mat_width_mm, 0.0),
        2: (mat_width_mm, mat_height_mm),
        3: (0.0, mat_height_mm),
    }


@dataclass
class DetectionResult:
    marker_pixel_centers: Dict[int, Tuple[float, float]] = field(default_factory=dict)
    homography: Optional[np.ndarray] = None  # pixel-space -> mat-space (mm)
    homography_inv: Optional[np.ndarray] = None  # mat-space (mm) -> pixel-space
    reprojection_error_mm: Optional[float] = None

    @property
    def calibrated(self) -> bool:
        return self.homography is not None

    @property
    def num_markers_found(self) -> int:
        return len(self.marker_pixel_centers)


class ArucoMatTracker:
    def __init__(
        self,
        mat_width_mm: float = 1000.0,
        mat_height_mm: float = 1500.0,
        aruco_dict=DEFAULT_ARUCO_DICT,
        corner_marker_ids: Tuple[int, int, int, int] = CORNER_MARKER_IDS,
    ):
        self.mat_space_corners = default_mat_space_corners(mat_width_mm, mat_height_mm)
        self.corner_marker_ids = corner_marker_ids
        self._dictionary = cv2.aruco.getPredefinedDictionary(aruco_dict)
        self._detector_params = cv2.aruco.DetectorParameters()
        self._detector = cv2.aruco.ArucoDetector(self._dictionary, self._detector_params)
        self._last_result = DetectionResult()

    def detect_markers(self, frame) -> Dict[int, Tuple[float, float]]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        corners, ids, _ = self._detector.detectMarkers(gray)
        centers: Dict[int, Tuple[float, float]] = {}
        if ids is not None:
            for marker_corners, marker_id in zip(corners, ids.flatten()):
                pts = marker_corners.reshape(4, 2)
                center = pts.mean(axis=0)
                centers[int(marker_id)] = (float(center[0]), float(center[1]))
        return centers

    def compute_homography(self, pixel_centers: Dict[int, Tuple[float, float]]):
        if not all(mid in pixel_centers for mid in self.corner_marker_ids):
            return None, None, None

        src = np.array([pixel_centers[mid] for mid in self.corner_marker_ids], dtype=np.float32)
        dst = np.array([self.mat_space_corners[mid] for mid in self.corner_marker_ids], dtype=np.float32)

        homography, _ = cv2.findHomography(src, dst, method=0)
        if homography is None:
            return None, None, None
        homography_inv = np.linalg.inv(homography)

        reprojected = cv2.perspectiveTransform(src.reshape(-1, 1, 2), homography).reshape(-1, 2)
        error = float(np.mean(np.linalg.norm(reprojected - dst, axis=1)))

        return homography, homography_inv, error

    def process_frame(self, frame) -> DetectionResult:
        centers = self.detect_markers(frame)
        homography, homography_inv, error = self.compute_homography(centers)

        result = DetectionResult(
            marker_pixel_centers=centers,
            homography=homography,
            homography_inv=homography_inv,
            reprojection_error_mm=error,
        )
        if homography is not None:
            self._last_result = result
        else:
            # Keep the last good homography (e.g. one marker briefly
            # occluded) but report current marker visibility.
            self._last_result = DetectionResult(
                marker_pixel_centers=centers,
                homography=self._last_result.homography,
                homography_inv=self._last_result.homography_inv,
                reprojection_error_mm=self._last_result.reprojection_error_mm,
            )
        return self._last_result

    @staticmethod
    def pixel_to_mat(homography: np.ndarray, point: Tuple[float, float]) -> Tuple[float, float]:
        pt = np.array([[point]], dtype=np.float32)
        out = cv2.perspectiveTransform(pt, homography)
        return float(out[0, 0, 0]), float(out[0, 0, 1])

    @staticmethod
    def mat_to_pixel(homography_inv: np.ndarray, point: Tuple[float, float]) -> Tuple[float, float]:
        return ArucoMatTracker.pixel_to_mat(homography_inv, point)
