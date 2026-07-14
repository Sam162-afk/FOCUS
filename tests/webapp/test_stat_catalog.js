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

test("formatStatLine formats carry distance with the unit folded into the label, not the value", () => {
  // Matches a real projected display: the big glowing number is just the
  // digits ("141.5"), the unit lives in the small label beside it.
  assert.equal(FocusStats.formatStatLine(SAMPLE_SHOT, "carryDistance"), "Carry (yd): 220.5");
});

test("formatStatLine decomposes side spin and back spin from total spin + spin axis", () => {
  const totalSpin = 4200;
  const spinAxis = -4.7;
  const expectedSide = (totalSpin * Math.sin((spinAxis * Math.PI) / 180)).toFixed(0);
  const expectedBack = (totalSpin * Math.cos((spinAxis * Math.PI) / 180)).toFixed(0);
  assert.equal(FocusStats.formatStatLine(SAMPLE_SHOT, "sideSpin"), `Side Spin (rpm): ${expectedSide}`);
  assert.equal(FocusStats.formatStatLine(SAMPLE_SHOT, "backSpin"), `Back Spin (rpm): ${expectedBack}`);
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
  assert.deepEqual(lines, ["Ball Speed (mph): 148.5"]);
});
