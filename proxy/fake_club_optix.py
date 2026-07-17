#!/usr/bin/env python3
"""
Minimal stand-in for Club Optix (the launch monitor software), for testing
the proxy without real hardware.

Connects to the given host/port (point this at the proxy, not GSPro) and
sends one sample shot JSON line, based on the fields documented in GSPro's
Open Connect v1 API. Prints whatever comes back.

Usage:
    python fake_club_optix.py --host 127.0.0.1 --port 0921
"""
import argparse
import json
import socket
import time

SAMPLE_SHOT = {
    "DeviceID": "FOCUS Clone Fake LM",
    "Units": "Yards",
    "ShotNumber": 1,
    "APIversion": "1",
    "BallData": {
        "Speed": 148.5,
        "SpinAxis": -4.7,
        "TotalSpin": 4200,
        "BackSpin": 4100,
        "SideSpin": -400,
        "HLA": -2.0,
        "VLA": 12.0,
        "CarryDistance": 220.5,
    },
    "ClubData": {
        "Speed": 103.4,
        "AngleOfAttack": -1.2,
        "FaceToTarget": -1.5,
        "Lie": 0,
        "Loft": 0,
        "Path": -2.1,
        "SpeedAtImpact": 103.0,
        "VerticalFaceImpact": 0,
        "HorizontalFaceImpact": 0,
        "ClosureRate": 0,
    },
    "ShotDataOptions": {"ContainsBallData": True, "ContainsClubData": True},
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--shots", type=int, default=1, help="Number of sample shots to send")
    args = parser.parse_args()

    with socket.create_connection((args.host, args.port)) as sock:
        for i in range(args.shots):
            shot = dict(SAMPLE_SHOT)
            shot["ShotNumber"] = i + 1
            line = json.dumps(shot) + "\n"
            sock.sendall(line.encode())
            print(f"fake Club Optix sent shot {i + 1}")
            reply = sock.recv(4096)
            print(f"fake Club Optix received: {reply!r}")
            time.sleep(1)


if __name__ == "__main__":
    main()
