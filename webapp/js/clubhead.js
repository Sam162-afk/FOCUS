/**
 * Clubhead approach + impact visualization: a short stylized swing arc
 * ending at the ball, with the face closing into its impact angle and a
 * marker showing where on the face contact happened (toe/heel/high/low)
 * - the actual origin of "gear effect" curvature. Like animation.js's
 * ball-flight math, this is a stylized reconstruction tuned to look
 * right, not a swing-physics simulation.
 *
 * Shares animation.js's normalized coordinate system: x in [-1, 1]
 * (0 = target line), y in [0, 1] (0 = impact point). The clubhead
 * approaches from behind the ball, i.e. from negative y, arriving at
 * (0, 0) exactly at the end of the approach phase.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.FocusClubhead = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULTS = {
    approachDistanceNorm: 0.32, // how far "behind" the ball the clubhead starts, in normalized units
    maxPathDeg: 15, // club path magnitude that maps to full lateral approach-line offset
    maxApproachLateralFrac: 0.35,
    maxHorizontalImpactIn: 0.75, // +/- inches from center that maps to the full face-line half-width
    maxVerticalImpactIn: 0.5,
    labelThreshold: 0.4, // |normalized impact| above which we call out a toe/heel/high/low strike
    followThroughDistanceNorm: 0.24, // how far past impact the clubhead swings through, in normalized units
    impactMarkerHoldFrac: 0.3, // fraction of the follow-through the impact-point marker/label stays visible for
    // Real clubface closure is fast and concentrated right before impact -
    // PGA Tour closure rates run roughly 1,500-3,500 deg/sec, with ~70-100
    // degrees of the total closing happening in just the last ~0.04s of
    // the downswing (golf.com "What is rate of closure?"; GolfWRX "What it
    // really takes to square the clubface at impact"). These convert the
    // launch monitor's ClosureRate (deg/sec) into a total rotation SWEPT
    // during the stylized approach/follow-through - not real elapsed-time
    // durations - clamped so noisy or unusually high closure-rate data
    // can't spin the graphic through multiple full rotations.
    closureWindowSec: 0.045,
    maxApproachFaceSweepDeg: 120,
    followThroughClosureWindowSec: 0.01,
    maxFollowThroughFaceSweepDeg: 35,
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpPoint(a, b, t) {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  }

  // The face doesn't close at a constant rate - real swings hold the face
  // relatively open through most of the downswing and then whip it shut
  // in the final instant before impact (see the closure-rate research
  // cited on DEFAULTS above), then keep rotating briefly on residual
  // momentum right after impact before tapering off. Easing the
  // interpolation (rather than a plain lerp) reproduces that "snap
  // shut, then settle" shape instead of a uniform spin.
  function easeInCubic(t) {
    return t * t * t;
  }

  function easeOutCubic(t) {
    const mt = 1 - t;
    return 1 - mt * mt * mt;
  }

  /**
   * Precompute the fixed parts of the clubhead's swing for a shot: where
   * it starts, the face angle it starts at (extrapolated backward from
   * ClosureRate), and where the impact-point marker sits on the face.
   */
  function computeClubheadState(shot, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const clubData = shot.ClubData || {};

    const path = clubData.Path || 0;
    const faceToTarget = clubData.FaceToTarget || 0;
    const closureRate = clubData.ClosureRate || 0; // deg/sec, magnitude = how fast the face is closing
    const horizontalImpact = clubData.HorizontalFaceImpact || 0; // inches, + = toe side, - = heel side
    const verticalImpact = clubData.VerticalFaceImpact || 0; // inches, + = high face, - = low face

    const pathFrac = clamp(path / opts.maxPathDeg, -1, 1);

    const impact = { x: 0, y: 0 };
    const start = {
      x: pathFrac * opts.maxApproachLateralFrac,
      y: -opts.approachDistanceNorm,
    };

    // The face was more open by this much before the final whip shut into
    // impact - see the closure-window comment on DEFAULTS for where the
    // conversion factor and clamp bound come from.
    const approachSweepDeg = clamp(closureRate * opts.closureWindowSec, 0, opts.maxApproachFaceSweepDeg);
    const startFaceAngleDeg = faceToTarget + approachSweepDeg;

    const horizontalImpactNorm = clamp(horizontalImpact / opts.maxHorizontalImpactIn, -1, 1);
    const verticalImpactNorm = clamp(verticalImpact / opts.maxVerticalImpactIn, -1, 1);

    let label = null;
    if (Math.abs(horizontalImpactNorm) >= opts.labelThreshold) {
      label = horizontalImpactNorm > 0 ? "TOE STRIKE" : "HEEL STRIKE";
    } else if (Math.abs(verticalImpactNorm) >= opts.labelThreshold) {
      label = verticalImpactNorm > 0 ? "HIGH FACE" : "LOW FACE";
    }

    // Follow-through: the club doesn't stop at impact - it continues
    // through along roughly the same line of travel (start -> impact,
    // extrapolated past impact), and the face keeps rotating briefly in
    // the same direction it was closing, just decelerating.
    const followThroughScale = opts.followThroughDistanceNorm / opts.approachDistanceNorm;
    const followThroughEnd = {
      x: -start.x * followThroughScale,
      y: opts.followThroughDistanceNorm,
    };
    const followThroughSweepDeg = clamp(closureRate * opts.followThroughClosureWindowSec, 0, opts.maxFollowThroughFaceSweepDeg);
    const followThroughFaceAngleDeg = faceToTarget - followThroughSweepDeg;

    return {
      start,
      impact,
      followThroughEnd,
      impactMarkerHoldFrac: opts.impactMarkerHoldFrac,
      startFaceAngleDeg,
      faceToTarget,
      followThroughFaceAngleDeg,
      closureRate,
      horizontalImpactNorm,
      verticalImpactNorm,
      label,
    };
  }

  /**
   * Sample the clubhead's position and face angle at a point in the
   * approach (progress 0 = start of swing, 1 = ball contact).
   */
  function sampleClubheadFrame(state, progress) {
    const t = clamp(progress, 0, 1);
    const atImpact = t >= 1;
    return {
      position: lerpPoint(state.start, state.impact, t),
      faceAngleDeg: lerp(state.startFaceAngleDeg, state.faceToTarget, easeInCubic(t)),
      atImpact,
      showImpactMarker: atImpact,
      inApproach: true,
    };
  }

  /**
   * Sample the clubhead's position and face angle at a point in the
   * follow-through (progress 0 = right at impact, 1 = end of the visual
   * follow-through arc). The impact-point marker/label stay visible for
   * the first `impactMarkerHoldFrac` of the follow-through so they're
   * actually legible, rather than flashing for a single frame at impact.
   */
  function sampleFollowThroughFrame(state, progress) {
    const t = clamp(progress, 0, 1);
    return {
      position: lerpPoint(state.impact, state.followThroughEnd, t),
      faceAngleDeg: lerp(state.faceToTarget, state.followThroughFaceAngleDeg, easeOutCubic(t)),
      atImpact: false,
      showImpactMarker: t < state.impactMarkerHoldFrac,
      inApproach: false,
    };
  }

  return {
    DEFAULTS,
    computeClubheadState,
    sampleClubheadFrame,
    sampleFollowThroughFrame,
  };
});
