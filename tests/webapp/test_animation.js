const test = require("node:test");
const assert = require("node:assert/strict");
const FocusAnim = require("../../webapp/js/animation.js");

test("straight shot (no HLA, no spin axis) stays on the target line", () => {
  const shot = { BallData: { HLA: 0, SpinAxis: 0, CarryDistance: 200 } };
  const path = FocusAnim.sampleShotPath(shot, {}, 20);
  for (const pt of path) {
    assert.ok(Math.abs(pt.x) < 1e-9, `expected x~=0, got ${pt.x}`);
  }
  assert.ok(path[path.length - 1].y > 0 && path[path.length - 1].y <= 1);
});

test("positive HLA sends the ball right from the start", () => {
  const shot = { BallData: { HLA: 10, SpinAxis: 0, CarryDistance: 200 } };
  const path = FocusAnim.sampleShotPath(shot, {}, 20);
  assert.ok(path[1].x > 0, "expected early path points to move right of target line");
});

test("negative HLA sends the ball left from the start", () => {
  const shot = { BallData: { HLA: -10, SpinAxis: 0, CarryDistance: 200 } };
  const path = FocusAnim.sampleShotPath(shot, {}, 20);
  assert.ok(path[1].x < 0, "expected early path points to move left of target line");
});

test("spin-axis curvature compounds with distance (draw/fade shape)", () => {
  const shot = { BallData: { HLA: 0, SpinAxis: 20, CarryDistance: 250 } };
  const path = FocusAnim.sampleShotPath(shot, {}, 100);
  const at = (frac) => path[Math.round(frac * (path.length - 1))];

  const early = Math.abs(at(0.3).x);
  const late = Math.abs(at(0.9).x);
  assert.ok(late > early, `expected curve to grow with distance, got early=${early} late=${late}`);
});

test("carry distance beyond the display cap clamps endY to 1", () => {
  const shot = { BallData: { HLA: 0, SpinAxis: 0, CarryDistance: 999 } };
  const path = FocusAnim.sampleShotPath(shot, { maxCarryYds: 300 }, 10);
  assert.equal(path[path.length - 1].y, 1);
});

test("longer (but under-cap) carry produces a proportionally longer path", () => {
  const shortShot = { BallData: { HLA: 0, SpinAxis: 0, CarryDistance: 100 } };
  const longShot = { BallData: { HLA: 0, SpinAxis: 0, CarryDistance: 250 } };
  const shortPath = FocusAnim.sampleShotPath(shortShot, {}, 10);
  const longPath = FocusAnim.sampleShotPath(longShot, {}, 10);
  assert.ok(longPath[longPath.length - 1].y > shortPath[shortPath.length - 1].y);
});

test("smashFactor divides ball speed by club speed", () => {
  const shot = { BallData: { Speed: 148.5 }, ClubData: { Speed: 99.0 } };
  assert.ok(Math.abs(FocusAnim.smashFactor(shot) - 148.5 / 99.0) < 1e-9);
});

test("smashFactor is null when club speed is missing", () => {
  const shot = { BallData: { Speed: 148.5 } };
  assert.equal(FocusAnim.smashFactor(shot), null);
});

test("easeOutCubic runs from 0 to 1 and is monotonically increasing", () => {
  assert.equal(FocusAnim.easeOutCubic(0), 0);
  assert.equal(FocusAnim.easeOutCubic(1), 1);
  let prev = -1;
  for (let t = 0; t <= 1; t += 0.1) {
    const v = FocusAnim.easeOutCubic(t);
    assert.ok(v >= prev);
    prev = v;
  }
});
