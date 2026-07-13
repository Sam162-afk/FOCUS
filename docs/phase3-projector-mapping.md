# Phase 3: Projector Output Mapping

## What's implemented

`projector/calibration.py` — `ProjectorCalibration`: solves a homography
from the render canvas's rectangle to the 4 corners of the intended
output area as seen on the physical floor (keystone correction), via
`cv2.getPerspectiveTransform`. Two ways to apply it, both derived from
the same homography:

1. `warp_image()` — physically warp a rendered frame with OpenCV. Useful
   for offline preview/testing tooling (and for a Python-rendered
   pipeline, if we ever needed one).
2. `to_css_matrix3d()` — convert the homography into a CSS
   `matrix3d(...)` transform string. This is the path actually used in
   production: the Phase 5 kiosk web app applies this transform directly
   to its fullscreen render container (`#stage` in `webapp/index.html`),
   so the browser pre-warps its own output and sends it straight to the
   projector's HDMI input — no separate capture/warp process needed.

The CSS conversion is covered by a test
(`test_homography_to_css_matrix3d_matches_direct_homography`) that
reconstructs the 4x4 CSS matrix from the generated string and checks it
against `cv2.perspectiveTransform` on the same points directly — i.e. it
verifies the CSS technique is mathematically equivalent to the OpenCV
homography, not just that it runs.

## One-time calibration (needs real projector + floor)

```bash
python3 -m projector.calibration --canvas-width 1920 --canvas-height 1080 \
    --camera 0 --save projector_calibration.json
```

Project a full-white test pattern (or just point the camera at the
actual projected output), then click the 4 corners of the intended
output area in the preview window, in order: top-left, top-right,
bottom-right, bottom-left. This writes `projector_calibration.json`,
which `bridge/server.py` picks up automatically and serves to the
renderer as a `cssMatrix3d` string via `/api/config`.

This step is inherently interactive and hardware-dependent (needs a
display + a camera pointed at the real floor), so it isn't
automated-tested — the pure homography/CSS math it depends on is.
