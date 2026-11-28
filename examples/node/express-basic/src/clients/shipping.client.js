// Calls the shipping service, which does NOT run StackLens. StackLens still records each request
// and response on the outgoing-call span; the API key header is redacted before it leaves the process.
const axios = require('axios');

const SHIPPING_URL = process.env.SHIPPING_URL || 'http://localhost:3003';
const api = axios.create({ baseURL: SHIPPING_URL, headers: { 'x-api-key': 'demo-shipping-key' }, timeout: 5000 });

class ShippingClient {
  /** POST JSON with axios. */
  async quote(zip, items, service = 'standard') {
    try {
      const res = await api.post('/quotes', { zip, items: items.map((i) => ({ sku: i.sku, qty: i.qty })), service });
      return res.data;
    } catch (e) {
      const err = new Error(e.response?.data?.error ?? `shipping-service unreachable: ${e.message}`);
      err.status = e.response?.status === 422 ? 422 : 502;
      throw err;
    }
  }

  /** GET a streamed text body with fetch, reading it chunk by chunk. */
  async label(id) {
    const res = await fetch(`${SHIPPING_URL}/labels/${encodeURIComponent(id)}`, { headers: { 'x-api-key': 'demo-shipping-key' } });
    if (!res.ok) throw Object.assign(new Error(`shipping-service answered ${res.status}`), { status: 502 });
    const decoder = new TextDecoder();
    let text = '';
    for await (const chunk of res.body) text += decoder.decode(chunk, { stream: true });
    return text;
  }
}

module.exports = new ShippingClient();
