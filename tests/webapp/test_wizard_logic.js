const test = require("node:test");
const assert = require("node:assert/strict");
const FocusWizard = require("../../webapp/js/wizard-logic.js");

test("validateMatSize accepts positive dimensions", () => {
  assert.deepEqual(FocusWizard.validateMatSize(1000, 1500), []);
});

test("validateMatSize rejects zero/negative/NaN dimensions", () => {
  assert.ok(FocusWizard.validateMatSize(0, 1500).length > 0);
  assert.ok(FocusWizard.validateMatSize(1000, -5).length > 0);
  assert.ok(FocusWizard.validateMatSize(NaN, 1500).length > 0);
});

test("validateStats rejects empty selection", () => {
  assert.ok(FocusWizard.validateStats([], 3).length > 0);
});

test("validateStats rejects more than the max", () => {
  assert.ok(FocusWizard.validateStats(["a", "b", "c", "d"], 3).length > 0);
});

test("validateStats accepts 1..max stats", () => {
  assert.deepEqual(FocusWizard.validateStats(["a"], 3), []);
  assert.deepEqual(FocusWizard.validateStats(["a", "b", "c"], 3), []);
});

test("validateCorners requires exactly 4 points", () => {
  assert.ok(FocusWizard.validateCorners([[0, 0], [1, 1]]).length > 0);
  assert.deepEqual(FocusWizard.validateCorners([[0, 0], [10, 0], [10, 10], [0, 10]]), []);
});

test("validateCorners rejects duplicate points", () => {
  const errors = FocusWizard.validateCorners([[0, 0], [0, 0], [10, 10], [0, 10]]);
  assert.ok(errors.length > 0);
});

test("buildSetupPayload shapes the wizard state into the API payload", () => {
  const payload = FocusWizard.buildSetupPayload({
    matWidthMm: 1000,
    matHeightMm: 1500,
    canvasWidth: 1920,
    canvasHeight: 1080,
    statIds: ["clubPath", "smashFactor"],
    projectorCorners: [[10, 10], [1900, 10], [1900, 1070], [10, 1070]],
  });
  assert.equal(payload.matWidthMm, 1000);
  assert.deepEqual(payload.stats, ["clubPath", "smashFactor"]);
  assert.equal(payload.projectorCorners.length, 4);
});

test("buildDownloadFiles produces a config.json shape and a projector_calibration.json matching the Python dataclass", () => {
  const payload = FocusWizard.buildSetupPayload({
    matWidthMm: 1000,
    matHeightMm: 1500,
    canvasWidth: 1920,
    canvasHeight: 1080,
    statIds: ["clubPath"],
    projectorCorners: [[10, 10], [1900, 10], [1900, 1070], [10, 1070]],
  });
  const files = FocusWizard.buildDownloadFiles(payload);

  assert.deepEqual(files["config.json"], {
    matWidthMm: 1000,
    matHeightMm: 1500,
    canvasWidth: 1920,
    canvasHeight: 1080,
    stats: ["clubPath"],
  });
  assert.deepEqual(files["projector_calibration.json"].canvas_size, [1920, 1080]);
  assert.equal(files["projector_calibration.json"].projector_corners.length, 4);
});

test("buildDownloadFiles omits the calibration file when no corners were set", () => {
  const payload = FocusWizard.buildSetupPayload({
    matWidthMm: 1000,
    matHeightMm: 1500,
    canvasWidth: 1920,
    canvasHeight: 1080,
    statIds: ["clubPath"],
    projectorCorners: null,
  });
  const files = FocusWizard.buildDownloadFiles(payload);
  assert.ok(!("projector_calibration.json" in files));
});
