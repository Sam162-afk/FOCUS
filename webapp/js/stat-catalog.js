/**
 * Shared catalog of stats the kiosk overlay can show, and the resolution
 * logic to turn a chosen stat id + a shot into a display string. Used by
 * both the setup wizard (to offer a picker) and app.js (to render
 * whichever stats were picked), so the two can never drift out of sync.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(typeof require !== "undefined" ? require("./animation.js") : root.FocusAnim);
  } else {
    root.FocusStats = factory(root.FocusAnim);
  }
})(typeof self !== "undefined" ? self : this, function (FocusAnim) {
  "use strict";

  function getPath(obj, path) {
    return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  const CATALOG = [
    { id: "clubPath", label: "Club Path", path: "ClubData.Path", unit: "°", decimals: 1 },
    { id: "faceToTarget", label: "Face-to-Target", path: "ClubData.FaceToTarget", unit: "°", decimals: 1 },
    { id: "smashFactor", label: "Smash Factor", path: null, decimals: 2 },
    { id: "carryDistance", label: "Carry (yd)", path: "BallData.CarryDistance", unit: "", decimals: 1 },
    { id: "ballSpeed", label: "Ball Speed (mph)", path: "BallData.Speed", unit: "", decimals: 1 },
    { id: "clubSpeed", label: "Club Speed", path: "ClubData.Speed", unit: " mph", decimals: 1 },
    { id: "spinAxis", label: "Spin Axis", path: "BallData.SpinAxis", unit: "°", decimals: 1 },
    { id: "totalSpin", label: "Total Spin", path: "BallData.TotalSpin", unit: " rpm", decimals: 0 },
    { id: "sideSpin", label: "Side Spin (rpm)", path: null, unit: "", decimals: 0 },
    { id: "backSpin", label: "Back Spin (rpm)", path: null, unit: "", decimals: 0 },
    { id: "hla", label: "HLA", path: "BallData.HLA", unit: "°", decimals: 1 },
    { id: "vla", label: "VLA", path: "BallData.VLA", unit: "°", decimals: 1 },
  ];

  const DEFAULT_STAT_IDS = ["carryDistance", "ballSpeed", "sideSpin", "backSpin"];
  const MAX_STATS = 4;

  function findStat(id) {
    return CATALOG.find((s) => s.id === id) || null;
  }

  /**
   * Side/back spin are the standard decomposition of a launch monitor's
   * total spin + spin axis into components relative to the target line:
   * backSpin is the component along the spin axis's cosine (pure
   * backspin at axis 0), sideSpin the sine component (curve-inducing).
   */
  function sideSpin(shot) {
    const totalSpin = getPath(shot, "BallData.TotalSpin");
    const spinAxis = getPath(shot, "BallData.SpinAxis");
    if (typeof totalSpin !== "number" || typeof spinAxis !== "number") return null;
    return totalSpin * Math.sin((spinAxis * Math.PI) / 180);
  }
  function backSpin(shot) {
    const totalSpin = getPath(shot, "BallData.TotalSpin");
    const spinAxis = getPath(shot, "BallData.SpinAxis");
    if (typeof totalSpin !== "number" || typeof spinAxis !== "number") return null;
    return totalSpin * Math.cos((spinAxis * Math.PI) / 180);
  }

  /** Compute the raw numeric value for a stat id from a shot, or null if unavailable. */
  function resolveStatValue(shot, statId) {
    if (statId === "smashFactor") return FocusAnim.smashFactor(shot);
    if (statId === "sideSpin") return sideSpin(shot);
    if (statId === "backSpin") return backSpin(shot);
    const stat = findStat(statId);
    if (!stat) return null;
    const value = getPath(shot, stat.path);
    return typeof value === "number" ? value : null;
  }

  /** Format one stat as a display line, e.g. "Club Path: -2.1°". Returns null if the shot doesn't have this stat. */
  function formatStatLine(shot, statId) {
    const stat = findStat(statId);
    if (!stat) return null;
    const value = resolveStatValue(shot, statId);
    if (value === null || value === undefined) return null;
    return `${stat.label}: ${value.toFixed(stat.decimals)}${stat.unit || ""}`;
  }

  /** Build the overlay's stat lines for a shot from an ordered list of stat ids (max MAX_STATS). */
  function buildStatLines(shot, statIds) {
    const ids = (statIds && statIds.length ? statIds : DEFAULT_STAT_IDS).slice(0, MAX_STATS);
    return ids.map((id) => formatStatLine(shot, id)).filter((line) => line !== null);
  }

  return {
    CATALOG,
    DEFAULT_STAT_IDS,
    MAX_STATS,
    findStat,
    resolveStatValue,
    formatStatLine,
    buildStatLines,
  };
});
