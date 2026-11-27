// Nested loops: batches → items → validate / price / currency / write.
// GET /api/lab/catalog-sync?batches=20&size=250  → 5,000 items, ~25,000 calls.
const { products, inventory } = require('./lab.repository');

class ItemValidator {
  validate(item) {
    if (!item.sku.startsWith('P-')) throw new Error(`Invalid SKU ${item.sku}`);
    if (item.qty < 0) throw new RangeError(`Negative quantity for ${item.sku}`);
    return true;
  }
}

class CurrencyConverter {
  toEur(cents, currency) {
    const rate = { EUR: 1, USD: 0.92, GBP: 1.17 }[currency];
    if (rate === undefined) throw new Error(`No rate for ${currency}`);
    return Math.round(cents * rate);
  }
}

class PriceCalculator {
  constructor(fx) {
    this.fx = fx;
  }
  compute(item, product) {
    const base = this.fx.toEur(product.cents, product.currency);
    return { net: base * item.qty, vat: Math.round(base * item.qty * 0.2) };
  }
}

class BatchProcessor {
  constructor(validator, prices) {
    this.validator = validator;
    this.prices = prices;
  }
  async process(batch, batchNo) {
    let ok = 0;
    let failed = 0;
    let net = 0;
    for (const item of batch) {
      try {
        this.validator.validate(item);
        const product = inventory.findBySku(item.sku);
        net += this.prices.compute(item, product).net;
        await inventory.upsert(item);
        ok++;
      } catch {
        failed++;
      }
    }
    if (batchNo % 5 === 0) console.log(`batch ${batchNo} done`, { ok, failed });
    return { ok, failed, net };
  }
}

class CatalogSyncService {
  constructor(processor) {
    this.processor = processor;
  }
  async run(batches, size) {
    const totals = { ok: 0, failed: 0, net: 0, batches };
    for (let b = 0; b < batches; b++) {
      const batch = Array.from({ length: size }, (_, i) => {
        const n = b * size + i;
        // ~1 in 400 rows is bad: a broken SKU or a negative quantity
        const sku = n % 401 === 400 ? `BROKEN-${n}` : products[n % products.length].sku;
        return { sku, qty: n % 523 === 522 ? -1 : 1 + (n % 5) };
      });
      const r = await this.processor.process(batch, b);
      totals.ok += r.ok;
      totals.failed += r.failed;
      totals.net += r.net;
    }
    return totals;
  }
}

// Classes are exported too so StackLens auto-instrumentation can trace every layer.
module.exports = {
  catalogSync: new CatalogSyncService(new BatchProcessor(new ItemValidator(), new PriceCalculator(new CurrencyConverter()))),
  CatalogSyncService,
  BatchProcessor,
  ItemValidator,
  PriceCalculator,
  CurrencyConverter,
};
