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
    straightLaunchFrac: 0.3, // how far sideways (as a fraction of maxLateralFrac) the initial launch direction alone carries the ball by the end of the flight
    curveGrowthPower: 3, // spin-driven curvature grows as t^curveGrowthPower rather than linearly with distance
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  /**
   * Sample the shot's top-down shape at `steps + 1` evenly spaced points
   * (t = 0..1 inclusive), for drawing or for progressive reveal animation.
   * `shot` is expected to look like a GSPro-style BallData object:
   * { HLA, VLA, SpinAxis, CarryDistance }.
   *
   * The lateral (x) offset is a straight component plus a curve component:
   *  - straight: proportional to t (distance traveled) - where the ball
   *    is actually heading right off the club, dominated by the face
   *    angle via HLA (see computeHlaFromFacePath in the caller).
   *  - curve: grows as t^curveGrowthPower rather than linearly, so
   *    there's essentially no visible bend in the first few feet after
   *    impact. Real sidespin-driven curvature compounds with hang
   *    time/distance - it doesn't bend the ball immediately off the
   *    clubface, and a real ball's flight looks close to straight until
   *    well into its arc.
   * At t=1 the total offset matches hlaFrac*maxLateralFrac*straightLaunchFrac
   * + curveFrac*maxLateralFrac regardless of curveGrowthPower, so the
   * final landing position (and CarryDistance labeling) is unaffected by
   * this shaping - only how the ball visibly gets there changes.
   */
  function sampleShotPath(shot, options, steps) {
    steps = steps || 60;
    const opts = Object.assign({}, DEFAULTS, options || {});
    const ballData = shot.BallData || shot;

    const hla = ballData.HLA || 0;
    const spinAxis = ballData.SpinAxis || 0;
    const carry = ballData.CarryDistance || 0;

    const distanceFrac = clamp(carry / opts.maxCarryYds, 0, 1);
    const hlaFrac = clamp(hla / opts.maxHlaDeg, -1, 1);
    const curveFrac = clamp(spinAxis / opts.maxSpinAxisDeg, -1, 1);

    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const straightX = hlaFrac * opts.maxLateralFrac * opts.straightLaunchFrac * t;
      const curveX = curveFrac * opts.maxLateralFrac * Math.pow(t, opts.curveGrowthPower);
      points.push({ x: straightX + curveX, y: distanceFrac * t });
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
    sampleShotPath,
    easeOutCubic,
    smashFactor,
  };
});
