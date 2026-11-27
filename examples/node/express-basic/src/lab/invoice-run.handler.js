// A deep call chain repeated per customer: handler → service → builder → line items → tax →
// rounding, with console output in the loop.  POST /api/lab/invoices/run?customers=300
const { sleep } = require('../repositories/db');

class RoundingHelper {
  round(cents) {
    return Math.round(cents / 5) * 5;
  }
}

class TaxService {
  constructor(rounding) {
    this.rounding = rounding;
  }
  tax(net, country) {
    const rate = { DE: 0.19, FR: 0.2, NL: 0.21, US: 0.07 }[country] ?? 0.2;
    return this.rounding.round(net * rate);
  }
}

class LineItemService {
  items(customerId) {
    return Array.from({ length: 3 + (customerId % 4) }, (_, i) => ({
      sku: `L-${customerId}-${i}`,
      cents: 500 + ((customerId * 31 + i * 17) % 4000),
    }));
  }
}

class InvoiceBuilder {
  constructor(lines, tax) {
    this.lines = lines;
    this.tax = tax;
  }
  async build(customer) {
    const items = this.lines.items(customer.id);
    const net = items.reduce((s, i) => s + i.cents, 0);
    if (customer.id % 150 === 149) throw new Error(`Customer ${customer.id} has no billing address`);
    await sleep(0);
    return { customerId: customer.id, net, tax: this.tax.tax(net, customer.country), lines: items.length };
  }
}

class InvoiceRunService {
  constructor(builder) {
    this.builder = builder;
  }
  async generateAll(customers) {
    const invoices = [];
    const failures = [];
    for (let id = 1; id <= customers; id++) {
      const customer = { id, country: ['DE', 'FR', 'NL', 'US'][id % 4] };
      try {
        invoices.push(await this.builder.build(customer));
        console.log('invoice created', { customerId: id });
      } catch (e) {
        failures.push({ id, reason: e.message });
      }
    }
    return { created: invoices.length, failed: failures.length, failures: failures.slice(0, 3) };
  }
}

class InvoiceRunHandler {
  constructor(service) {
    this.service = service;
  }
  async execute(customers) {
    const started = Date.now();
    const result = await this.service.generateAll(customers);
    return { ...result, ms: Date.now() - started };
  }
}

module.exports = {
  invoiceRun: new InvoiceRunHandler(new InvoiceRunService(new InvoiceBuilder(new LineItemService(), new TaxService(new RoundingHelper())))),
  InvoiceRunHandler,
  InvoiceRunService,
  InvoiceBuilder,
  LineItemService,
  TaxService,
  RoundingHelper,
};
