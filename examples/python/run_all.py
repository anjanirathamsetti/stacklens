#!/usr/bin/env python3
"""Start every Python example (catalog-api, inventory-api, notifications-worker, fake providers) and stop them
together on Ctrl-C. Options and the StackLens endpoint come from the environment (STACKLENS_ENDPOINT, …).

    examples/python/.venv/bin/python examples/python/run_all.py
"""

import os
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shared_config import CATALOG_PORT, INVENTORY_PORT  # noqa: E402

PY = sys.executable
BIN = os.path.dirname(PY)


def services():
    return [
        ("providers", [PY, os.path.join(HERE, "fake-providers", "providers.py")], HERE),
        ("inventory-api", [PY, "-m", "inventory.app"], os.path.join(HERE, "flask-inventory")),
        ("catalog-api", [os.path.join(BIN, "uvicorn"), "catalog.main:app", "--port", str(CATALOG_PORT), "--log-level", "warning"], os.path.join(HERE, "fastapi-catalog")),
        ("notifications-worker", [os.path.join(BIN, "celery"), "-A", "notifications.worker", "worker", "--pool=threads", "-c", "4", "-l", "warning"], os.path.join(HERE, "celery-worker")),
    ]


def main() -> int:
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    procs = []
    for name, cmd, cwd in services():
        print(f"starting {name}: {' '.join(os.path.basename(c) if i == 0 else c for i, c in enumerate(cmd))}", flush=True)
        procs.append((name, subprocess.Popen(cmd, cwd=cwd, env=env)))
    print(f"catalog-api http://localhost:{CATALOG_PORT}  inventory-api http://localhost:{INVENTORY_PORT}  traces → {env.get('STACKLENS_ENDPOINT', 'http://localhost:4300/api/ingest')}", flush=True)

    def stop(*_):
        for _, p in procs:
            if p.poll() is None:
                p.send_signal(signal.SIGINT)
        deadline = time.time() + 8
        for _, p in procs:
            try:
                p.wait(max(0.1, deadline - time.time()))
            except subprocess.TimeoutExpired:
                p.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    while True:
        for name, p in procs:
            if p.poll() is not None:
                print(f"{name} exited with {p.returncode}; stopping the others", flush=True)
                stop()
        time.sleep(0.5)


if __name__ == "__main__":
    sys.exit(main())
