# DIY Floor Projection System ("Focus Clone") — Project Plan

## What this is
A software system that turns any cheap projector + webcam + GSPro/launch monitor into a floor-projected impact readout similar to Foresight's FOCUS system — at a fraction of the cost ($200–400 in hardware vs. $10,995 + $2,000 install).

It does **not** attempt real motion capture. It reconstructs a plausible, physics-consistent animation of the swing/impact/ball flight from the shot numbers, while showing real camera-tracked foot position and alignment.

---

## Architecture Overview

```
┌─────────────────┐     ┌──────────────┐     ┌───────────────┐
│ Launch Monitor   │────▶│ GSPro Proxy   │────▶│ Main App       │
│ software         │     │ (data tap)    │     │ (Python/Node)  │
│ (Club Optix etc) │     │              │     │               │
└─────────────────┘     └──────┬───────┘     └───────┬───────┘
                                │ forwards            │
                                ▼ unchanged            │
                         ┌──────────────┐              │
                         │   GSPro       │              │
                         └──────────────┘              │
                                                         │
┌─────────────────┐                                     │
│ Overhead Webcam  │────────────────────────────────────┤
│ (foot/marker      │                                    │
│  tracking)        │                                    │
└─────────────────┘                                     │
                                                         ▼
                                              ┌─────────────────────┐
                                              │ Renderer / UI layer  │
                                              │ (fullscreen kiosk)   │
                                              └──────────┬──────────┘
                                                          │ HDMI
                                                          ▼
                                              ┌─────────────────────┐
                                              │ Floor projector      │
                                              └─────────────────────┘
```

---

## Component 1: GSPro Data Tap

**Goal:** get per-shot JSON (ball data + club data) without breaking the normal Club Optix → GSPro connection.

**Approach:** Write a lightweight TCP proxy that:
1. Listens on the port Club Optix currently points at (the port GSPro normally opens).
2. Opens its own outbound connection to GSPro's real Open Connect port.
3. For every message received from Club Optix: (a) forward it untouched to GSPro, (b) parse a copy for your own app.
4. Point Club Optix's GSPro IP/port setting at the proxy instead of GSPro directly. GSPro never knows the difference.

**Data available per shot (confirmed from GSPro Open Connect v1 docs):**
- Ball: Speed, SpinAxis, TotalSpin/BackSpin/SideSpin, HLA, VLA, CarryDistance
- Club: Speed, AngleOfAttack, FaceToTarget, Lie, Loft, Path, SpeedAtImpact, VerticalFaceImpact, HorizontalFaceImpact, ClosureRate

**Risk/open question:** Confirm Club Optix actually lets you point its "GSPro IP" setting at an arbitrary local address (should be fine — it's just a TCP target config, same as pointing it at localhost vs a LAN IP). Test this first before building anything else — it's the one piece with real uncertainty.

**Stack:** Python (`socket` + `json`), or Node (`net` module). Python recommended — simplest for a proxy this size.

---

## Component 2: Camera / Vision System

**Goal:** know where the mat is, where the golfer's feet are, and re-anchor automatically if the camera moves.

**Hardware:** any USB webcam with a reasonably wide FOV, mounted overhead pointing down at the hitting area. 1080p is plenty.

**Setup:**
1. Print 4 ArUco (or AprilTag) markers, place them at the fixed corners of the hitting/mat zone.
2. Use OpenCV's built-in `cv2.aruco` module to detect the 4 markers every frame and compute a homography (camera pixel space → real-world mat space).
3. This runs continuously — if the camera gets bumped, the next frame just re-solves the mapping. No manual recalibration step in normal operation.

**Foot detection:**
- Simplest version: background subtraction / contour detection to find the two roughly-stationary blobs (shoes) once the golfer sets up and camera motion settles.
- Slightly better version: a lightweight pose model (e.g., MediaPipe Pose or a small pretrained foot-keypoint model) run on the camera frame — more robust to different shoe colors/lighting than blob detection.
- Output: two (x,y) points in mat-space → draw a line through them for the stance/alignment line relative to the target line (target line = known from your marker layout, since you defined the mat orientation during marker placement).

**Stack:** Python + OpenCV (`opencv-python`, `opencv-contrib-python` for ArUco). MediaPipe if going the pose-model route.

---

## Component 3: Projector Output Mapping

**Goal:** whatever you render needs to land correctly on the floor regardless of projector angle/position.

**Setup:**
1. One-time: project a full-white test pattern with 4 visible corner markers (or just click the 4 visible corners of your intended output area as seen on the actual floor).
2. Compute a second homography: your render canvas → projector output, so a warped/keystoned trapezoid on the physical floor still shows an undistorted rectangle to the golfer's eye.
3. Combine with the camera homography from Component 2 so mat-space coordinates (foot positions, ball position) map correctly into projector output coordinates.

**Stack:** Same OpenCV homography math (`cv2.findHomography` / `cv2.warpPerspective`), applied to your rendered frame before sending it to the projector's HDMI output.

---

## Component 4: Impact/Ball-Flight Reconstruction (the "animation")

**Goal:** generate a stylized, physically-plausible animation of impact + ball flight from the GSPro numbers — not real motion capture.

**Inputs used per shot:**
- Club Path, FaceToTarget (or Face-to-Target/closure rate) → determines clubhead approach angle/orientation at a generated impact point
- Ball Speed, Smash Factor (derived from ball speed / club speed) → drives ball exit speed in the animation
- SpinAxis / SideSpin, TotalSpin → drives curvature (draw/fade bend) in the rendered ball-flight arc
- HLA/VLA → initial launch direction and angle

**Animation logic (simplified physics, not simulation-grade):**
1. Draw a short idealized clubhead arc approaching a fixed impact point, angled per Club Path.
2. At impact, orient a face-angle indicator per FaceToTarget.
3. Animate the ball leaving the impact point along a curve: start direction from HLA, then bend left/right over the course of the animation proportional to spin axis/side spin — a simple parametric curve (e.g., a quadratic Bezier bent by a curvature term) is enough; you don't need real aerodynamic simulation for this to look convincing.
4. Keep animation short (under 1 second) — it's a stylized replay, not a full flight simulation.

**Stack:** This is just rendering — can be done in the same layer as the UI (see Component 5). No physics engine needed; basic parametric curves and easing functions are enough.

**Framing to keep honest:** label this internally (and to any future users) as a "shot shape visualization," not a swing capture — it's reconstructing what a swing with these numbers generally looks like, not what actually happened frame by frame.

---

## Component 5: Renderer / UI (what actually gets projected)

**Goal:** fullscreen kiosk display showing: alignment line (real, camera-tracked) + impact/ball-flight animation (reconstructed) + 2-3 key numbers, in high-contrast form for a dim, ambient-lit bay.

**Design constraints:**
- Pure black background (not gray/dark-blue) so it disappears into the dark mat and only your graphics show.
- Bright, high-contrast colors for lines/numbers (white/yellow/lime work well on green mat + dark background).
- Keep numeric overlay to 2-3 stats max (e.g., Club Path, Face-to-Target, Smash Factor) — avoid FOCUS's instinct to cram everything on screen.
- Trigger animation automatically the moment a new shot's JSON arrives from the proxy.

**Stack recommendation:** a local web app (HTML/CSS/JS, e.g., a simple Electron or just a browser in kiosk mode) is the easiest way to do smooth animation + easy iteration, with a small local WebSocket or HTTP bridge feeding it shot data from the Python proxy/vision process. Python does data + vision, browser does rendering.

---

## Suggested Build Order (phased)

1. **Phase 0 — De-risk the data tap.** Confirm Club Optix can be pointed at a proxy address. If this doesn't work cleanly, everything downstream needs rethinking (fallback: read data directly from Club Optix's own local API/log if one exists — worth a quick search once you're in Claude Code).
2. **Phase 1 — Get shot data flowing.** Build the proxy, log parsed JSON to console/file for a few real shots. No visuals yet.
3. **Phase 2 — Camera + marker tracking.** Get ArUco detection working, confirm homography holds up with the camera in its actual mounted position.
4. **Phase 3 — Projector mapping.** Get a simple test pattern (e.g., a grid) projecting undistorted onto the actual floor area.
5. **Phase 4 — Foot detection + alignment line.** Get the real, camera-driven line working and validated against actual foot position.
6. **Phase 5 — Animation renderer.** Build the impact/ball-flight reconstruction using dummy/sample GSPro JSON first, refine the curve math for realism.
7. **Phase 6 — Wire it all together.** Real shot → proxy → animation trigger → projected output, end to end.
8. **Phase 7 — Polish.** Lighting/contrast tuning in the actual bay, timing/easing tweaks, maybe a settings screen for which 2-3 stats to show.

---

## Hardware Shopping List (approximate)

| Item | Est. Cost |
|---|---|
| Overhead webcam (1080p USB) | $30–60 |
| Floor projector (1080p, 2000–3000 lumens, standard throw) | $150–300 |
| Ceiling/wall mount for projector | $20–40 |
| Printed ArUco markers | ~$5 (cardstock/print shop) |
| Mini PC or repurposed laptop to run it all | $0 (if reusing sim PC) or $150–250 |
| **Total** | **~$200–650 per bay** |

vs. Foresight FOCUS at $10,995 + $2,000 install = $12,995/bay.

---

## Open Questions to Resolve Early (flag these in Claude Code)

1. Can Club Optix's GSPro target IP/port actually be redirected to a proxy? (Phase 0 blocker — test first.)
2. Does your specific launch monitor (Uneekor EYE XR) populate the full ClubData object, or only partial fields? Confirm with a real logged shot.
3. How much variance is there in ball/foot detection reliability under actual bay lighting — may need to tune contrast/thresholds on-site rather than purely in code.
