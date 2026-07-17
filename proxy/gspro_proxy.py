#!/usr/bin/env python3
"""
GSPro data-tap proxy.

Sits between the launch monitor software (e.g. Club Optix) and GSPro's
Open Connect listener. Every byte received from the launch monitor side
is forwarded to GSPro unchanged, and vice versa, so GSPro behaves exactly
as if the launch monitor connected to it directly.

In parallel, traffic from the launch monitor -> GSPro direction is
buffered and split on newlines; each line that parses as JSON is treated
as one shot record, timestamped, logged to stdout, and appended to a
JSONL log file for downstream consumption (vision/renderer processes).

Usage:
    python gspro_proxy.py --listen-port 0921 --gspro-host 127.0.0.1 --gspro-port 0920

Point the launch monitor software's "GSPro IP/port" setting at this
proxy's listen host/port instead of at GSPro directly.
"""
import argparse
import json
import socket
import sys
import threading
import time
from datetime import datetime, timezone

BUFFER_SIZE = 4096


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(f"[{ts}] {msg}", flush=True)


class LineJSONExtractor:
    """Accumulates bytes and yields complete JSON objects delimited by newlines."""

    def __init__(self):
        self._buf = b""

    def feed(self, data: bytes):
        self._buf += data
        shots = []
        while b"\n" in self._buf:
            line, self._buf = self._buf.split(b"\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                shots.append(json.loads(line))
            except json.JSONDecodeError:
                # Not a complete/parseable JSON line on its own; drop silently.
                # Framing assumptions are unconfirmed for the real Club Optix
                # wire format (see docs/phase0-data-tap.md) - this only affects
                # our own logging, never the bytes forwarded to GSPro.
                pass
        return shots


def pipe_and_tap(src: socket.socket, dst: socket.socket, shot_log_path, label: str, tap: bool):
    extractor = LineJSONExtractor() if tap else None
    try:
        while True:
            data = src.recv(BUFFER_SIZE)
            if not data:
                break
            dst.sendall(data)
            if tap:
                for shot in extractor.feed(data):
                    record_shot(shot, shot_log_path)
    except (ConnectionResetError, OSError):
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def record_shot(shot: dict, shot_log_path: str):
    entry = {"received_at": datetime.now(timezone.utc).isoformat(), "shot": shot}
    log(f"shot captured: {json.dumps(shot)[:200]}")
    if shot_log_path:
        with open(shot_log_path, "a") as f:
            f.write(json.dumps(entry) + "\n")


def handle_client(client_sock: socket.socket, addr, gspro_host: str, gspro_port: int, shot_log_path):
    log(f"launch monitor connected from {addr}")
    try:
        gspro_sock = socket.create_connection((gspro_host, gspro_port), timeout=5)
    except OSError as e:
        log(f"failed to connect to GSPro at {gspro_host}:{gspro_port}: {e}")
        client_sock.close()
        return

    log(f"connected upstream to GSPro at {gspro_host}:{gspro_port}")

    t_up = threading.Thread(
        target=pipe_and_tap,
        args=(client_sock, gspro_sock, shot_log_path, "client->gspro", True),
        daemon=True,
    )
    t_down = threading.Thread(
        target=pipe_and_tap,
        args=(gspro_sock, client_sock, shot_log_path, "gspro->client", False),
        daemon=True,
    )
    t_up.start()
    t_down.start()
    t_up.join()
    t_down.join()

    client_sock.close()
    gspro_sock.close()
    log(f"connection from {addr} closed")


def run(listen_host: str, listen_port: int, gspro_host: str, gspro_port: int, shot_log_path):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((listen_host, listen_port))
    server.listen(5)
    log(f"proxy listening on {listen_host}:{listen_port}, forwarding to {gspro_host}:{gspro_port}")

    try:
        while True:
            client_sock, addr = server.accept()
            threading.Thread(
                target=handle_client,
                args=(client_sock, addr, gspro_host, gspro_port, shot_log_path),
                daemon=True,
            ).start()
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        server.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--listen-host", default="0.0.0.0", help="Host to listen on for the launch monitor software")
    parser.add_argument("--listen-port", type=int, required=True, help="Port to listen on (point Club Optix's GSPro IP here)")
    parser.add_argument("--gspro-host", default="127.0.0.1", help="Real GSPro host")
    parser.add_argument("--gspro-port", type=int, required=True, help="Real GSPro Open Connect port")
    parser.add_argument("--shot-log", default="shots_log.jsonl", help="Path to append parsed shot JSON (set to '' to disable)")
    args = parser.parse_args()

    run(args.listen_host, args.listen_port, args.gspro_host, args.gspro_port, args.shot_log or None)


if __name__ == "__main__":
    main()
