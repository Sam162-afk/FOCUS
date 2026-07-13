const test = require("node:test");
const assert = require("node:assert/strict");
const FocusRender = require("../../webapp/js/render.js");

function makeMockCtx() {
  const calls = [];
  return {
    calls,
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    beginPath() { calls.push(["beginPath"]); },
    moveTo(...args) { calls.push(["moveTo", ...args]); },
    lineTo(...args) { calls.push(["lineTo", ...args]); },
    stroke() { calls.push(["stroke"]); },
    arc(...args) { calls.push(["arc", ...args]); },
    fill() { calls.push(["fill"]); },
    fillText(...args) { calls.push(["fillText", ...args]); },
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
  assert.equal(pt.y, height - 40); // default marginPx
});

test("shotPointToCanvas maps positive x to the right half of the canvas", () => {
  const pt = FocusRender.shotPointToCanvas({ x: 0.5, y: 0.2 }, 800, 600);
  assert.ok(pt.x > 400);
});

test("shotPointToCanvas maps y=1 near the top margin", () => {
  const height = 600;
  const pt = FocusRender.shotPointToCanvas({ x: 0, y: 1 }, 800, height);
  assert.equal(pt.y, 40); // marginPx from the top
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
