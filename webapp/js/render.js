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
    alignmentLine: "#39ff14", // lime
    shotPath: "#ffffff",
    shotHead: "#ffff00", // yellow
    text: "#ffffff",
  };

  function clearCanvas(ctx, width, height) {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Map a normalized shot-path point ({x in [-1,1], y in [0,1]}) to canvas
   * pixel coordinates. Impact point sits at the horizontal center, near
   * the bottom of the canvas; +y draws upward (away from the golfer).
   */
  function shotPointToCanvas(pt, width, height, options) {
    const opts = Object.assign({ marginPx: 40, xRangeFrac: 0.42 }, options || {});
    const cx = width / 2;
    const originY = height - opts.marginPx;
    const usableHeight = height - opts.marginPx * 2;
    const usableHalfWidth = width * opts.xRangeFrac;

    return {
      x: cx + pt.x * usableHalfWidth,
      y: originY - pt.y * usableHeight,
    };
  }

  function drawShotPath(ctx, width, height, pathPoints, progress, options) {
    const revealCount = Math.max(1, Math.round(pathPoints.length * progress));
    const visible = pathPoints.slice(0, revealCount);
    if (visible.length < 2) return;

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

    const head = shotPointToCanvas(visible[visible.length - 1], width, height, options);
    ctx.fillStyle = COLORS.shotHead;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
    ctx.fill();
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

  function drawStatsOverlay(ctx, width, stats) {
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    stats.forEach((line, i) => {
      ctx.fillText(line, 24, 24 + i * 44);
    });
  }

  return {
    COLORS,
    clearCanvas,
    shotPointToCanvas,
    drawShotPath,
    drawAlignmentLine,
    drawStatsOverlay,
  };
});
