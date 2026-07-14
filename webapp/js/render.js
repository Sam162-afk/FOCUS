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
    boxBorder: "rgba(245, 242, 234, 0.3)",
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
      { topMarginPx: 40, bottomMarginPx: 260, xRangeFrac: 0.42, belowOriginPxPerUnit: 700 },
      options || {}
    );
    const cx = width / 2;
    const originY = height - opts.bottomMarginPx;
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
   * the shot trace (white, outcome).
   */
  function drawTargetLine(ctx, width, height, options) {
    const origin = shotPointToCanvas({ x: 0, y: 0 }, width, height, options);
    ctx.save();
    ctx.strokeStyle = COLORS.targetLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(origin.x, 0);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Where the clubface was actually aimed at impact: a dashed line through
   * the impact point at faceAngleDeg, extended both toward the target and
   * back through the clubhead, so you can see face-to-target versus the
   * fixed target line at a glance. Computed directly in canvas-pixel space
   * (not normalized shot-space) so it stays perfectly straight through the
   * approach/flight zones, which use different pixel-per-unit scales.
   */
  function drawFaceLine(ctx, width, height, faceAngleDeg, options) {
    const pos = shotPointToCanvas({ x: 0, y: 0 }, width, height, options);
    const angleRad = (faceAngleDeg * Math.PI) / 180;
    const dirX = Math.sin(angleRad);
    const dirY = -Math.cos(angleRad);
    const extend = Math.max(width, height) * 1.5;

    ctx.save();
    ctx.strokeStyle = COLORS.faceLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(pos.x - dirX * extend, pos.y - dirY * extend);
    ctx.lineTo(pos.x + dirX * extend, pos.y + dirY * extend);
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
   * Draw the real, camera-tracked stance/alignment line. `footMatPoints`
   * is a pair of {x, y} points in mat-space millimeters; `matSize` is
   * {widthMm, heightMm}. Drawn as a full-width line through the two feet,
   * extended to the canvas edges so it reads as an aim reference.
   */
  function drawAlignmentLine(ctx, width, height, footMatPoints, matSize) {
    if (!footMatPoints) return;
    const [left, right] = footMatPoints;

    const toCanvas = (pt) => ({
      x: (pt.x / matSize.widthMm) * width,
      y: (pt.y / matSize.heightMm) * height,
    });

    const p1 = toCanvas(left);
    const p2 = toCanvas(right);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const extend = Math.max(width, height);

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
   */
  function drawFootOutlines(ctx, width, height, footMatPoints, matSize, options) {
    if (!footMatPoints) return;
    const opts = Object.assign({ footLengthPx: 46, footWidthPx: 22 }, options || {});
    const [left, right] = footMatPoints;

    const toCanvas = (pt) => ({
      x: (pt.x / matSize.widthMm) * width,
      y: (pt.y / matSize.heightMm) * height,
    });

    const p1 = toCanvas(left);
    const p2 = toCanvas(right);
    // Note: under ctx.rotate(theta), local "+y" (the foot's toe direction
    // in the path below) already ends up perpendicular to a rotate-by-theta
    // reference direction - so using the stance line's own angle here
    // (not stanceAngle + 90deg) is what makes the foot point across the
    // stance line rather than lying flat along it.
    const footAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    const hw = opts.footWidthPx / 2;
    const hl = opts.footLengthPx / 2;

    [p1, p2].forEach((center) => {
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(footAngle);
      ctx.strokeStyle = COLORS.alignmentLine;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(0, hl);
      ctx.quadraticCurveTo(hw * 1.3, hl * 0.5, hw, 0);
      ctx.quadraticCurveTo(hw * 0.9, -hl * 0.6, hw * 0.55, -hl);
      ctx.quadraticCurveTo(0, -hl * 1.15, -hw * 0.55, -hl);
      ctx.quadraticCurveTo(-hw * 0.9, -hl * 0.6, -hw, 0);
      ctx.quadraticCurveTo(-hw * 1.3, hl * 0.5, 0, hl);
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
   * Stat overlay: each stat in its own bordered box (thin outline, label
   * top, big tabular-numeral value below), rather than free-floating text.
   * `stats` is the array of "Label: value" strings from stat-catalog.js's
   * buildStatLines().
   */
  function drawStatsOverlay(ctx, width, stats, options) {
    const opts = Object.assign({ boxWidth: 210, boxHeight: 64, gap: 10, startX: 24, startY: 24 }, options || {});
    let y = opts.startY;

    stats.forEach((line) => {
      const separatorIndex = line.indexOf(": ");
      const label = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      const value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 2);

      ctx.strokeStyle = COLORS.boxBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(opts.startX, y, opts.boxWidth, opts.boxHeight);

      ctx.fillStyle = COLORS.textDim;
      ctx.font = "600 12px ui-sans-serif, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.letterSpacing = "2px";
      ctx.fillText(label.toUpperCase(), opts.startX + 14, y + 10);
      ctx.letterSpacing = "0px";

      ctx.fillStyle = COLORS.text;
      ctx.font = "700 28px ui-monospace, 'SF Mono', Consolas, monospace";
      ctx.fillText(value, opts.startX + 14, y + 28);

      y += opts.boxHeight + opts.gap;
    });
  }

  return {
    COLORS,
    clearCanvas,
    shotPointToCanvas,
    drawDistanceGuides,
    drawTargetLine,
    drawFaceLine,
    drawShotPath,
    drawAlignmentLine,
    drawFootOutlines,
    drawClubhead,
    drawStatsOverlay,
  };
});
