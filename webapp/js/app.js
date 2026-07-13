/**
 * Kiosk app entry point: fetches display config (mat size, canvas size,
 * projector keystone transform), opens a WebSocket to the bridge server
 * for live shot + mat-tracking data, and drives the render loop.
 */
(function () {
  "use strict";

  const ANIMATION_DURATION_MS = 900;

  const canvas = document.getElementById("field");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("stage");
  const statusEl = document.getElementById("connection-status");

  let matSize = { widthMm: 1000, heightMm: 1500 };
  let latestMatState = null;
  let currentShot = null;
  let currentPath = [];
  let animationStartMs = null;

  function setConnectionStatus(connected) {
    statusEl.textContent = connected ? "connected" : "disconnected";
    statusEl.className = connected ? "connected" : "disconnected";
  }

  function applyConfig(config) {
    if (config.matWidthMm && config.matHeightMm) {
      matSize = { widthMm: config.matWidthMm, heightMm: config.matHeightMm };
    }
    if (config.canvasWidth && config.canvasHeight) {
      canvas.width = config.canvasWidth;
      canvas.height = config.canvasHeight;
    }
    if (config.cssMatrix3d) {
      stage.style.transform = config.cssMatrix3d;
    }
  }

  function loadConfig() {
    return fetch("/api/config")
      .then((res) => (res.ok ? res.json() : {}))
      .then(applyConfig)
      .catch(() => {
        /* no config endpoint yet (e.g. running the static files directly) - fall back to defaults */
      });
  }

  function computeStatsLines(shot) {
    const ball = shot.BallData || {};
    const club = shot.ClubData || {};
    const smash = FocusAnim.smashFactor(shot);
    const lines = [];
    if (club.Path !== undefined) lines.push(`Club Path: ${club.Path.toFixed(1)}`);
    if (club.FaceToTarget !== undefined) lines.push(`Face-to-Target: ${club.FaceToTarget.toFixed(1)}`);
    if (smash !== null) lines.push(`Smash Factor: ${smash.toFixed(2)}`);
    if (ball.CarryDistance !== undefined) lines.push(`Carry: ${Math.round(ball.CarryDistance)} yds`);
    return lines.slice(0, 3);
  }

  function onShot(shot) {
    currentShot = shot;
    currentPath = FocusAnim.sampleShotPath(shot, {}, 60);
    animationStartMs = performance.now();
  }

  function onMatState(state) {
    latestMatState = state;
  }

  function renderFrame(nowMs) {
    FocusRender.clearCanvas(ctx, canvas.width, canvas.height);

    if (latestMatState && latestMatState.foot_mat_points_mm) {
      const [left, right] = latestMatState.foot_mat_points_mm;
      FocusRender.drawAlignmentLine(
        ctx,
        canvas.width,
        canvas.height,
        [{ x: left[0], y: left[1] }, { x: right[0], y: right[1] }],
        matSize
      );
    }

    if (currentShot && animationStartMs !== null) {
      const elapsed = nowMs - animationStartMs;
      const rawProgress = Math.min(1, elapsed / ANIMATION_DURATION_MS);
      const progress = FocusAnim.easeOutCubic(rawProgress);
      FocusRender.drawShotPath(ctx, canvas.width, canvas.height, currentPath, progress);
      FocusRender.drawStatsOverlay(ctx, canvas.width, computeStatsLines(currentShot));
    }

    requestAnimationFrame(renderFrame);
  }

  function connectWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => setConnectionStatus(true);
    ws.onclose = () => {
      setConnectionStatus(false);
      setTimeout(connectWebSocket, 2000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (msg.type === "shot") onShot(msg.shot);
      else if (msg.type === "mat_state") onMatState(msg.state);
    };
  }

  loadConfig().then(() => {
    requestAnimationFrame(renderFrame);
    connectWebSocket();
  });
})();
