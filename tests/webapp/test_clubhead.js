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

test("toe strike (positive horizontal impact) is labeled TOE STRIKE", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: 0.6 }));
  assert.equal(state.label, "TOE STRIKE");
  assert.ok(state.horizontalImpactNorm > 0);
});

test("heel strike (negative horizontal impact) is labeled HEEL STRIKE", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: -0.6 }));
  assert.equal(state.label, "HEEL STRIKE");
  assert.ok(state.horizontalImpactNorm < 0);
});

test("high face strike is labeled HIGH FACE when horizontal impact is centered", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ VerticalFaceImpact: 0.4 }));
  assert.equal(state.label, "HIGH FACE");
});

test("low face strike is labeled LOW FACE when horizontal impact is centered", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ VerticalFaceImpact: -0.4 }));
  assert.equal(state.label, "LOW FACE");
});

test("a flush, centered strike has no label", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: 0.05, VerticalFaceImpact: -0.05 }));
  assert.equal(state.label, null);
});

test("horizontal and vertical impact norms clamp to [-1, 1] beyond the configured range", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: 5, VerticalFaceImpact: -5 }));
  assert.equal(state.horizontalImpactNorm, 1);
  assert.equal(state.verticalImpactNorm, -1);
});

test("horizontal impact takes label priority over vertical when both are large", () => {
  const state = FocusClubhead.computeClubheadState(shotWith({ HorizontalFaceImpact: 0.6, VerticalFaceImpact: 0.4 }));
  assert.equal(state.label, "TOE STRIKE");
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
