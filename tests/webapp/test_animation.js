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

test("spin axis has no effect on the drawn line - the whole line represents only the first few feet of flight, too short for curvature to show up", () => {
  const straight = FocusAnim.sampleShotPath({ BallData: { HLA: 6, SpinAxis: 0, CarryDistance: 250 } }, {}, 40);
  const curved = FocusAnim.sampleShotPath({ BallData: { HLA: 6, SpinAxis: 45, CarryDistance: 250 } }, {}, 40);
  for (let i = 0; i < straight.length; i++) {
    assert.ok(Math.abs(straight[i].x - curved[i].x) < 1e-9, `expected identical paths regardless of SpinAxis at point ${i}`);
  }
});

test("the drawn line is straight (collinear points) for a nonzero HLA", () => {
  const shot = { BallData: { HLA: 8, SpinAxis: 30, CarryDistance: 250 } };
  const path = FocusAnim.sampleShotPath(shot, {}, 40);
  const end = path[path.length - 1];
  for (const pt of path) {
    // Cross product of (pt - p0) and (end - p0) is ~0 for collinear points.
    const cross = pt.x * end.y - pt.y * end.x;
    assert.ok(Math.abs(cross) < 1e-9, `expected point (${pt.x}, ${pt.y}) collinear with the end point, cross=${cross}`);
  }
});

test("carry distance does not change the drawn line's length - the mat can't show a real 200+ yard flight, only the first few feet", () => {
  const shortShot = { BallData: { HLA: 5, SpinAxis: 0, CarryDistance: 80 } };
  const longShot = { BallData: { HLA: 5, SpinAxis: 0, CarryDistance: 300 } };
  const shortPath = FocusAnim.sampleShotPath(shortShot, {}, 10);
  const longPath = FocusAnim.sampleShotPath(longShot, {}, 10);
  assert.equal(shortPath[shortPath.length - 1].y, longPath[longPath.length - 1].y);
  assert.equal(shortPath[shortPath.length - 1].x, longPath[longPath.length - 1].x);
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
