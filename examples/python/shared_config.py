"""Settings shared by the Python example apps (ports, URLs, Celery broker folder)."""

import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("EXAMPLES_DATA_DIR", os.path.join(HERE, ".data"))

CATALOG_PORT = int(os.environ.get("CATALOG_PORT", "3011"))
INVENTORY_PORT = int(os.environ.get("INVENTORY_PORT", "3012"))
PROVIDERS_PORT = int(os.environ.get("PROVIDERS_PORT", "3013"))

INVENTORY_URL = os.environ.get("INVENTORY_URL", f"http://localhost:{INVENTORY_PORT}")
PROVIDERS_URL = os.environ.get("PROVIDERS_URL", f"http://localhost:{PROVIDERS_PORT}")
# the Node examples (billing-api runs StackLens, shipping-service doesn't)
BILLING_URL = os.environ.get("BILLING_URL", "http://localhost:3002")
SHIPPING_URL = os.environ.get("SHIPPING_URL", "http://localhost:3003")


def celery_broker_options():
    """Kombu's filesystem transport: no Redis/RabbitMQ needed for the demo."""
    folder = os.path.join(DATA_DIR, "broker")
    os.makedirs(os.path.join(folder, "processed"), exist_ok=True)
    return {
        "broker_url": "filesystem://",
        "broker_transport_options": {"data_folder_in": folder, "data_folder_out": folder, "processed_folder": os.path.join(folder, "processed"), "store_processed": False},
        "task_ignore_result": True,
        "broker_connection_retry_on_startup": True,
    }
