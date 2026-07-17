import http.server
import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import launcher


def test_managed_process_start_poll_terminate():
    p = launcher.ManagedProcess("sleeper", [sys.executable, "-c", "import time; time.sleep(5)"])
    p.start()
    try:
        assert p.poll() is None, "expected the process to still be running right after start"
    finally:
        p.terminate()

    assert p.poll() is not None, "expected terminate() to have stopped the process"


def test_managed_process_poll_reflects_natural_exit():
    p = launcher.ManagedProcess("quick-exit", [sys.executable, "-c", "pass"])
    p.start()
    p.proc.wait(timeout=5)
    assert p.poll() == 0


def test_wait_until_ready_returns_true_once_server_is_up():
    handler = http.server.SimpleHTTPRequestHandler
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        assert launcher.wait_until_ready(f"http://127.0.0.1:{port}/", timeout_seconds=3) is True
    finally:
        httpd.shutdown()


def test_wait_until_ready_returns_false_when_nothing_is_listening():
    # Port 1 is a privileged port almost certainly not bound to anything reachable here.
    assert launcher.wait_until_ready("http://127.0.0.1:1/", timeout_seconds=1) is False


class FakeProcess:
    """Stands in for ManagedProcess in supervise() tests, without spawning real subprocesses."""

    def __init__(self, name, exit_codes):
        self.name = name
        self._exit_codes = list(exit_codes)  # poll() pops from here each call, None means "still running"
        self.restart_count = 0
        self.gave_up = False
        self.start_calls = 0

    def poll(self):
        return self._exit_codes[0] if self._exit_codes else None

    def start(self):
        self.start_calls += 1
        if self._exit_codes:
            self._exit_codes.pop(0)


def test_supervise_restarts_a_crashed_process():
    p = FakeProcess("thing", [1])  # crashed with exit code 1, then "running" (None) after restart
    launcher.supervise([p], lambda: False)
    assert p.start_calls == 1
    assert p.restart_count == 1
    assert p.gave_up is False


def test_supervise_does_not_touch_a_healthy_process():
    p = FakeProcess("thing", [])  # poll() always None = still running
    launcher.supervise([p], lambda: False)
    assert p.start_calls == 0
    assert p.restart_count == 0


def test_supervise_gives_up_after_max_restarts():
    p = FakeProcess("flaky", [])
    p.restart_count = launcher.MAX_RESTARTS
    p._exit_codes = [1]  # currently crashed
    launcher.supervise([p], lambda: False)
    assert p.gave_up is True
    assert p.start_calls == 0, "should not restart once given up"


def test_supervise_does_not_restart_once_gave_up_is_set():
    p = FakeProcess("flaky", [1])
    p.gave_up = True
    launcher.supervise([p], lambda: False)
    assert p.start_calls == 0


def test_supervise_skips_restart_while_shutting_down():
    p = FakeProcess("thing", [1])
    launcher.supervise([p], lambda: True)
    assert p.start_calls == 0
