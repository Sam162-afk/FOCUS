/**
 * Impact/ball-flight reconstruction: draws the ball's initial launch
 * trajectory right off the club. The projected mat is only a few feet
 * across, so the entire drawn line represents roughly the first 3 feet of
 * real flight - not a compressed/scaled-down version of the whole shot.
 * Over a distance that short, real sidespin-driven curvature hasn't had
 * time to show up yet (it compounds with hang time/distance over the
 * course of the full flight), so the line is drawn straight, in the
 * initial launch direction (dominated by face angle via HLA - see
 * computeHlaFromFacePath in the caller). The shot's actual carry distance
 * and curvature are reported as numbers (stat boxes), not depicted as a
 * longer or more curved line - the mat physically can't show a real 200+
 * yard flight arc.
 *
 * Coordinate system: normalized top-down mat view, x in roughly [-1, 1]
 * (0 = target line, +x = right of target), y in [0, 1] (0 = impact point
 * at the golfer's position).
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
    maxHlaDeg: 15, // HLA magnitude that maps to full initial-direction lateral offset
    maxLateralFrac: 0.6, // how far sideways (as a fraction of the x range) full HLA offset bends the shot
    straightLaunchFrac: 0.3, // how far sideways (as a fraction of maxLateralFrac) the initial launch direction carries the ball over the drawn segment
    visibleFlightFrac: 0.3, // how far up the screen the drawn segment extends - fixed for every shot, since it represents the same short real distance (a few feet) regardless of the shot's actual carry
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  /**
   * Sample the shot's initial launch trajectory at `steps + 1` evenly
   * spaced points (t = 0..1 inclusive), for drawing or for progressive
   * reveal animation. `shot` is expected to look like a GSPro-style
   * BallData object: { HLA, VLA, SpinAxis, CarryDistance }.
   *
   * A straight line in the initial launch direction (dominated by face
   * angle via HLA) - see the module doc comment for why this doesn't
   * scale with carry distance or bend with spin axis.
   */
  function sampleShotPath(shot, options, steps) {
    steps = steps || 60;
    const opts = Object.assign({}, DEFAULTS, options || {});
    const ballData = shot.BallData || shot;

    const hla = ballData.HLA || 0;
    const hlaFrac = clamp(hla / opts.maxHlaDeg, -1, 1);

    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = hlaFrac * opts.maxLateralFrac * opts.straightLaunchFrac * t;
      const y = opts.visibleFlightFrac * t;
      points.push({ x, y });
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
