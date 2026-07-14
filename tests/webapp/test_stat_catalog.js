const test = require("node:test");
const assert = require("node:assert/strict");
const FocusStats = require("../../webapp/js/stat-catalog.js");

const SAMPLE_SHOT = {
  BallData: { Speed: 148.5, CarryDistance: 220.5, SpinAxis: -4.7, TotalSpin: 4200, HLA: -2.0, VLA: 12.0 },
  ClubData: { Speed: 99.0, Path: -2.1, FaceToTarget: -1.5 },
};

test("formatStatLine formats a simple numeric path stat", () => {
  assert.equal(FocusStats.formatStatLine(SAMPLE_SHOT, "clubPath"), "Club Path: -2.1°");
});

test("formatStatLine formats carry distance with no decimals and yds unit", () => {
  assert.equal(FocusStats.formatStatLine(SAMPLE_SHOT, "carryDistance"), "Carry Distance: 221 yds");
});

test("formatStatLine special-cases smash factor (not a direct path)", () => {
  const expected = `Smash Factor: ${(148.5 / 99.0).toFixed(2)}`;
  assert.equal(FocusStats.formatStatLine(SAMPLE_SHOT, "smashFactor"), expected);
});

test("formatStatLine returns null for an unknown stat id", () => {
  assert.equal(FocusStats.formatStatLine(SAMPLE_SHOT, "nonsense"), null);
});

test("formatStatLine returns null when the shot is missing that field", () => {
  assert.equal(FocusStats.formatStatLine({ BallData: {} }, "carryDistance"), null);
});

test("buildStatLines falls back to DEFAULT_STAT_IDS when none given", () => {
  const lines = FocusStats.buildStatLines(SAMPLE_SHOT, []);
  assert.equal(lines.length, FocusStats.DEFAULT_STAT_IDS.length);
});

test("buildStatLines caps at MAX_STATS even if more ids are requested", () => {
  const ids = ["clubPath", "faceToTarget", "smashFactor", "carryDistance", "ballSpeed"];
  const lines = FocusStats.buildStatLines(SAMPLE_SHOT, ids);
  assert.equal(lines.length, FocusStats.MAX_STATS);
});

test("buildStatLines respects a custom order and skips unavailable stats", () => {
  const shot = { BallData: { Speed: 148.5 }, ClubData: {} }; // no club Path/FaceToTarget/Speed
  const lines = FocusStats.buildStatLines(shot, ["clubPath", "ballSpeed"]);
  assert.deepEqual(lines, ["Ball Speed: 148.5 mph"]);
});
