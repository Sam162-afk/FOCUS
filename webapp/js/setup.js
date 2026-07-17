/**
 * DOM wiring for the setup wizard. Pure validation/payload logic lives in
 * wizard-logic.js so it's unit testable without a DOM.
 */
(function () {
  "use strict";

  const CANVAS_WIDTH = 1920;
  const CANVAS_HEIGHT = 1080;
  const HANDLE_RADIUS = 10;

  const steps = [document.getElementById("step-0"), document.getElementById("step-1"), document.getElementById("step-2"), document.getElementById("step-3")];
  const stepDots = Array.from(document.querySelectorAll(".step-dot"));
  const backBtn = document.getElementById("back-btn");
  const nextBtn = document.getElementById("next-btn");
  const saveBtn = document.getElementById("save-btn");
  const saveStatus = document.getElementById("save-status");

  let currentStep = 0;
  let selectedStats = FocusStats.DEFAULT_STAT_IDS.slice();

  // --- Step 1: stat picker ---

  const statOptionsEl = document.getElementById("stat-options");
  FocusStats.CATALOG.forEach((stat) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = stat.id;
    checkbox.checked = selectedStats.includes(stat.id);
    checkbox.addEventListener("change", onStatToggle);
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(stat.label));
    statOptionsEl.appendChild(label);
  });

  function onStatToggle(event) {
    const id = event.target.value;
    if (event.target.checked) {
      if (selectedStats.length >= FocusStats.MAX_STATS) {
        event.target.checked = false;
        return;
      }
      selectedStats.push(id);
    } else {
      selectedStats = selectedStats.filter((s) => s !== id);
    }
  }

  // --- Step 2: draggable corner-pin calibration ---

  const calCanvas = document.getElementById("calibration-canvas");
  const calCtx = calCanvas.getContext("2d");
  const scaleX = calCanvas.width / CANVAS_WIDTH;
  const scaleY = calCanvas.height / CANVAS_HEIGHT;

  function defaultCorners() {
    // No correction = the canvas's own rectangle, in full-resolution units.
    return [
      [0, 0],
      [CANVAS_WIDTH, 0],
      [CANVAS_WIDTH, CANVAS_HEIGHT],
      [0, CANVAS_HEIGHT],
    ];
  }

  let corners = defaultCorners();
  let draggingIndex = null;

  function toDisplay([x, y]) {
    return [x * scaleX, y * scaleY];
  }

  function toFullRes(x, y) {
    return [x / scaleX, y / scaleY];
  }

  function drawCalibration() {
    calCtx.fillStyle = "#000";
    calCtx.fillRect(0, 0, calCanvas.width, calCanvas.height);

    // Warped grid preview: draw the quad + a few interior gridlines so the
    // distortion is visible.
    const pts = corners.map(toDisplay);
    calCtx.strokeStyle = "#39ff14";
    calCtx.lineWidth = 2;
    calCtx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? calCtx.moveTo(x, y) : calCtx.lineTo(x, y)));
    calCtx.closePath();
    calCtx.stroke();

    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const top = lerp(pts[0], pts[1], t);
      const bottom = lerp(pts[3], pts[2], t);
      calCtx.beginPath();
      calCtx.moveTo(top[0], top[1]);
      calCtx.lineTo(bottom[0], bottom[1]);
      calCtx.stroke();
    }

    pts.forEach(([x, y], i) => {
      calCtx.fillStyle = draggingIndex === i ? "#ffff00" : "#ffffff";
      calCtx.beginPath();
      calCtx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
      calCtx.fill();
    });
  }

  function lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  function handleAt(displayX, displayY) {
    return corners.findIndex(([x, y]) => {
      const [dx, dy] = toDisplay([x, y]);
      return Math.hypot(dx - displayX, dy - displayY) <= HANDLE_RADIUS + 4;
    });
  }

  function canvasEventPos(event) {
    const rect = calCanvas.getBoundingClientRect();
    const scale = calCanvas.width / rect.width;
    return [(event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale];
  }

  calCanvas.addEventListener("mousedown", (event) => {
    const [x, y] = canvasEventPos(event);
    draggingIndex = handleAt(x, y);
    drawCalibration();
  });

  calCanvas.addEventListener("mousemove", (event) => {
    if (draggingIndex === null) return;
    const [x, y] = canvasEventPos(event);
    corners[draggingIndex] = toFullRes(x, y);
    drawCalibration();
  });

  window.addEventListener("mouseup", () => {
    draggingIndex = null;
    drawCalibration();
  });

  document.getElementById("reset-corners").addEventListener("click", () => {
    corners = defaultCorners();
    drawCalibration();
  });

  // --- Step navigation ---

  function updateNav() {
    steps.forEach((el, i) => el.classList.toggle("hidden", i !== currentStep));
    stepDots.forEach((el, i) => el.classList.toggle("active", i === currentStep));
    backBtn.disabled = currentStep === 0;
    nextBtn.style.display = currentStep === steps.length - 1 ? "none" : "";
    if (currentStep === 2) drawCalibration();
    if (currentStep === 3) updateReview();
  }

  function isIdentityCorners() {
    const def = defaultCorners();
    return corners.every(([x, y], i) => x === def[i][0] && y === def[i][1]);
  }

  function updateReview() {
    const payload = FocusWizard.buildSetupPayload({
      matWidthMm: Number(document.getElementById("mat-width").value),
      matHeightMm: Number(document.getElementById("mat-height").value),
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      statIds: selectedStats,
      projectorCorners: isIdentityCorners() ? null : corners,
    });
    document.getElementById("review-summary").textContent = JSON.stringify(payload, null, 2);
  }

  backBtn.addEventListener("click", () => {
    currentStep = Math.max(0, currentStep - 1);
    updateNav();
  });

  nextBtn.addEventListener("click", () => {
    currentStep = Math.min(steps.length - 1, currentStep + 1);
    updateNav();
  });

  // --- Save ---

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  saveBtn.addEventListener("click", async () => {
    const matWidthMm = Number(document.getElementById("mat-width").value);
    const matHeightMm = Number(document.getElementById("mat-height").value);

    const matErrors = FocusWizard.validateMatSize(matWidthMm, matHeightMm);
    const statErrors = FocusWizard.validateStats(selectedStats, FocusStats.MAX_STATS);
    const errors = matErrors.concat(statErrors);
    if (errors.length) {
      saveStatus.textContent = errors.join(" ");
      saveStatus.className = "error";
      return;
    }

    const payload = FocusWizard.buildSetupPayload({
      matWidthMm,
      matHeightMm,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      statIds: selectedStats,
      projectorCorners: isIdentityCorners() ? null : corners,
    });

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`server responded ${res.status}`);
      saveStatus.textContent = "Saved. Reload the kiosk display to apply.";
      saveStatus.className = "ok";
    } catch (err) {
      const files = FocusWizard.buildDownloadFiles(payload);
      Object.entries(files).forEach(([name, data]) => downloadJson(name, data));
      saveStatus.textContent = "No bridge server reachable from this page - downloaded config.json" +
        (files["projector_calibration.json"] ? " and projector_calibration.json" : "") +
        ". Place them in the FOCUS project root.";
      saveStatus.className = "error";
    }
  });

  updateNav();

  // Exposed for automated testing only (tests/webapp/test_setup_wizard.py).
  window.__focusWizardDebug = {
    getCorners: () => corners,
    getSelectedStats: () => selectedStats,
  };
})();
