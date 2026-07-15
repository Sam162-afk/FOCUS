/**
 * Canvas drawing routines for the kiosk display: alignment line, shot-shape
 * animation, and the stat overlay. Pure-black background so the render
 * disappears into a dark mat and only the graphics show (see project plan
 * Component 5's design constraints).
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.FocusRender = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const COLORS = {
    background: "#000000",
    alignmentLine: "#4ade80", // refined spring green, not traffic-cone lime
    shotPath: "#f5f2ea", // warm off-white, not flat #fff
    shotHead: "#ffb020", // warm amber, not pure yellow
    text: "#f5f2ea",
    textDim: "#9a9d8f",
    gridLine: "rgba(74, 222, 128, 0.14)",
    gridLabel: "rgba(154, 157, 143, 0.65)",
    targetLine: "rgba(245, 242, 234, 0.32)", // neutral dashed reference, distinct from the tracked stance line
    faceLine: "rgba(255, 176, 32, 0.55)", // dashed amber - ties to the impact-derived data family
    clubPathLine: "rgba(96, 165, 250, 0.6)", // dashed blue - distinct from the amber face line and neutral target line
    boxBorder: "rgba(245, 242, 234, 0.35)",
  };

  function clearCanvas(ctx, width, height) {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Map a normalized shot-path point ({x in [-1,1], y in [0,1]}) to canvas
   * pixel coordinates. Impact point sits at the horizontal center; +y
   * draws upward (away from the golfer, ball-flight territory), using
   * topMarginPx as the gap reserved above the y=1 ball-flight ceiling.
   * Negative y (behind the impact point, where the clubhead approaches
   * from - see clubhead.js) is its own dedicated zone below the origin,
   * sized by bottomMarginPx/belowOriginPxPerUnit, so the swing has real
   * visible room instead of being squeezed into a thin sliver at the
   * canvas edge.
   */
  function shotPointToCanvas(pt, width, height, options) {
    const opts = Object.assign(
      { topMarginPx: 40, bottomMarginPx: 260, xRangeFrac: 0.42, belowOriginPxPerUnit: 700, originPx: null },
      options || {}
    );
    // originPx lets callers anchor the whole shot-space animation (target
    // line, clubhead, ball flight) at a real tracked canvas position - e.g.
    // the golfer's actual ball position, computed from their tracked feet
    // (see computeBallMatPosition) - instead of a fixed canvas point that's
    // unrelated to where they're actually standing.
    const cx = opts.originPx ? opts.originPx.x : width / 2;
    const originY = opts.originPx ? opts.originPx.y : height - opts.bottomMarginPx;
    const usableHeight = height - opts.bottomMarginPx - opts.topMarginPx;
    const usableHalfWidth = width * opts.xRangeFrac;
    const y = pt.y >= 0 ? originY - pt.y * usableHeight : originY - pt.y * opts.belowOriginPxPerUnit;

    return {
      x: cx + pt.x * usableHalfWidth,
      y,
    };
  }

  /**
   * Faint yardage guide-lines behind the shot trace, so a curving line has
   * some sense of scale instead of floating in an empty void. Starts past
   * the impact zone (not at 0) to avoid clutter around the feet/clubhead.
   */
  function drawDistanceGuides(ctx, width, height, options) {
    const opts = Object.assign({ maxCarryYds: 300, intervalYds: 50, startYds: 100 }, options || {});
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 1;
    ctx.font = "12px ui-monospace, 'SF Mono', Consolas, monospace";
    ctx.fillStyle = COLORS.gridLabel;
    ctx.textAlign = "right"; // right edge - the stat overlay lives in the top-left
    ctx.textBaseline = "middle";
    for (let yds = opts.startYds; yds < opts.maxCarryYds; yds += opts.intervalYds) {
      const pt = shotPointToCanvas({ x: 0, y: yds / opts.maxCarryYds }, width, height, options);
      ctx.beginPath();
      ctx.moveTo(0, pt.y);
      ctx.lineTo(width, pt.y);
      ctx.stroke();
      ctx.fillText(`${yds}`, width - 16, pt.y - 10);
    }
  }

  /**
   * The fixed, ideal aim line (straight toward the target, independent of
   * any particular shot or the golfer's actual stance) - a dashed neutral
   * reference distinct from both the tracked stance line (green, real) and
   * the shot trace (white, outcome). Passes straight through the ball in
   * both directions (toward the target, and back behind the ball toward
   * the golfer), not just a ray pointing away from it. Bounded to a fixed
   * length rather than the full canvas - a real reference line doesn't
   * extend to infinity, and stretching it that far visually exaggerates
   * even a near-square stance's small natural angle into what looks like
   * a bad diagonal miss.
   */
  function drawTargetLine(ctx, width, height, options) {
    const opts = Object.assign({ extentPx: 380 }, options || {});
    const origin = shotPointToCanvas({ x: 0, y: 0 }, width, height, options);
    const top = Math.max(0, origin.y - opts.extentPx);
    const bottom = Math.min(height, origin.y + opts.extentPx);
    ctx.save();
    ctx.strokeStyle = COLORS.targetLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(origin.x, top);
    ctx.lineTo(origin.x, bottom);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The actual line the clubhead was traveling on through impact (club
   * path), extrapolated both back through the approach and forward past
   * the ball - distinct from drawTargetLine's straight-at-the-target
   * reference. Reuses clubheadState's own start/impact canvas points
   * (already encode the path-driven lateral lean from clubhead.js) rather
   * than a separate angle formula, so this always agrees exactly with how
   * the clubhead itself is drawn approaching the ball. Extrapolated in
   * canvas-pixel space (like drawTargetLine's extentPx) rather than in
   * shot-space before mapping - shotPointToCanvas uses a different y-scale
   * above vs. below the origin, so a shot-space chord through impact would
   * bend at the ball instead of drawing as one straight line.
   */
  function drawClubPathLine(ctx, width, height, clubheadState, options) {
    if (!clubheadState) return;
    const opts = Object.assign({ extentPx: 380 }, options || {});
    const startPx = shotPointToCanvas(clubheadState.start, width, height, options);
    const impactPx = shotPointToCanvas(clubheadState.impact, width, height, options);
    const dx = impactPx.x - startPx.x;
    const dy = impactPx.y - startPx.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const p1 = { x: impactPx.x - ux * opts.extentPx, y: impactPx.y - uy * opts.extentPx };
    const p2 = { x: impactPx.x + ux * opts.extentPx, y: impactPx.y + uy * opts.extentPx };
    ctx.save();
    ctx.strokeStyle = COLORS.clubPathLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawShotPath(ctx, width, height, pathPoints, progress, options) {
    const revealCount = Math.max(1, Math.round(pathPoints.length * progress));
    const visible = pathPoints.slice(0, revealCount);
    if (visible.length < 2) return;

    ctx.save();
    ctx.shadowColor = COLORS.shotPath;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = COLORS.shotPath;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    visible.forEach((pt, i) => {
      const canvasPt = shotPointToCanvas(pt, width, height, options);
      if (i === 0) ctx.moveTo(canvasPt.x, canvasPt.y);
      else ctx.lineTo(canvasPt.x, canvasPt.y);
    });
    ctx.stroke();
    ctx.restore();

    const head = shotPointToCanvas(visible[visible.length - 1], width, height, options);
    ctx.save();
    ctx.shadowColor = COLORS.shotHead;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLORS.shotHead;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (progress >= 1 && options && options.landingLabel) {
      ctx.fillStyle = COLORS.shotHead;
      ctx.font = "700 20px ui-monospace, 'SF Mono', Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(options.landingLabel, head.x + 14, head.y);
    }
  }

  /**
   * Map a mat-space point (millimeters, +y = downrange/target direction -
   * see vision/mat_tracker.py) to canvas pixels. Flips y so mat +y maps to
   * decreasing canvas y ("up the screen"), matching shotPointToCanvas's
   * convention that the target direction is up - without this, the
   * tracked stance line and the shot/target lines would disagree about
   * which way "toward the target" even points on screen.
   */
  function matPointToCanvas(pt, width, height, matSize) {
    return {
      x: (pt.x / matSize.widthMm) * width,
      y: height - (pt.y / matSize.heightMm) * height,
    };
  }

  /**
   * Shift both tracked foot points perpendicular to the stance line, by
   * `offsetMm` in the direction `side` picks (+1/-1 - a physical-setup
   * detail, same ambiguity as computeBallMatPosition's `side`, fixed at
   * calibration time). Shared by the ball-position offset (large, ~club
   * length) and the toe-line offset (small, ~half a foot length) below.
   */
  function offsetAcrossStance(footMatPoints, offsetMm, side) {
    const [left, right] = footMatPoints;
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const len = Math.hypot(dx, dy) || 1;
    const stanceUx = dx / len;
    const stanceUy = dy / len;
    const perpUx = -stanceUy * side;
    const perpUy = stanceUx * side;
    return [
      { x: left.x + perpUx * offsetMm, y: left.y + perpUy * offsetMm },
      { x: right.x + perpUx * offsetMm, y: right.y + perpUy * offsetMm },
    ];
  }

  /**
   * A golfer doesn't stand over the ball - at address the ball sits out in
   * front of their toes, roughly a club-length away, not between/under the
   * feet. Real-world address-position measurements (~22-26in for a mid-iron,
   * ~24in avg) are measured from the TOE LINE, not the raw tracked center
   * of each foot - so the ball's total offset from the tracked foot points
   * is `toeOffsetMm + addressDistanceMm`, not just addressDistanceMm on its
   * own, which would undershoot by however far the toe line already sits
   * from the tracked center.
   *
   * `footMatPoints` is the tracked [left, right] pair in mat-space mm.
   * Returns the estimated ball position in the same mat-space, offset
   * perpendicular to the stance line (across the golfer's toe-line, into
   * the space in front of them) rather than sitting on the stance line
   * itself. `options.side` flips which perpendicular direction is "in
   * front of the golfer" - this depends on which way the golfer faces
   * relative to the mat's coordinate axes, a physical-setup detail fixed
   * at calibration time, not something derivable from two foot points alone.
   */
  function computeBallMatPosition(footMatPoints, options) {
    const opts = Object.assign({ toeOffsetMm: 130, addressDistanceMm: 600, forwardOffsetMm: 0, side: 1 }, options || {});
    const [left, right] = footMatPoints;
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const len = Math.hypot(dx, dy) || 1;
    const stanceUx = dx / len;
    const stanceUy = dy / len;

    const totalOffsetMm = opts.toeOffsetMm + opts.addressDistanceMm;
    const [shiftedLeft, shiftedRight] = offsetAcrossStance(footMatPoints, totalOffsetMm, opts.side);
    const shiftedMidX = (shiftedLeft.x + shiftedRight.x) / 2;
    const shiftedMidY = (shiftedLeft.y + shiftedRight.y) / 2;

    return {
      x: shiftedMidX + stanceUx * opts.forwardOffsetMm,
      y: shiftedMidY + stanceUy * opts.forwardOffsetMm,
    };
  }

  /**
   * Draw the real, camera-tracked stance/alignment line. `footMatPoints`
   * is a pair of {x, y} points in mat-space millimeters; `matSize` is
   * {widthMm, heightMm}. Drawn as a line through the two feet, extended a
   * bounded distance (not to the canvas edges) so it reads as an aim
   * reference. Offset toward the ball side by `toeOffsetMm` (default
   * ~130mm, roughly half a shoe length) so the line reads as running
   * along the toes - the real alignment reference golfers use - rather
   * than through the tracked center of each foot.
   *
   * The extend length is deliberately bounded rather than spanning the
   * whole canvas: stretching a line that far visually exaggerates even a
   * near-square stance's small natural angle (a couple degrees is normal
   * tracking noise) into what reads as a bad diagonal miss.
   */
  function drawAlignmentLine(ctx, width, height, footMatPoints, matSize, options) {
    if (!footMatPoints) return;
    const opts = Object.assign({ toeOffsetMm: 130, side: 1, extentPx: 380 }, options || {});
    const [left, right] = offsetAcrossStance(footMatPoints, opts.toeOffsetMm, opts.side);

    const p1 = matPointToCanvas(left, width, height, matSize);
    const p2 = matPointToCanvas(right, width, height, matSize);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const extend = opts.extentPx;

    ctx.strokeStyle = COLORS.alignmentLine;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p1.x - ux * extend, p1.y - uy * extend);
    ctx.lineTo(p2.x + ux * extend, p2.y + uy * extend);
    ctx.stroke();
  }

  /**
   * Draw a stylized footprint outline at each tracked foot position, in
   * addition to the straight alignment line. We only track each foot's
   * center point (not its individual rotation - see vision/foot_detector.py),
   * so each outline is drawn pointing perpendicular to the stance line,
   * approximating a square stance rather than reflecting real per-foot flare.
   *
   * Anchored at the same toe-offset point as drawAlignmentLine (not the
   * raw tracked center), with the shoe shape drawn entirely behind that
   * point (toe at the anchor, heel trailing back) - like a real alignment
   * rod laid across the toes, with the foot behind it, rather than a
   * rod floating detached from the foot shape.
   */
  function drawFootOutlines(ctx, width, height, footMatPoints, matSize, options) {
    if (!footMatPoints) return;
    const opts = Object.assign({ footLengthPx: 46, footWidthPx: 22, toeOffsetMm: 130, side: 1 }, options || {});
    const [left, right] = offsetAcrossStance(footMatPoints, opts.toeOffsetMm, opts.side);

    const p1 = matPointToCanvas(left, width, height, matSize);
    const p2 = matPointToCanvas(right, width, height, matSize);
    // Note: under ctx.rotate(theta), local "+y" (the foot's toe direction
    // in the path below) already ends up perpendicular to a rotate-by-theta
    // reference direction - so using the stance line's own angle here
    // (not stanceAngle + 90deg) is what makes the foot point across the
    // stance line rather than lying flat along it.
    const footAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    const hw = opts.footWidthPx / 2;
    const hl = opts.footLengthPx / 2;

    [p1, p2].forEach((toeAnchor) => {
      ctx.save();
      ctx.translate(toeAnchor.x, toeAnchor.y);
      ctx.rotate(footAngle);
      ctx.strokeStyle = COLORS.alignmentLine;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(hw * 1.3, -hl * 0.5, hw, -hl);
      ctx.quadraticCurveTo(hw * 0.9, -hl * 1.6, hw * 0.55, -hl * 2);
      ctx.quadraticCurveTo(0, -hl * 2.15, -hw * 0.55, -hl * 2);
      ctx.quadraticCurveTo(-hw * 0.9, -hl * 1.6, -hw, -hl);
      ctx.quadraticCurveTo(-hw * 1.3, -hl * 0.5, 0, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    });
  }

  /**
   * Draw the clubhead as a thin wireframe outline (matching the alignment
   * line's line-art style, not a filled/solid shape) at its current
   * animated position and face angle. `clubheadState` is from
   * clubhead.js's computeClubheadState(); `frame` is from
   * sampleClubheadFrame() for the current animation progress. At impact,
   * draws the toe/heel/high/low contact-point marker on the face.
   */
  function drawClubhead(ctx, width, height, clubheadState, frame, options) {
    const opts = Object.assign({ faceHalfWidthPx: 34 }, options || {});
    const fw = opts.faceHalfWidthPx;
    const pos = shotPointToCanvas(frame.position, width, height, options);

    if (frame.inApproach && !frame.atImpact) {
      const startPos = shotPointToCanvas(clubheadState.start, width, height, options);
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = COLORS.shotPath;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startPos.x, startPos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate((frame.faceAngleDeg * Math.PI) / 180);

    // Asymmetric iron/wedge-head silhouette, viewed from above: a flat
    // face with a slight bulge, a rounded toe, a shorter squared heel,
    // and a hosel line - reads as "club" rather than a generic oval.
    ctx.strokeStyle = COLORS.shotPath;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const heelBack = { x: -fw * 0.8, y: 4 };
    ctx.beginPath();
    ctx.moveTo(-fw, 0);
    ctx.quadraticCurveTo(0, -3, fw, 0); // face, slight outward bulge
    ctx.quadraticCurveTo(fw * 1.08, 10, fw * 0.85, 20); // rounded toe corner
    ctx.lineTo(-fw * 0.55, 15); // topline, tapering toward the heel
    ctx.lineTo(heelBack.x, heelBack.y); // heel back corner
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(heelBack.x, heelBack.y);
    ctx.lineTo(-fw * 1.2, -fw * 0.53); // hosel, angled up and back from the heel
    ctx.stroke();

    // Face-line: a dashed "laser sight" extension of the face edge itself,
    // past the toe and heel - not an aim/error indicator, just the face's
    // own line drawn long. Lives in the same rotated/translated local
    // space as the club, so it moves and rotates with it continuously
    // through the approach, impact, and follow-through.
    const faceExtend = fw * 3;
    ctx.save();
    ctx.strokeStyle = COLORS.faceLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(-fw - faceExtend, 0);
    ctx.lineTo(-fw, 0);
    ctx.moveTo(fw, 0);
    ctx.lineTo(fw + faceExtend, 0);
    ctx.stroke();
    ctx.restore();

    if (frame.showImpactMarker) {
      const markerX = clubheadState.horizontalImpactNorm * fw;
      ctx.fillStyle = COLORS.shotHead;
      ctx.beginPath();
      ctx.arc(markerX, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    if (frame.showImpactMarker && clubheadState.label) {
      ctx.fillStyle = COLORS.shotHead;
      ctx.font = "700 15px ui-sans-serif, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.letterSpacing = "2px";
      ctx.fillText(clubheadState.label, pos.x, pos.y - opts.faceHalfWidthPx - 6);
      ctx.letterSpacing = "0px";
    }
  }

  /**
   * Small spin-axis dial beside the ball - a best-effort guess at the
   * circular readout seen next to the ball in a real projected display's
   * reference photo (exact pixels of that graphic aren't precisely known,
   * so this is an approximation, not a measured recreation). Ties it to
   * real data rather than pure decoration: the tick shows the spin axis
   * direction (which way the shot curves), reusing the same
   * BallData.SpinAxis the side/back spin stats are decomposed from.
   */
  function drawSpinDial(ctx, width, height, origin, spinAxisDeg, options) {
    if (!origin || typeof spinAxisDeg !== "number") return;
    const opts = Object.assign({ dx: -50, dy: -70, radius: 20 }, options || {});
    const cx = origin.x + opts.dx;
    const cy = origin.y + opts.dy;

    ctx.save();
    ctx.strokeStyle = COLORS.textDim;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = COLORS.text;
    ctx.shadowBlur = 4;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, opts.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 0deg axis points toward the target (up); positive axis curves right.
    const angleRad = (-90 + spinAxisDeg) * (Math.PI / 180);
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angleRad) * opts.radius, cy + Math.sin(angleRad) * opts.radius);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Stat overlay: bordered boxes in a single row, each with a small label
   * and a big value - like a real launch-monitor readout strip. The whole
   * row is rotated 90deg around the ball position so it reads right-side
   * up for the golfer standing at address (to the side of the ball, along
   * the stance line) rather than for a bird's-eye viewer looking from
   * behind the ball toward the target. `stats` is the array of
   * "Label: value" strings from stat-catalog.js's buildStatLines().
   * Falls back to a plain unrotated vertical list at a fixed position
   * when no `options.origin` (ball canvas point) is tracked yet.
   */
  function drawStatsOverlay(ctx, width, stats, options) {
    const opts = Object.assign(
      {
        origin: null,
        startX: 24,
        startY: 24,
        lineHeight: 70,
        boxWidth: 150,
        boxHeight: 110,
        gap: 10,
        offsetX: 70,
        offsetY: -20,
        rotationDeg: 90,
      },
      options || {}
    );

    if (!opts.origin) {
      // No ball position tracked yet - fall back to a plain, unrotated
      // vertical list at a fixed corner.
      let y = opts.startY;
      stats.forEach((line) => {
        const separatorIndex = line.indexOf(": ");
        const label = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
        const value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 2);
        ctx.save();
        ctx.translate(opts.startX, y);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = COLORS.textDim;
        ctx.font = "700 13px ui-sans-serif, sans-serif";
        ctx.letterSpacing = "1.5px";
        ctx.fillText(label.toUpperCase(), 0, 0);
        ctx.letterSpacing = "0px";
        ctx.fillStyle = COLORS.text;
        ctx.font = "800 28px ui-sans-serif, sans-serif";
        ctx.fillText(value, 0, 28);
        ctx.restore();
        y += opts.lineHeight;
      });
      return;
    }

    const n = stats.length;
    const totalWidth = n * opts.boxWidth + Math.max(0, n - 1) * opts.gap;
    const rotationRad = (opts.rotationDeg * Math.PI) / 180;

    ctx.save();
    ctx.translate(opts.origin.x + opts.offsetX, opts.origin.y + opts.offsetY);
    ctx.rotate(rotationRad);

    let x = -totalWidth / 2;
    const y = -opts.boxHeight / 2;
    stats.forEach((line) => {
      const separatorIndex = line.indexOf(": ");
      const label = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      const value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 2);

      ctx.strokeStyle = COLORS.boxBorder;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, opts.boxWidth, opts.boxHeight);

      ctx.textAlign = "center";
      ctx.fillStyle = COLORS.textDim;
      ctx.font = "700 12px ui-sans-serif, sans-serif";
      ctx.textBaseline = "top";
      ctx.letterSpacing = "1.5px";
      ctx.fillText(label.toUpperCase(), x + opts.boxWidth / 2, y + 14);
      ctx.letterSpacing = "0px";

      ctx.fillStyle = COLORS.text;
      ctx.font = "800 28px ui-sans-serif, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(value, x + opts.boxWidth / 2, y + opts.boxHeight / 2 + 14);

      x += opts.boxWidth + opts.gap;
    });
    ctx.restore();
  }

  return {
    COLORS,
    clearCanvas,
    shotPointToCanvas,
    matPointToCanvas,
    computeBallMatPosition,
    drawDistanceGuides,
    drawTargetLine,
    drawClubPathLine,
    drawShotPath,
    drawAlignmentLine,
    drawFootOutlines,
    drawClubhead,
    drawSpinDial,
    drawStatsOverlay,
  };
});
