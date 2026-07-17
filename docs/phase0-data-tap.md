# Phase 0/1: GSPro Data Tap

## What this validates

The plan's Phase 0 risk item: whether the launch monitor software's "GSPro
IP/port" setting can be pointed at an arbitrary local address (this proxy)
instead of GSPro directly, with GSPro never knowing the difference.

`proxy/gspro_proxy.py` is a transparent TCP proxy:
- Forwards every byte from the launch monitor to GSPro, unchanged, and
  every byte from GSPro back to the launch monitor, unchanged.
- In parallel, taps the launch-monitor -> GSPro direction: splits on
  newlines, tries to parse each line as JSON, and if it parses, logs it
  (stdout + an append-only `.jsonl` file) as one shot record with a
  received timestamp.

## Open assumption to confirm with real hardware

The tap assumes Club Optix sends one JSON object per line (newline-delimited
JSON), matching common GSPro Open Connect integrations. This assumption
only affects the *tap* (our own logging/downstream data) — it does **not**
affect correctness of the pass-through to GSPro, since raw bytes are
forwarded regardless of whether they parse as JSON. If real shots don't
land in the shot log, check `docs/phase0-data-tap.md` assumptions first
before suspecting the pass-through is broken.

## Testing without real hardware

Three terminals, in order:

```bash
# 1. Stand-in for GSPro
python3 proxy/fake_gspro.py --port 0920

# 2. The proxy itself - point real Club Optix at this port later
python3 proxy/gspro_proxy.py --listen-port 0921 --gspro-host 127.0.0.1 --gspro-port 0920

# 3. Stand-in for Club Optix - sends sample shot JSON
python3 proxy/fake_club_optix.py --host 127.0.0.1 --port 0921 --shots 3
```

Expect: the fake GSPro terminal prints the exact bytes sent by fake Club
Optix; the fake Club Optix terminal prints the exact ack bytes sent by
fake GSPro; `shots_log.jsonl` accumulates one entry per shot.

Automated version of the same check: `pytest tests/test_gspro_proxy.py`.

## Testing with real hardware (next step)

1. Run GSPro as normal; note the port it's listening on for Open Connect
   (GSPro's own settings screen shows this).
2. Run `gspro_proxy.py` with `--gspro-port` set to that port and
   `--listen-port` set to any free port on the same machine.
3. In Club Optix's settings, change the GSPro target IP/port from GSPro's
   real address to `127.0.0.1:<listen-port>` (proxy).
4. Hit a few shots. Confirm:
   - GSPro still receives and displays shots normally (proves pass-through
     doesn't break the existing connection).
   - `shots_log.jsonl` picks up real shot JSON (proves the tap works, and
     tells us whether Club Optix populates full `ClubData` or partial
     fields per the plan's open question #2).
