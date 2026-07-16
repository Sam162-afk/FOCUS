/**
 * Kiosk app entry point: fetches display config (mat size, canvas size,
 * projector keystone transform), opens a WebSocket to the bridge server
 * for live shot + mat-tracking data, and drives the render loop.
 */
(function () {
  "use strict";

  const APPROACH_DURATION_MS = 3900; // clubhead swinging in and closing the face (3x, then another 2x slowed)
  const FOLLOW_THROUGH_DURATION_MS = 2400; // clubhead continuing through, concurrent with ball flight (3x, then another 2x slowed)
  const FLIGHT_DURATION_MS = 5400; // ball-flight trace (3x, then another 2x slowed)
  const STATS_OFFSET_X = 450; // shifts just the stat boxes well to the right of the true tracked ball position - the ball/clubhead/target line stay put

  const canvas = document.getElementById("field");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("stage");
  const statusEl = document.getElementById("connection-status");

  let matSize = { widthMm: 1000, heightMm: 1500 };
  let statIds = FocusStats.DEFAULT_STAT_IDS;
  let latestMatState = null;
  let currentShot = null;
  let currentPath = [];
  let currentClubheadState = null;
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
    if (config.stats && config.stats.length) {
      statIds = config.stats;
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

  function onShot(shot) {
    currentShot = shot;
    currentPath = FocusAnim.sampleShotPath(shot, {}, 60);
    currentClubheadState = FocusClubhead.computeClubheadState(shot);
    animationStartMs = performance.now();
  }

  function onMatState(state) {
    latestMatState = state;
  }

  function renderFrame(nowMs) {
    FocusRender.clearCanvas(ctx, canvas.width, canvas.height);

    // The target line, clubhead, and ball flight all stay anchored at the
    // real tracked ball position (originPx) - only the stat boxes are
    // deliberately decoupled from that point and drawn at a fixed
    // rightward offset (statsOriginPx) instead, so the readout has
    // clear space of its own without moving the ball off the target line.
    let originPx = null;
    let statsOriginPx = null;

    if (latestMatState && latestMatState.foot_mat_points_mm) {
      const [left, right] = latestMatState.foot_mat_points_mm;
      const feet = [{ x: left[0], y: left[1] }, { x: right[0], y: right[1] }];

      // The stance line and target line stay on through the whole swing
      // (setup through impact and follow-through), not just pre-shot -
      // they're the golfer's aim reference, not just an address-position
      // indicator that should disappear once they start swinging.
      FocusRender.drawAlignmentLine(ctx, canvas.width, canvas.height, feet, matSize);
      FocusRender.drawFootOutlines(ctx, canvas.width, canvas.height, feet, matSize);

      const ballMatPosition = FocusRender.computeBallMatPosition(feet);
      originPx = FocusRender.matPointToCanvas(ballMatPosition, canvas.width, canvas.height, matSize);
      statsOriginPx = { x: originPx.x + STATS_OFFSET_X, y: originPx.y };
      FocusRender.drawTargetLine(ctx, canvas.width, canvas.height, { originPx });
    }

    const shotOptions = originPx ? { originPx } : undefined;

    if (currentShot && animationStartMs !== null) {
      const elapsed = nowMs - animationStartMs;

      if (elapsed < APPROACH_DURATION_MS) {
        const approachProgress = elapsed / APPROACH_DURATION_MS;
        const frame = FocusClubhead.sampleClubheadFrame(currentClubheadState, approachProgress);
        FocusRender.drawClubhead(ctx, canvas.width, canvas.height, currentClubheadState, frame, shotOptions);
      } else {
        // Follow-through and ball flight happen concurrently, like a real
        // swing: the ball's already gone while the golfer keeps swinging.
        // The clubhead graphic holds at its final follow-through position
        // once the swing settles, rather than disappearing - it stays
        // visible alongside the stats/ball flight until the next shot,
        // like the rest of the settled shot's readout.
        const postImpactElapsed = elapsed - APPROACH_DURATION_MS;
        const followThroughProgress = Math.min(1, postImpactElapsed / FOLLOW_THROUGH_DURATION_MS);
        const clubheadFrame = FocusClubhead.sampleFollowThroughFrame(currentClubheadState, followThroughProgress);
        FocusRender.drawClubhead(ctx, canvas.width, canvas.height, currentClubheadState, clubheadFrame, shotOptions);

        const rawProgress = Math.min(1, postImpactElapsed / FLIGHT_DURATION_MS);
        const progress = FocusAnim.easeOutCubic(rawProgress);
        const carry = currentShot.BallData && currentShot.BallData.CarryDistance;
        const landingLabel = typeof carry === "number" ? `${Math.round(carry)} YDS` : null;
        FocusRender.drawShotPath(ctx, canvas.width, canvas.height, currentPath, progress, Object.assign({}, shotOptions, { landingLabel }));
      }

      // The launch monitor sends the full shot data instantly at impact -
      // the numbers are already known before the animation even starts,
      // so show them from the first frame instead of waiting for the
      // swing/flight animation to finish playing out.
      FocusRender.drawClubPathLine(ctx, canvas.width, canvas.height, currentClubheadState, shotOptions);
      FocusRender.drawSpinDial(ctx, canvas.width, canvas.height, originPx, currentShot.BallData && currentShot.BallData.SpinAxis);
      FocusRender.drawStatsOverlay(
        ctx,
        canvas.width,
        FocusStats.buildStatLines(currentShot, statIds),
        statsOriginPx ? { origin: statsOriginPx } : undefined
      );
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
