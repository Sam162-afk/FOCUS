const test = require("node:test");
const assert = require("node:assert/strict");
const FocusClubhead = require("../../webapp/js/clubhead.js");

function shotWith(clubOverrides) {
  return { ClubData: Object.assign({ Path: 0, FaceToTarget: 0, ClosureRate: 0, HorizontalFaceImpact: 0, VerticalFaceImpact: 0 }, clubOverrides) };
}

test("straight path (Path=0) starts the approach directly behind the ball", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ Path: 0 }));
  assert.equal(state.start.x, 0);
  assert.ok(state.start.y < 0, "approach start should be behind the impact point (negative y)");
  assert.deepEqual(state.impact, { x: 0, y: 0 });
});

test("positive club path offsets the approach start to the right", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ Path: 10 }));
  assert.ok(state.start.x > 0);
});

test("negative club path offsets the approach start to the left", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ Path: -10 }));
  assert.ok(state.start.x < 0);
});

test("zero closure rate means the face angle never changes during the approach", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: -3, ClosureRate: 0 }));
  assert.equal(state.startFaceAngleDeg, -3);
  const early = FocusClubhead.sampleClubheadFrame(state, 0.2);
  const late = FocusClubhead.sampleClubheadFrame(state, 0.9);
  assert.equal(early.faceAngleDeg, -3);
  assert.equal(late.faceAngleDeg, -3);
});

test("nonzero closure rate makes the face angle change (close) over the approach", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: -2, ClosureRate: 200 }));
  const start = FocusClubhead.sampleClubheadFrame(state, 0);
  const mid = FocusClubhead.sampleClubheadFrame(state, 0.5);
  const impact = FocusClubhead.sampleClubheadFrame(state, 1);

  assert.notEqual(start.faceAngleDeg, mid.faceAngleDeg);
  assert.equal(impact.faceAngleDeg, -2, "face angle must land exactly on FaceToTarget at impact");
  // Monotonic closing from start toward the impact angle.
  assert.ok(
    (start.faceAngleDeg > mid.faceAngleDeg && mid.faceAngleDeg > impact.faceAngleDeg) ||
      (start.faceAngleDeg < mid.faceAngleDeg && mid.faceAngleDeg < impact.faceAngleDeg)
  );
});

test("higher closure rate produces a more open starting face angle", () => {
  const slow = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: 0, ClosureRate: 50 }));
  const fast = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: 0, ClosureRate: 300 }));
  assert.ok(Math.abs(fast.startFaceAngleDeg) > Math.abs(slow.startFaceAngleDeg));
});

test("a realistic tour-level closure rate (~2000 deg/sec) sweeps a modest angle scaled to the short approach arc actually drawn, not a 70-100 degree flip", () => {
  // The 70-100 deg/0.04s research figure covers ~5-6ft of real clubhead
  // travel at swing speed - much farther than the couple of feet our
  // stylized approach arc depicts - so the swept angle here is scaled
  // down to match the shorter visual distance instead of applied as-is.
  const state = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: 0, ClosureRate: 2000 }));
  const sweep = state.startFaceAngleDeg - state.faceToTarget;
  assert.ok(sweep > 5 && sweep <= 35, `expected a modest approach sweep, got ${sweep} degrees`);
});

test("an extreme/noisy closure rate is clamped rather than spinning the clubhead through multiple rotations", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: 0, ClosureRate: 50000 }));
  const sweep = state.startFaceAngleDeg - state.faceToTarget;
  assert.ok(sweep <= 35, `expected the approach sweep to be clamped, got ${sweep} degrees`);
});

test("face rotation eases in (starts slow, whips shut right before impact) rather than rotating at a constant rate", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: 0, ClosureRate: 2000 }));
  const totalSweep = state.startFaceAngleDeg - state.faceToTarget;
  const quarter = state.startFaceAngleDeg - FocusClubhead.sampleClubheadFrame(state, 0.25).faceAngleDeg;
  const lateSwing = state.startFaceAngleDeg - FocusClubhead.sampleClubheadFrame(state, 0.9).faceAngleDeg;
  // A linear rotation would have covered exactly 25%/90% of the sweep at
  // those points; a cubic ease-in (t^3) covers far less early (1.6% at
  // t=0.25) and most of the total by the very end (72.9% at t=0.9,
  // accelerating hard through the last stretch into impact).
  assert.ok(quarter < totalSweep * 0.1, `expected slow start, got ${quarter} of ${totalSweep} by t=0.25`);
  assert.ok(lateSwing > totalSweep * 0.6, `expected most of the sweep done by t=0.9, got ${lateSwing} of ${totalSweep}`);
});

test("sampleClubheadFrame reports atImpact only at progress 1", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({}));
  assert.equal(FocusClubhead.sampleClubheadFrame(state, 0.99).atImpact, false);
  assert.equal(FocusClubhead.sampleClubheadFrame(state, 1).atImpact, true);
});

test("sampleClubheadFrame lerps position from start to impact", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ Path: 10 }));
  const start = FocusClubhead.sampleClubheadFrame(state, 0).position;
  const mid = FocusClubhead.sampleClubheadFrame(state, 0.5).position;
  const end = FocusClubhead.sampleClubheadFrame(state, 1).position;

  assert.deepEqual(start, state.start);
  assert.deepEqual(end, { x: 0, y: 0 });
  assert.ok(mid.x > end.x && mid.x < start.x || mid.x < end.x && mid.x > start.x || mid.x === start.x / 2);
  assert.equal(mid.y, state.start.y / 2);
});

test("toe strike (positive horizontal impact) normalizes to a positive value", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: 0.6 }));
  assert.ok(state.horizontalImpactNorm > 0);
});

test("heel strike (negative horizontal impact) normalizes to a negative value", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: -0.6 }));
  assert.ok(state.horizontalImpactNorm < 0);
});

test("horizontal and vertical impact norms clamp to [-1, 1] beyond the configured range", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: 5, VerticalFaceImpact: -5 }));
  assert.equal(state.horizontalImpactNorm, 1);
  assert.equal(state.verticalImpactNorm, -1);
});

test("follow-through starts exactly at the impact point", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ Path: 8 }));
  const frame = FocusClubhead.sampleFollowThroughFrame(state, 0);
  assert.deepEqual(frame.position, { x: 0, y: 0 });
});

test("follow-through continues downrange (positive y) past impact", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({}));
  const frame = FocusClubhead.sampleFollowThroughFrame(state, 1);
  assert.ok(frame.position.y > 0, "expected the follow-through to move in the downrange (+y) direction");
});

test("follow-through continues in the same lateral direction the approach was moving, not a mirror-image swing-back", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ Path: 10 }));
  // Approach for a positive path starts to the right (x>0) and moves toward x=0 at impact.
  // Follow-through should continue that leftward-moving trend past impact (end up at x<0).
  const end = FocusClubhead.sampleFollowThroughFrame(state, 1).position;
  assert.ok(end.x < 0, `expected follow-through to continue past impact to the opposite side, got x=${end.x}`);
});

test("follow-through frames are never reported atImpact", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({}));
  assert.equal(FocusClubhead.sampleFollowThroughFrame(state, 0).atImpact, false);
  assert.equal(FocusClubhead.sampleFollowThroughFrame(state, 1).atImpact, false);
});

test("face angle continues rotating in the same direction through the follow-through", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: -2, ClosureRate: 200 }));
  // During approach the angle decreases toward faceToTarget (see the closure-rate test above).
  const atImpact = FocusClubhead.sampleClubheadFrame(state, 1).faceAngleDeg;
  const afterFollowThrough = FocusClubhead.sampleFollowThroughFrame(state, 1).faceAngleDeg;
  assert.ok(afterFollowThrough < atImpact, "expected the face to keep closing (angle decreasing) past impact");
});

test("follow-through continued closing is a modest, clamped amount even at tour-level closure rates", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: 0, ClosureRate: 2000 }));
  const sweep = state.faceToTarget - state.followThroughFaceAngleDeg;
  assert.ok(sweep > 0 && sweep <= 25, `expected a modest, clamped follow-through sweep, got ${sweep} degrees`);
});

test("rotation rate carries through impact instead of abruptly slowing down - the follow-through's initial rate matches the approach's rate right at impact", () => {
  // Both easing curves are cubic, so each phase's progress-derivative at
  // the impact instant is 3x its total sweep. Matching real-time rate
  // across the two phases (which run for different real durations) means
  // approachSweep/APPROACH_MS should equal followThroughSweep/FOLLOW_THROUGH_MS.
  const APPROACH_MS = 1950;
  const FOLLOW_THROUGH_MS = 1200;
  const state = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: 0, ClosureRate: 2000 }));
  const approachSweep = state.startFaceAngleDeg - state.faceToTarget;
  const followThroughSweep = state.faceToTarget - state.followThroughFaceAngleDeg;
  const approachRate = approachSweep / APPROACH_MS;
  const followThroughRate = followThroughSweep / FOLLOW_THROUGH_MS;
  const relError = Math.abs(approachRate - followThroughRate) / approachRate;
  assert.ok(relError < 0.02, `expected matching rotation rates across impact, approach=${approachRate}, followThrough=${followThroughRate}`);
});

test("zero closure rate means the face angle holds steady through follow-through too", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ FaceToTarget: 4, ClosureRate: 0 }));
  const frame = FocusClubhead.sampleFollowThroughFrame(state, 1);
  assert.equal(frame.faceAngleDeg, 4);
});

test("impact marker stays visible briefly into the follow-through, then hides", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: 0.6 }));
  assert.equal(FocusClubhead.sampleFollowThroughFrame(state, 0).showImpactMarker, true);
  assert.equal(FocusClubhead.sampleFollowThroughFrame(state, 0.1).showImpactMarker, true);
  assert.equal(FocusClubhead.sampleFollowThroughFrame(state, 0.9).showImpactMarker, false);
  assert.equal(FocusClubhead.sampleFollowThroughFrame(state, 1).showImpactMarker, false);
});

test("approach frames only show the impact marker at the very last frame", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: 0.6 }));
  assert.equal(FocusClubhead.sampleClubheadFrame(state, 0.5).showImpactMarker, false);
  assert.equal(FocusClubhead.sampleClubheadFrame(state, 1).showImpactMarker, true);
});
