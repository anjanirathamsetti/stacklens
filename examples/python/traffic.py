#!/usr/bin/env python3
"""Realistic traffic for the Python examples, including the cross-language paths (standard library only).

    python3 examples/python/traffic.py                 # continuous, ~3 requests/second
    python3 examples/python/traffic.py --rps 10
    python3 examples/python/traffic.py --requests 500  # a fixed number, then exit

Mix: catalog browsing, quotes (fan-out to inventory-api, Node billing-api, Node shipping-service, the
providers), auth failures, unknown products, out-of-stock and GPU-bundle errors, admin reprice / reindex
(N+1) / a slow report, inventory checks and reservations, and Node orders-api calling catalog-api.
Requests to a service that isn't running are counted and skipped.
"""

import argparse
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shared_config import CATALOG_PORT, INVENTORY_PORT  # noqa: E402

CATALOG = os.environ.get("CATALOG_URL", f"http://localhost:{CATALOG_PORT}")
INVENTORY = os.environ.get("INVENTORY_URL", f"http://localhost:{INVENTORY_PORT}")
ORDERS = os.environ.get("EXPRESS_URL", "http://localhost:3001")  # Node orders-api

CATEGORIES = ["keyboards", "audio", "displays", "storage", "gpus"]
PREFIX = {"keyboards": "kb", "audio": "au", "displays": "dp", "storage": "st", "gpus": "gpu"}
CUSTOMERS = ["tok_ada", "tok_ada", "tok_grace", "tok_grace", "tok_ghost"]


def sku(prefix=None, hi=40):
    return f"{prefix or PREFIX[random.choice(CATEGORIES[:4])]}-{random.randint(1, hi):02d}"


def items(n=None, gpu=False):
    out = [{"sku": sku(), "qty": random.choice([1, 1, 1, 2, 3])} for _ in range(n or random.randint(1, 4))]
    if gpu:
        out.append({"sku": sku("gpu"), "qty": 2})
    return out


def bearer(tok):
    return {"authorization": f"Bearer {tok}"}


# (weight, method, url, body, headers)
def scenarios():
    return [
        (10, "GET", lambda: f"{CATALOG}/products?category={random.choice(CATEGORIES)}&limit={random.choice([10, 20, 50])}", None, None),
        (8, "GET", lambda: f"{CATALOG}/products/{sku()}", None, None),
        (1, "GET", lambda: f"{CATALOG}/products/zz-{random.randint(1, 99)}", None, None),
        (8, "POST", lambda: f"{CATALOG}/quotes", lambda: {"items": items(), "zip": random.choice(["94107", "10001", "60601"]), "currency": random.choice(["USD", "USD", "EUR", "GBP"])}, lambda: bearer(random.choice(CUSTOMERS))),
        (2, "POST", lambda: f"{CATALOG}/quotes", lambda: {"items": items(1, gpu=True)}, lambda: bearer("tok_ada")),
        (1, "POST", lambda: f"{CATALOG}/quotes", lambda: {"items": items(2), "zip": "00000"}, lambda: bearer("tok_grace")),
        (2, "POST", lambda: f"{CATALOG}/quotes", lambda: {"items": items(2)}, None),
        (1, "POST", lambda: f"{CATALOG}/quotes", lambda: {"items": items(2)}, lambda: bearer("tok_expired")),
        (1, "POST", lambda: f"{CATALOG}/quotes", lambda: {"items": [{"sku": "kb-01", "qty": 1}], "currency": "CHF"}, lambda: bearer("tok_ada")),
        (1, "PUT", lambda: f"{CATALOG}/admin/products/{sku()}/price", lambda: {"price": round(random.uniform(20, 900), 2)}, lambda: bearer("tok_admin")),
        (1, "PUT", lambda: f"{CATALOG}/admin/products/{sku()}/price", lambda: {"price": 10}, lambda: bearer("tok_ada")),
        (1, "POST", lambda: f"{CATALOG}/admin/reindex-ratings", None, lambda: bearer("tok_admin")),
        (1, "GET", lambda: f"{CATALOG}/admin/reports/category-revenue?weeks={random.choice([2, 4, 8])}", None, lambda: bearer("tok_admin")),
        (5, "GET", lambda: f"{INVENTORY}/stock/{sku(random.choice(['kb', 'au', 'gpu']))}", None, None),
        (2, "POST", lambda: f"{INVENTORY}/stock/check", lambda: {"items": items(random.randint(3, 12))}, None),
        (2, "POST", lambda: f"{INVENTORY}/reservations", lambda: {"sku": sku(), "qty": random.choice([1, 2, 50]), "order_ref": f"ord-{random.randint(1000, 9999)}"}, None),
        (1, "POST", lambda: f"{INVENTORY}/purchase-orders", lambda: {"sku": sku("gpu"), "qty": 10}, lambda: {"x-admin-key": random.choice(["inv_admin_key_1", "wrong"])}),
        (1, "GET", lambda: f"{INVENTORY}/stock/nope-1", None, None),
        # cross-language: Node orders-api → Python catalog-api (→ inventory-api, Node billing-api, …)
        (4, "POST", lambda: f"{ORDERS}/api/quotes/{random.choice([1, 1, 2, 42])}", lambda: {"items": items(2)}, None),
        (3, "GET", lambda: f"{ORDERS}/api/catalog/{sku()}", None, None),
    ]


def request(method, url, body=None, headers=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            res.read()
            return res.status
    except urllib.error.HTTPError as e:
        e.read()
        return e.code
    except Exception:
        return "down"


def run(total, rps, workers=6):
    table = scenarios()
    weights = [w for w, *_ in table]
    counts = Counter()
    lock = threading.Lock()
    sent = [0]
    stop = threading.Event()

    def worker():
        while not stop.is_set():
            with lock:
                if total and sent[0] >= total:
                    return
                sent[0] += 1
            _, method, url, body, headers = random.choices(table, weights)[0]
            u = url()
            status = request(method, u, body() if body else None, headers() if headers else None)
            with lock:
                counts[(u.split("/")[2], status)] += 1
            time.sleep(workers / rps * random.uniform(0.5, 1.5))

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(workers)]
    for t in threads:
        t.start()
    try:
        last = time.time()
        while any(t.is_alive() for t in threads):
            time.sleep(0.5)
            if time.time() - last > 10:
                last = time.time()
                print(f"{sent[0]} requests: " + ", ".join(f"{h} {s}×{n}" for (h, s), n in sorted(counts.items(), key=str)), flush=True)
    except KeyboardInterrupt:
        stop.set()
    print(f"done, {sent[0]} requests: " + ", ".join(f"{h} {s}×{n}" for (h, s), n in sorted(counts.items(), key=str)), flush=True)
    return counts


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rps", type=float, default=3)
    ap.add_argument("--requests", type=int, default=0, help="stop after this many (default: run until Ctrl-C)")
    args = ap.parse_args()
    run(args.requests, args.rps)
