#!/usr/bin/env python3
"""
Minimal stand-in for GSPro's Open Connect listener, for testing the proxy
without needing the real GSPro app running.

Accepts a connection, prints whatever it receives, and sends back a canned
acknowledgement JSON line after each message - close enough to validate
that the proxy forwards bytes in both directions untouched.

Usage:
    python fake_gspro.py --port 0920
"""
import argparse
import json
import socket


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.host, args.port))
    server.listen(1)
    print(f"fake GSPro listening on {args.host}:{args.port}")

    while True:
        conn, addr = server.accept()
        print(f"fake GSPro: connection from {addr}")
        with conn:
            while True:
                data = conn.recv(4096)
                if not data:
                    break
                print(f"fake GSPro received: {data!r}")
                ack = json.dumps({"Code": 200, "Message": "GSPro Player Information : Handled"}) + "\n"
                conn.sendall(ack.encode())
        print(f"fake GSPro: connection from {addr} closed")


if __name__ == "__main__":
    main()
