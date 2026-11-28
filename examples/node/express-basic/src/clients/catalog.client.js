// Calls catalog-api, the Python example (examples/python/fastapi-catalog). Both sides run StackLens, so the
// request carries a W3C traceparent and catalog-api's call tree (FastAPI → services → SQL, and its own calls
// to inventory-api and billing-api) links under this call in the StackLens UI.
const CATALOG_URL = process.env.CATALOG_URL || 'http://localhost:3011';
const TOKENS = { 1: 'tok_ada', 2: 'tok_grace', 42: 'tok_ghost' };

class CatalogClient {
  async product(sku) {
    const res = await fetch(`${CATALOG_URL}/products/${encodeURIComponent(sku)}`);
    if (!res.ok) throw Object.assign(new Error(`catalog-api answered ${res.status}`), { status: res.status === 404 ? 404 : 502 });
    return res.json();
  }

  async quote(userId, items) {
    const res = await fetch(`${CATALOG_URL}/quotes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKENS[userId] ?? 'tok_unknown'}` },
      body: JSON.stringify({ items: items.map(({ sku, qty }) => ({ sku, qty })) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Object.assign(new Error(body.error || body.detail || `catalog-api answered ${res.status}`), {
        status: res.status < 500 ? res.status : 502,
      });
    return body;
  }
}

module.exports = new CatalogClient();
