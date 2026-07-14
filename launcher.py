#!/usr/bin/env python3
"""
Single-command launcher: starts the GSPro proxy, vision tracker, and
bridge server together, restarts any of them that crashes, and opens the
kiosk display in a browser once it's reachable. Replaces the "5
terminals" manual workflow from earlier development phases with one
command, e.g.:

    python3 launcher.py --gspro-port 0920 --camera 0

Any component can be omitted (no --gspro-port skips the proxy, no
--camera/--video skips vision tracking) so this also works for
render-only development without hardware attached. Run with --help for
the full flag list; each corresponds to a flag on the underlying script
(proxy/gspro_proxy.py, vision/mat_tracker.py, bridge/server.py).
"""
import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
MAX_RESTARTS = 5
RESTART_BACKOFF_SECONDS = 2
READY_CHECK_TIMEOUT_SECONDS = 15


class ManagedProcess:
    def __init__(self, name, cmd):
        self.name = name
        self.cmd = cmd
        self.proc = None
        self.restart_count = 0
        self.gave_up = False

    def start(self):
        self.proc = subprocess.Popen(self.cmd, cwd=REPO_ROOT)

    def poll(self):
        return self.proc.poll() if self.proc else None

    def terminate(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def wait_until_ready(url, timeout_seconds):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def build_processes(args):
    processes = []

    if args.gspro_port is not None:
        cmd = [
            sys.executable, os.path.join("proxy", "gspro_proxy.py"),
            "--listen-port", str(args.proxy_listen_port),
            "--gspro-host", args.gspro_host,
            "--gspro-port", str(args.gspro_port),
            "--shot-log", args.shots_log,
        ]
        processes.append(ManagedProcess("gspro-proxy", cmd))
    else:
        print("[launcher] --gspro-port not set, skipping the GSPro proxy (no shots will arrive)")

    if args.camera is not None or args.video is not None:
        cmd = [sys.executable, "-m", "vision.mat_tracker"]
        cmd += ["--camera", str(args.camera)] if args.camera is not None else ["--video", args.video]
        cmd += [
            "--mat-width-mm", str(args.mat_width_mm),
            "--mat-height-mm", str(args.mat_height_mm),
            "--state-file", args.mat_state_file,
        ]
        processes.append(ManagedProcess("vision-tracker", cmd))
    else:
        print("[launcher] no --camera/--video given, skipping vision tracking (no alignment line)")

    bridge_cmd = [
        sys.executable, "-m", "bridge.server",
        "--shots-log", args.shots_log,
        "--mat-state-file", args.mat_state_file,
        "--projector-calibration", args.projector_calibration,
        "--config-file", args.config_file,
        "--host", args.bridge_host,
        "--port", str(args.bridge_port),
    ]
    processes.append(ManagedProcess("bridge", bridge_cmd))

    return processes


def supervise(processes, is_shutting_down):
    """One pass of crash detection/restart over all managed processes."""
    for p in processes:
        if p.poll() is None or is_shutting_down() or p.gave_up:
            continue
        if p.restart_count >= MAX_RESTARTS:
            print(f"[launcher] {p.name} keeps crashing (exit {p.poll()}), giving up after {MAX_RESTARTS} restarts")
            p.gave_up = True
            continue
        p.restart_count += 1
        print(f"[launcher] {p.name} exited (code {p.poll()}), restarting ({p.restart_count}/{MAX_RESTARTS})")
        time.sleep(RESTART_BACKOFF_SECONDS)
        p.start()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--camera", type=int, default=None, help="Camera index for vision tracking")
    parser.add_argument("--video", type=str, default=None, help="Video file instead of a live camera (for testing)")
    parser.add_argument("--gspro-port", type=int, default=None, help="Real GSPro Open Connect port; omit to run without the proxy")
    parser.add_argument("--gspro-host", default="127.0.0.1")
    parser.add_argument("--proxy-listen-port", type=int, default=921, help="Port to point Club Optix's GSPro IP at")
    parser.add_argument("--mat-width-mm", type=float, default=1000.0)
    parser.add_argument("--mat-height-mm", type=float, default=1500.0)
    parser.add_argument("--shots-log", default="shots_log.jsonl")
    parser.add_argument("--mat-state-file", default="mat_state.json")
    parser.add_argument("--projector-calibration", default="projector_calibration.json")
    parser.add_argument("--config-file", default="config.json")
    parser.add_argument("--bridge-host", default="0.0.0.0")
    parser.add_argument("--bridge-port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open a browser once the bridge is ready")
    args = parser.parse_args()

    processes = build_processes(args)
    for p in processes:
        p.start()
        print(f"[launcher] started {p.name} (pid {p.proc.pid}): {' '.join(p.cmd)}")

    shutting_down = {"value": False}

    def handle_signal(signum, frame):
        shutting_down["value"] = True

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    if not args.no_browser:
        kiosk_url = f"http://localhost:{args.bridge_port}/"
        print(f"[launcher] waiting for the bridge server at {kiosk_url} ...")
        if wait_until_ready(kiosk_url, READY_CHECK_TIMEOUT_SECONDS):
            webbrowser.open(kiosk_url)
        else:
            print(f"[launcher] bridge didn't come up within {READY_CHECK_TIMEOUT_SECONDS}s, open {kiosk_url} manually")

    try:
        while not shutting_down["value"]:
            supervise(processes, lambda: shutting_down["value"])
            time.sleep(1)
    finally:
        print("[launcher] shutting down...")
        for p in processes:
            p.terminate()


if __name__ == "__main__":
    main()
