const test = require("node:test");
const assert = require("node:assert/strict");
const FocusRender = require("../../webapp/js/render.js");
const FocusClubhead = require("../../webapp/js/clubhead.js");

function makeMockCtx() {
  const calls = [];
  return {
    calls,
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    beginPath() { calls.push(["beginPath"]); },
    moveTo(...args) { calls.push(["moveTo", ...args]); },
    lineTo(...args) { calls.push(["lineTo", ...args]); },
    quadraticCurveTo(...args) { calls.push(["quadraticCurveTo", ...args]); },
    closePath() { calls.push(["closePath"]); },
    stroke() { calls.push(["stroke"]); },
    arc(...args) { calls.push(["arc", ...args]); },
    fill() { calls.push(["fill"]); },
    fillText(...args) { calls.push(["fillText", ...args]); },
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); },
    translate(...args) { calls.push(["translate", ...args]); },
    rotate(...args) { calls.push(["rotate", ...args]); },
    set fillStyle(v) {},
    set strokeStyle(v) {},
    set lineWidth(v) {},
    set lineJoin(v) {},
    set lineCap(v) {},
    set font(v) {},
    set textAlign(v) {},
    set textBaseline(v) {},
  };
}

test("shotPointToCanvas maps impact point (0,0) to bottom-center minus margin", () => {
  const width = 800;
  const height = 600;
  const pt = FocusRender.shotPointToCanvas({ x: 0, y: 0 }, width, height);
  assert.equal(pt.x, width / 2);
  assert.equal(pt.y, height - 200); // default bottomMarginPx
});

test("shotPointToCanvas maps positive x to the right half of the canvas", () => {
  const pt = FocusRender.shotPointToCanvas({ x: 0.5, y: 0.2 }, 800, 600);
  assert.ok(pt.x > 400);
});

test("shotPointToCanvas maps y=1 near the top margin", () => {
  const height = 600;
  const pt = FocusRender.shotPointToCanvas({ x: 0, y: 1 }, 800, height);
  assert.equal(pt.y, 40); // default topMarginPx
});

test("shotPointToCanvas keeps negative y (clubhead approach zone) within canvas bounds", () => {
  // Regression test: negative y used to reuse the ball-flight scale
  // (usableHeight), which pushed clubhead approach positions below the
  // bottom edge of the canvas entirely.
  const width = 1920, height = 1080;
  const pt = FocusRender.shotPointToCanvas({ x: 0, y: -0.18 }, width, height);
  assert.ok(pt.y < height, `expected y to stay within the canvas (height=${height}), got ${pt.y}`);
});

test("shotPointToCanvas gives the clubhead approach zone clearly visible travel distance", () => {
  // The whole point of the bottomMarginPx/belowOriginPxPerUnit split is
  // that the swing isn't squeezed into an unnoticeable sliver near the
  // canvas edge - assert it covers a real, visible number of pixels.
  const width = 1920, height = 1080;
  const origin = FocusRender.shotPointToCanvas({ x: 0, y: 0 }, width, height);
  const approachStart = FocusRender.shotPointToCanvas({ x: 0, y: -0.18 }, width, height);
  const travelPx = approachStart.y - origin.y;
  assert.ok(travelPx > 80, `expected clubhead approach travel to be clearly visible (>80px), got ${travelPx}px`);
});

test("drawShotPath draws nothing until at least 2 points are revealed", () => {
  const ctx = makeMockCtx();
  const path = [{ x: 0, y: 0 }];
  FocusRender.drawShotPath(ctx, 800, 600, path, 1.0);
  assert.equal(ctx.calls.filter((c) => c[0] === "moveTo").length, 0);
});

test("drawShotPath reveals a growing prefix of the path as progress increases", () => {
  const path = [];
  for (let i = 0; i <= 10; i++) path.push({ x: 0, y: i / 10 });

  const ctxHalf = makeMockCtx();
  FocusRender.drawShotPath(ctxHalf, 800, 600, path, 0.5);
  const lineToCountHalf = ctxHalf.calls.filter((c) => c[0] === "lineTo").length;

  const ctxFull = makeMockCtx();
  FocusRender.drawShotPath(ctxFull, 800, 600, path, 1.0);
  const lineToCountFull = ctxFull.calls.filter((c) => c[0] === "lineTo").length;

  assert.ok(lineToCountFull > lineToCountHalf, "full progress should draw more segments than half progress");
});

test("drawAlignmentLine extends a line through both feet to the canvas edges", () => {
  const ctx = makeMockCtx();
  const matSize = { widthMm: 1000, heightMm: 1500 };
  const feet = [
    { x: 400, y: 750 },
    { x: 600, y: 750 },
  ];
  FocusRender.drawAlignmentLine(ctx, 800, 600, feet, matSize);

  const moveTo = ctx.calls.find((c) => c[0] === "moveTo");
  const lineTo = ctx.calls.find((c) => c[0] === "lineTo");
  assert.ok(moveTo && lineTo);
  // A level stance (same y) should draw a horizontal line, extended well
  // past the canvas width in both directions.
  assert.ok(moveTo[1] < 0, `expected line to extend left past x=0, got ${moveTo[1]}`);
  assert.ok(lineTo[1] > 800, `expected line to extend right past x=800, got ${lineTo[1]}`);
  assert.ok(Math.abs(moveTo[2] - lineTo[2]) < 1e-6, "expected a level line for a level stance");
});

test("drawAlignmentLine does nothing when no feet are detected", () => {
  const ctx = makeMockCtx();
  FocusRender.drawAlignmentLine(ctx, 800, 600, null, { widthMm: 1000, heightMm: 1500 });
  assert.equal(ctx.calls.length, 0);
});

test("drawStatsOverlay writes one fillText call per stat line", () => {
  const ctx = makeMockCtx();
  FocusRender.drawStatsOverlay(ctx, 800, ["Club Path: 2.1", "Smash Factor: 1.48"]);
  const textCalls = ctx.calls.filter((c) => c[0] === "fillText");
  assert.equal(textCalls.length, 2);
});

test("drawClubhead strokes a wireframe outline (no fill) at every frame", () => {
  const ctx = makeMockCtx();
  const shot = { ClubData: { Path: 0, FaceToTarget: 0, ClosureRate: 0, HorizontalFaceImpact: 0, VerticalFaceImpact: 0 } };
  const state = FocusClubhead.computeClubheadState(shot);
  const frame = FocusClubhead.sampleClubheadFrame(state, 0.5);

  FocusRender.drawClubhead(ctx, 800, 600, state, frame);

  assert.ok(ctx.calls.some((c) => c[0] === "stroke"));
  assert.ok(ctx.calls.some((c) => c[0] === "translate"));
  assert.ok(ctx.calls.some((c) => c[0] === "rotate"));
  // Not at impact yet - no marker dot (fill/arc) should be drawn.
  assert.ok(!ctx.calls.some((c) => c[0] === "arc"));
});

test("drawClubhead draws the impact marker only once atImpact is true", () => {
  const ctx = makeMockCtx();
  const shot = { ClubData: { Path: 0, FaceToTarget: 0, ClosureRate: 0, HorizontalFaceImpact: 0.6, VerticalFaceImpact: 0 } };
  const state = FocusClubhead.computeClubheadState(shot);
  const frame = FocusClubhead.sampleClubheadFrame(state, 1);

  FocusRender.drawClubhead(ctx, 800, 600, state, frame);

  assert.ok(ctx.calls.some((c) => c[0] === "arc"), "expected an impact marker dot to be drawn at impact");
  const textCalls = ctx.calls.filter((c) => c[0] === "fillText");
  assert.equal(textCalls.length, 1);
  assert.equal(textCalls[0][1], "TOE STRIKE");
});

test("drawClubhead draws no label text for a flush, centered strike", () => {
  const ctx = makeMockCtx();
  const shot = { ClubData: { Path: 0, FaceToTarget: 0, ClosureRate: 0, HorizontalFaceImpact: 0, VerticalFaceImpact: 0 } };
  const state = FocusClubhead.computeClubheadState(shot);
  const frame = FocusClubhead.sampleClubheadFrame(state, 1);

  FocusRender.drawClubhead(ctx, 800, 600, state, frame);

  assert.equal(ctx.calls.filter((c) => c[0] === "fillText").length, 0);
});

test("drawFootOutlines draws one stroked outline per foot", () => {
  const ctx = makeMockCtx();
  const matSize = { widthMm: 1000, heightMm: 1500 };
  const feet = [{ x: 400, y: 750 }, { x: 600, y: 750 }];

  FocusRender.drawFootOutlines(ctx, 800, 600, feet, matSize);

  assert.equal(ctx.calls.filter((c) => c[0] === "stroke").length, 2);
  assert.equal(ctx.calls.filter((c) => c[0] === "translate").length, 2);
  const translates = ctx.calls.filter((c) => c[0] === "translate");
  // Each outline is centered on its own foot's canvas position.
  assert.equal(translates[0][1], (400 / 1000) * 800);
  assert.equal(translates[1][1], (600 / 1000) * 800);
});

test("drawFootOutlines orients each foot's toe direction perpendicular to the stance line, not along it", () => {
  // Regression test: the rotation angle was previously offset by an extra
  // 90deg, which pointed the toe direction ALONG the stance line (feet
  // lying on their side) instead of across it.
  const ctx = makeMockCtx();
  const matSize = { widthMm: 1000, heightMm: 1500 };
  // A level (horizontal) stance line, canvas-space dy=0.
  const feet = [{ x: 400, y: 750 }, { x: 600, y: 750 }];

  FocusRender.drawFootOutlines(ctx, 800, 600, feet, matSize);

  const rotateCalls = ctx.calls.filter((c) => c[0] === "rotate");
  assert.equal(rotateCalls.length, 2);
  const stanceLineAngle = 0; // horizontal stance line -> atan2(0, dx) = 0
  for (const call of rotateCalls) {
    const footAngle = call[1];
    // The bug produced footAngle = stanceLineAngle + PI/2; the fix keeps
    // footAngle equal to the stance line's own angle.
    assert.ok(Math.abs(footAngle - stanceLineAngle) < 1e-9, `expected footAngle ~= ${stanceLineAngle}, got ${footAngle}`);
  }
});

test("drawFootOutlines does nothing when no feet are detected", () => {
  const ctx = makeMockCtx();
  FocusRender.drawFootOutlines(ctx, 800, 600, null, { widthMm: 1000, heightMm: 1500 });
  assert.equal(ctx.calls.length, 0);
});
