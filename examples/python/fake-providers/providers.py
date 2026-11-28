#!/usr/bin/env python3
"""Fake third-party APIs for the examples (email, FX rates, fraud scoring, supplier orders). Standard library
only and deliberately NOT instrumented: StackLens shows calls to it as "call graph not available".

    python3 examples/python/fake-providers/providers.py        (port 3013)
"""

import json
import os
import random
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shared_config import PROVIDERS_PORT  # noqa: E402

RATES = {"EUR": 0.92, "GBP": 0.79, "JPY": 151.2, "INR": 83.4}


class Handler(BaseHTTPRequestHandler):
    server_version = "providers/1.0"

    def log_message(self, fmt, *args):
        pass

    def send(self, status, body, headers=None):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        if not (self.headers.get("authorization") or "").startswith("Bearer prov_live_"):
            self.send(401, {"error": "invalid credentials"})
            return False
        return True

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_GET(self):
        url = urlsplit(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if not self.authorized():
            return
        if url.path == "/fx/latest":
            time.sleep(random.choice([0.02, 0.03, 0.05, 0.25]))
            sym = q.get("symbols", "EUR")
            if sym not in RATES:
                return self.send(422, {"error": f"unsupported currency {sym}"})
            return self.send(200, {"base": q.get("base", "USD"), "rates": {sym: RATES[sym]}, "timestamp": int(time.time())})
        if url.path == "/fraud/score":
            time.sleep(0.01)
            email = q.get("email", "")
            score = 0.93 if email.startswith("ghost") else round(random.uniform(0.01, 0.4), 2)
            return self.send(200, {"email": email, "score": score, "signals": ["new_device"] if score > 0.5 else []})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        url = urlsplit(self.path)
        if not self.authorized():
            return
        body = self.body()
        if url.path == "/v3/mail/send":
            r = random.random()
            if r < 0.12:
                return self.send(429, {"errors": [{"message": "too many requests"}]}, {"retry-after": "1"})
            if r < 0.15:
                return self.send(500, {"errors": [{"message": "internal error"}]})
            time.sleep(random.uniform(0.02, 0.08))
            return self.send(202, {"message_id": uuid.uuid4().hex[:16], "to": body.get("personalizations", [{}])[0].get("to")})
        if url.path == "/suppliers/purchase-orders":
            time.sleep(0.05)
            return self.send(201, {"po": f"PO-{random.randint(10000, 99999)}", "sku": body.get("sku"), "eta_days": random.randint(3, 21)})
        self.send(404, {"error": "not found"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PROVIDERS_PORT), Handler)
    print(f"fake providers on http://localhost:{PROVIDERS_PORT}", flush=True)
    server.serve_forever()
