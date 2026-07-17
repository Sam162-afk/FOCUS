import json
import os
import socket
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "proxy"))

import gspro_proxy  # noqa: E402


def free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_fake_gspro(port, received):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", port))
    server.listen(1)

    def serve():
        conn, _ = server.accept()
        data = conn.recv(4096)
        received.append(data)
        conn.sendall(b'{"Code": 200}\n')
        conn.close()
        server.close()

    threading.Thread(target=serve, daemon=True).start()


def test_proxy_forwards_bytes_unchanged_and_logs_shot(tmp_path):
    gspro_port = free_port()
    proxy_port = free_port()
    shot_log = tmp_path / "shots.jsonl"

    received_by_gspro = []
    start_fake_gspro(gspro_port, received_by_gspro)

    proxy_thread = threading.Thread(
        target=gspro_proxy.run,
        args=("127.0.0.1", proxy_port, "127.0.0.1", gspro_port, str(shot_log)),
        daemon=True,
    )
    proxy_thread.start()
    time.sleep(0.3)  # let the proxy's listen socket come up

    shot = {"ShotNumber": 1, "BallData": {"Speed": 148.5}}
    line = json.dumps(shot) + "\n"

    client = socket.create_connection(("127.0.0.1", proxy_port), timeout=5)
    client.sendall(line.encode())
    reply = client.recv(4096)
    client.close()

    time.sleep(0.3)  # let the shot get logged

    assert received_by_gspro, "fake GSPro never received forwarded data"
    assert received_by_gspro[0] == line.encode(), "proxy must forward bytes to GSPro unchanged"
    assert reply == b'{"Code": 200}\n', "proxy must forward GSPro's reply back to the client unchanged"

    assert shot_log.exists()
    logged = [json.loads(l) for l in shot_log.read_text().splitlines()]
    assert len(logged) == 1
    assert logged[0]["shot"] == shot


def test_line_json_extractor_handles_partial_and_multiple_lines():
    extractor = gspro_proxy.LineJSONExtractor()

    assert extractor.feed(b'{"a": 1}') == []  # no newline yet, nothing to emit
    assert extractor.feed(b"\n") == [{"a": 1}]

    shots = extractor.feed(b'{"a": 2}\n{"a": 3}\n')
    assert shots == [{"a": 2}, {"a": 3}]

    assert extractor.feed(b"not json\n") == []
