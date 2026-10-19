#!/usr/bin/env python3
"""M0-only diagnostic beacon for the Quick Note extension prototype.

Listens on 127.0.0.1:8787 and appends every received event to beacon.log as
JSON lines. The extension service worker reports command/window events here
so the M0 bridge test can prove the full chain:

    Space+N chord (Swift helper) -> synthetic Ctrl+Shift+7 -> Chrome command
    -> capture window opens + beacon entry with a timestamp.

This file is development tooling only. It is NOT part of the product, sends
nothing anywhere, and will be removed before beta (M5).

Usage:
    python3 beacon.py          # runs until Ctrl+C
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 8787
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "beacon.log")


class BeaconHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (stdlib naming)
        parsed = urlparse(self.path)

        if parsed.path == "/qn-event":
            query = parse_qs(parsed.query)
            record = {
                "recv_ts": round(time.time(), 3),
                "event": (query.get("event") or [""])[0],
                "trigger": (query.get("trigger") or [""])[0],
                "sent_ts_ms": (query.get("t") or [""])[0],
            }
            with open(LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
            print(json.dumps(record), flush=True)
            self._respond(204, b"")

        elif parsed.path == "/health":
            self._respond(200, b"ok")

        else:
            self._respond(404, b"not found")

    def _respond(self, code, body):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, *args):  # keep the console output clean
        pass


if __name__ == "__main__":
    print(f"M0 beacon listening on http://{HOST}:{PORT} -> {LOG_PATH}")
    HTTPServer((HOST, PORT), BeaconHandler).serve_forever()
