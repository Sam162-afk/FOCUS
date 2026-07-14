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
    approachDurationSec: 0.65, // stylization only - how long the visual approach takes
    approachDistanceNorm: 0.32, // how far "behind" the ball the clubhead starts, in normalized units
    maxPathDeg: 15, // club path magnitude that maps to full lateral approach-line offset
    maxApproachLateralFrac: 0.35,
    maxHorizontalImpactIn: 0.75, // +/- inches from center that maps to the full face-line half-width
    maxVerticalImpactIn: 0.5,
    labelThreshold: 0.4, // |normalized impact| above which we call out a toe/heel/high/low strike
    followThroughDurationSec: 0.4, // stylization only - how long the visual follow-through takes
    followThroughDistanceNorm: 0.24, // how far past impact the clubhead swings through, in normalized units
    followThroughClosureFrac: 0.35, // fraction of the approach's closure that continues past impact
    impactMarkerHoldFrac: 0.3, // fraction of the follow-through the impact-point marker/label stays visible for
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

    // The face was more open by (closureRate * approachDurationSec) one
    // approach-phase-worth of time before impact, closing down to
    // faceToTarget exactly at contact.
    const startFaceAngleDeg = faceToTarget + closureRate * opts.approachDurationSec;

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
    const followThroughFaceAngleDeg =
      faceToTarget - closureRate * opts.followThroughDurationSec * opts.followThroughClosureFrac;

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
      faceAngleDeg: lerp(state.startFaceAngleDeg, state.faceToTarget, t),
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
      faceAngleDeg: lerp(state.faceToTarget, state.followThroughFaceAngleDeg, t),
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
