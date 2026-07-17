/**
 * Pure logic for the setup wizard: building the payloads that get sent to
 * (or downloaded from) the bridge server, and validating wizard input.
 * Kept separate from setup.js's DOM wiring so it's unit testable.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.FocusWizard = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function validateMatSize(widthMm, heightMm) {
    const errors = [];
    if (!(widthMm > 0)) errors.push("Mat width must be a positive number.");
    if (!(heightMm > 0)) errors.push("Mat height must be a positive number.");
    return errors;
  }

  function validateStats(statIds, maxStats) {
    const errors = [];
    if (!statIds || statIds.length === 0) errors.push("Pick at least 1 stat to display.");
    if (statIds && statIds.length > maxStats) errors.push(`Pick at most ${maxStats} stats.`);
    return errors;
  }

  function validateCorners(corners) {
    const errors = [];
    if (!corners || corners.length !== 4) {
      errors.push("Click all 4 corners (top-left, top-right, bottom-right, bottom-left).");
      return errors;
    }
    const seen = new Set();
    for (const [x, y] of corners) {
      if (typeof x !== "number" || typeof y !== "number" || Number.isNaN(x) || Number.isNaN(y)) {
        errors.push("Corner points must be numeric pixel coordinates.");
        break;
      }
      seen.add(`${x},${y}`);
    }
    if (seen.size > 0 && seen.size < 4) errors.push("Corner points must be 4 distinct locations.");
    return errors;
  }

  /**
   * Build the /api/setup request payload (and the equivalent standalone
   * download payload - same shape either way).
   */
  function buildSetupPayload(options) {
    const { matWidthMm, matHeightMm, canvasWidth, canvasHeight, statIds, projectorCorners } = options;
    return {
      matWidthMm,
      matHeightMm,
      canvasWidth,
      canvasHeight,
      stats: statIds,
      projectorCorners: projectorCorners || null,
    };
  }

  /**
   * Split a setup payload into the two files the bridge/product actually
   * consumes: config.json (app settings) and projector_calibration.json
   * (in the exact shape projector/calibration.py's ProjectorCalibration
   * dataclass expects), for the standalone "download instead of POST"
   * fallback.
   */
  function buildDownloadFiles(payload) {
    const files = {
      "config.json": {
        matWidthMm: payload.matWidthMm,
        matHeightMm: payload.matHeightMm,
        canvasWidth: payload.canvasWidth,
        canvasHeight: payload.canvasHeight,
        stats: payload.stats,
      },
    };
    if (payload.projectorCorners) {
      files["projector_calibration.json"] = {
        canvas_size: [payload.canvasWidth, payload.canvasHeight],
        projector_corners: payload.projectorCorners,
      };
    }
    return files;
  }

  return {
    validateMatSize,
    validateStats,
    validateCorners,
    buildSetupPayload,
    buildDownloadFiles,
  };
});
