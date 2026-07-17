# Phase 2: Camera / Vision — ArUco Tracking + Foot Detection

## What's implemented

- `vision/aruco_tracker.py` — `ArucoMatTracker`: detects 4 ArUco markers
  (`DICT_4X4_50`, ids 0-3) placed at the corners of the mat, and solves a
  homography from camera pixel-space to real-world mat-space (millimeters).
  Runs every frame; if a marker briefly drops out (occlusion, motion blur)
  the last good homography is held over rather than dropping calibration.
  Marker layout (looking down from above):

  ```
  id 0 -------- id 1      (back-left --------- back-right)
    |             |
    |    mat      |
    |             |
  id 3 -------- id 2      (front-left -------- front-right)
  ```

- `vision/foot_detector.py` — `FootDetector`: MOG2 background subtraction
  + contour detection to find the two largest plausible foot-sized blobs,
  reported once they've held steady for `settle_frames` consecutive
  frames (so a hand passing through frame, or the golfer still walking
  in, doesn't get reported as a stance).

- `vision/mat_tracker.py` — `MatTracker`: combines both into one state:
  is the mat calibrated, where are the feet in mat-space mm, and the
  stance/alignment angle (0° = square to target, computed from the
  stance-line vector relative to the mat's x-axis, which is perpendicular
  to the target line by construction of the marker layout).

## Testing without a live camera

All three modules are unit tested against synthetically generated frames
(`tests/test_aruco_tracker.py`, `tests/test_foot_detector.py`,
`tests/test_mat_tracker.py`) — real ArUco marker images pasted at known
pixel coordinates, and painted foot-shaped blobs — so the homography math
and detection logic are verified without needing the camera mounted yet.

```bash
pytest tests/test_aruco_tracker.py tests/test_foot_detector.py tests/test_mat_tracker.py
```

## Running against a real camera or a recorded video

```bash
python3 -m vision.mat_tracker --camera 0 --mat-width-mm 1000 --mat-height-mm 1500 --state-file mat_state.json
# or, to test against a pre-recorded clip before the camera is mounted:
python3 -m vision.mat_tracker --video sample_footage.mp4 --state-file mat_state.json
```

This continuously overwrites `mat_state.json` with the latest tracking
state; `bridge/server.py` (Phase 6) polls that file and pushes updates to
the renderer over WebSocket.

## Known tuning needed on-site (per the plan's open questions)

- `FootDetector`'s `min_area`/`max_area` (pixel²) and MOG2
  `var_threshold` are scene-dependent — they'll need retuning once real
  camera height/FOV and mat/shoe contrast are known. Defaults were chosen
  for a roughly 1080p overhead camera a few feet up; expect to adjust.
- The background-subtraction learning rate (`background_learn_frames`,
  `min_learning_rate`) trades off two failure modes: too fast and a
  golfer standing still for a while gets absorbed into the background
  (feet disappear mid-address); too slow and real lighting changes
  (e.g. a door opening) never get absorbed either. Current defaults favor
  "don't lose the feet during a normal pre-shot routine."
