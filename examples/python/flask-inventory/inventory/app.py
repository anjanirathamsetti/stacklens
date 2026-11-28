"""inventory-api entry point.

    python -m inventory.app            (from examples/python/flask-inventory; port 3012)
"""

import logging
import os
import sys

import stacklens
from stacklens.integrations.flask import instrument_flask
from stacklens.integrations.sqlalchemy import instrument_sqlalchemy

stacklens.init(application="inventory-api", project="storefront")
instrument_sqlalchemy()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from flask import Flask  # noqa: E402

from . import repository, service  # noqa: E402
from .models import init_db  # noqa: E402
from .views import bp  # noqa: E402

stacklens.instrument_module(repository)
stacklens.instrument_module(service)


def create_app() -> Flask:
    app = Flask("inventory-api")
    app.register_blueprint(bp)
    init_db()
    instrument_flask(app)
    return app


app = create_app()

if __name__ == "__main__":
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from shared_config import INVENTORY_PORT

    from werkzeug.serving import run_simple

    run_simple("0.0.0.0", INVENTORY_PORT, app, threaded=True)
