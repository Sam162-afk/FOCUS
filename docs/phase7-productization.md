# Phase 7: Productization (launcher + setup wizard)

The earlier phases were a developer workflow: five terminals, manual JSON
config edits, CLI flags for calibration. This phase makes it runnable by
someone who isn't going to read the source.

## `launcher.py` — one command instead of five terminals

```bash
python3 launcher.py --gspro-port 0920 --camera 0
```

Starts the GSPro proxy, vision tracker, and bridge server as managed
subprocesses, restarts any that crash (capped at 5 restarts with a 2s
backoff, so a genuinely broken component doesn't spin-loop forever),
waits for the bridge to come up, and opens the kiosk display in a
browser automatically. `--gspro-port` and `--camera`/`--video` are both
optional — omit either to run without that piece (e.g. render-only
development with no hardware attached). `--no-browser` skips the
auto-open. `Ctrl+C` (or `SIGTERM`) shuts everything down cleanly — no
orphaned child processes, which was verified with a manual smoke test
(fake GSPro → launcher → live shot → SIGTERM → confirmed zero remaining
processes).

## `webapp/setup.html` — the setup wizard

A 4-step wizard, no separate install needed since it's just another page
the bridge server serves:

1. **Mat size** — width/height in mm.
2. **Stats** — pick up to 3 from a shared catalog
   (`webapp/js/stat-catalog.js`) to show on-screen after each shot.
3. **Projector calibration** — a drag-based "corner pin": drag each
   corner handle while watching the actual floor projection until it
   looks rectangular. This directly manipulates canvas/output pixel
   space, so no camera or photo is needed (see
   `docs/phase3-projector-mapping.md` for why this is mathematically the
   right space to work in). Skippable if the projector isn't connected
   yet.
4. **Review & save** — shows the exact JSON payload, then either POSTs
   it to the bridge server's `/api/setup` (applied immediately, no
   restart needed) or, if no bridge is reachable (e.g. previewing the
   wizard standalone), falls back to downloading `config.json` and
   `projector_calibration.json` directly.

Settings persist in `config.json` (mat size, canvas size, selected
stats) and `projector_calibration.json` (the same format
`projector/calibration.py` already used), and are reloaded automatically
the next time the bridge starts — `launcher.py` and `bridge/server.py`
both default to these filenames.

## Stat catalog

`webapp/js/stat-catalog.js` is the single source of truth for
"selectable stats" — the wizard's picker and the kiosk overlay
(`app.js`) both read from it, so they can't drift out of sync. Adding a
new selectable stat means adding one entry to `CATALOG`, nothing else.

## What's still manual

- The wizard's projector-calibration step assumes someone can see the
  actual floor projection while dragging (either by running the wizard
  on the kiosk PC itself, or having someone relay what they see). A
  remote/photo-based calibration flow was considered and rejected — see
  `docs/phase3-projector-mapping.md` for why corner-pin dragging in
  output-pixel-space is the mathematically correct approach here, versus
  a photo-based approach which would require an extra camera calibration
  step to be correct.
- No packaging/installer (PyInstaller, systemd service, etc.) — still
  requires Python + `pip install -r requirements.txt` on the target
  machine.
