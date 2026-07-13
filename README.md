# FOCUS Clone — DIY Floor Projection Impact Readout

A software system that turns a projector + webcam + GSPro/launch monitor
into a floor-projected impact readout, similar to Foresight's FOCUS system,
at a fraction of the hardware cost. See `docs/project-plan.md` for the full
architecture and phased build plan.

## Status

Phase 0/1 (GSPro data tap) is implemented and tested. See
`docs/phase0-data-tap.md` for what it does and how to validate it.

## Layout

- `proxy/` — the GSPro TCP data-tap proxy and test-double scripts
  (`gspro_proxy.py`, `fake_gspro.py`, `fake_club_optix.py`)
- `tests/` — automated tests (`pytest`)
- `docs/` — project plan and per-phase notes

## Running the proxy

```bash
python3 proxy/gspro_proxy.py --listen-port <PORT_CLUB_OPTIX_POINTS_AT> \
    --gspro-host 127.0.0.1 --gspro-port <GSPRO_REAL_PORT>
```

See `docs/phase0-data-tap.md` for full setup/testing instructions,
including how to validate the pipeline without real hardware.

## Tests

```bash
pip install pytest
pytest tests/
```
