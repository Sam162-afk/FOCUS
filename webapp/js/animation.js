/**
 * Impact/ball-flight reconstruction: turns per-shot launch-monitor numbers
 * into a stylized, physically-plausible top-down shot-shape curve. This is
 * NOT a physics simulation - it's a "shot shape visualization" (see the
 * project plan's framing note), tuned to look right rather than to match
 * real trajectories frame-for-frame.
 *
 * Coordinate system: normalized top-down mat view, x in roughly [-1, 1]
 * (0 = target line, +x = right of target), y in [0, 1] (0 = impact point
 * at the golfer's position, 1 = the configured max display distance).
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.FocusAnim = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULTS = {
    maxCarryYds: 300, // carry distance that maps to y = 1 (clamped beyond this)
    maxSpinAxisDeg: 45, // spin axis magnitude that maps to full curve strength
    maxLateralFrac: 0.6, // how far sideways (as a fraction of the x range) full curve strength bends the shot
    maxHlaDeg: 15, // HLA magnitude that maps to full initial-direction lateral offset
    initialDirectionFrac: 0.35, // how far up the curve (0..1) the initial HLA direction control point sits
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  /**
   * Quadratic Bezier evaluated at parameter t in [0, 1].
   */
  function quadraticBezier(p0, p1, p2, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    };
  }

  /**
   * Compute the quadratic Bezier control points for a shot's top-down
   * shape, given ball-flight numbers. `shot` is expected to look like a
   * GSPro-style BallData object: { HLA, VLA, SpinAxis, CarryDistance }.
   */
  function computeShotControlPoints(shot, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const ballData = shot.BallData || shot;

    const hla = ballData.HLA || 0;
    const spinAxis = ballData.SpinAxis || 0;
    const carry = ballData.CarryDistance || 0;

    const distanceFrac = clamp(carry / opts.maxCarryYds, 0, 1);
    const endY = distanceFrac;

    const hlaFrac = clamp(hla / opts.maxHlaDeg, -1, 1);
    const curveFrac = clamp(spinAxis / opts.maxSpinAxisDeg, -1, 1);

    const p0 = { x: 0, y: 0 };

    // Control point: sits a short way up the curve, offset per the initial
    // launch direction (HLA), so the tangent near impact reflects where
    // the ball actually started heading.
    const p1Y = endY * opts.initialDirectionFrac;
    const p1 = {
      x: hlaFrac * opts.maxLateralFrac * 0.5,
      y: p1Y,
    };

    // End point: initial-direction contribution plus spin-driven curvature
    // that compounds with distance (a draw/fade gets more pronounced the
    // further the ball travels).
    const p2 = {
      x: hlaFrac * opts.maxLateralFrac * 0.3 + curveFrac * opts.maxLateralFrac,
      y: endY,
    };

    return { p0, p1, p2 };
  }

  /**
   * Sample the shot's shape curve at `steps + 1` evenly spaced points
   * (t = 0..1 inclusive), for drawing or for progressive reveal animation.
   */
  function sampleShotPath(shot, options, steps) {
    steps = steps || 60;
    const { p0, p1, p2 } = computeShotControlPoints(shot, options);
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push(quadraticBezier(p0, p1, p2, t));
    }
    return points;
  }

  function easeOutCubic(t) {
    const mt = 1 - t;
    return 1 - mt * mt * mt;
  }

  function smashFactor(shot) {
    const ballSpeed = (shot.BallData && shot.BallData.Speed) || 0;
    const clubSpeed = (shot.ClubData && shot.ClubData.Speed) || 0;
    if (!clubSpeed) return null;
    return ballSpeed / clubSpeed;
  }

  return {
    DEFAULTS,
    clamp,
    degToRad,
    quadraticBezier,
    computeShotControlPoints,
    sampleShotPath,
    easeOutCubic,
    smashFactor,
  };
});
