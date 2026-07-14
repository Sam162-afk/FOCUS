/**
 * Kiosk app entry point: fetches display config (mat size, canvas size,
 * projector keystone transform), opens a WebSocket to the bridge server
 * for live shot + mat-tracking data, and drives the render loop.
 */
(function () {
  "use strict";

  const APPROACH_DURATION_MS = 650; // clubhead swinging in and closing the face
  const FOLLOW_THROUGH_DURATION_MS = 400; // clubhead continuing through, concurrent with ball flight
  const FLIGHT_DURATION_MS = 900; // ball-flight trace

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

    // Anchor the whole shot-space animation (clubhead, ball flight, stats)
    // beside the golfer's actual tracked ball position, instead of a fixed
    // canvas point unrelated to where they're standing.
    let originPx = null;
    const preShot = !currentShot;

    if (latestMatState && latestMatState.foot_mat_points_mm) {
      const [left, right] = latestMatState.foot_mat_points_mm;
      const feet = [{ x: left[0], y: left[1] }, { x: right[0], y: right[1] }];

      // The stance/alignment reference is only useful while addressing the
      // ball - once a shot is struck, showing it (along with the target
      // line and distance gridlines) just clutters the results, unlike a
      // real projected display, which shows nothing but the ball's own
      // numbers once the swing is done.
      if (preShot) {
        FocusRender.drawAlignmentLine(ctx, canvas.width, canvas.height, feet, matSize);
        FocusRender.drawFootOutlines(ctx, canvas.width, canvas.height, feet, matSize);
      }

      const ballMatPosition = FocusRender.computeBallMatPosition(feet);
      originPx = FocusRender.matPointToCanvas(ballMatPosition, canvas.width, canvas.height, matSize);
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
        // The clubhead graphic itself stops once the follow-through
        // settles - a real club would have long since left the frame, and
        // lingering the synthetic silhouette on screen just clutters the
        // results the way the real reference display never does.
        const postImpactElapsed = elapsed - APPROACH_DURATION_MS;
        const followThroughProgress = Math.min(1, postImpactElapsed / FOLLOW_THROUGH_DURATION_MS);
        if (followThroughProgress < 1) {
          const clubheadFrame = FocusClubhead.sampleFollowThroughFrame(currentClubheadState, followThroughProgress);
          FocusRender.drawClubhead(ctx, canvas.width, canvas.height, currentClubheadState, clubheadFrame, shotOptions);
        }

        const rawProgress = Math.min(1, postImpactElapsed / FLIGHT_DURATION_MS);
        const progress = FocusAnim.easeOutCubic(rawProgress);
        const carry = currentShot.BallData && currentShot.BallData.CarryDistance;
        const landingLabel = typeof carry === "number" ? `${Math.round(carry)} YDS` : null;
        FocusRender.drawShotPath(ctx, canvas.width, canvas.height, currentPath, progress, Object.assign({}, shotOptions, { landingLabel }));
        FocusRender.drawSpinDial(ctx, canvas.width, canvas.height, originPx, currentShot.BallData && currentShot.BallData.SpinAxis);
        FocusRender.drawStatsOverlay(
          ctx,
          canvas.width,
          FocusStats.buildStatLines(currentShot, statIds),
          originPx ? { origin: originPx } : undefined
        );
      }
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
