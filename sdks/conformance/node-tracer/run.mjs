#!/usr/bin/env node
// Conformance runner for the Node.js SDK: implements sdks/conformance/scenarios.json with
// @stacklens/node-tracer and prints { "<scenario>": TraceRecord } to stdout.
//   npm run build -w @stacklens/node-tracer && node sdks/conformance/node-tracer/run.mjs | node sdks/conformance/check.mjs -
import { stacklens } from '@stacklens/node-tracer';

const captured = [];
stacklens.init({
  application: 'conformance',
  enabled: true,
  sampleRate: 1,
  captureConsole: false,
  settleMs: 0,
  exporter: (t) => captured.push(t),
});

class OrderRepository {
  async save(order) {
    return { id: 1, ...order };
  }
}
class OrderService {
  constructor(repo) {
    this.repo = repo;
  }
  async place(input) {
    return this.repo.save({ ...input, status: 'placed' });
  }
}
class OrderController {
  constructor(service) {
    this.service = service;
  }
  async create(input) {
    return this.service.place(input);
  }
}
class PaymentError extends Error {
  name = 'PaymentError';
}
class PaymentService {
  async charge(_amount) {
    throw new PaymentError('card declined');
  }
}
class BatchHelper {
  step(i) {
    return i * 2;
  }
}
class BatchService {
  constructor(helper) {
    this.helper = helper;
  }
  run() {
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += this.helper.step(i);
    return sum;
  }
}
class AuditService {
  record(event) {
    stacklens.log('recorded', { event });
    return true;
  }
}
for (const cls of [OrderRepository, OrderService, OrderController, PaymentService, BatchHelper, BatchService, AuditService])
  stacklens.instrumentClass(cls);

const scenarios = {
  'nested-calls': () => new OrderController(new OrderService(new OrderRepository())).create({ sku: 'A-1', qty: 2 }),
  error: () => new PaymentService().charge(42),
  'repeated-calls': () => new BatchService(new BatchHelper()).run(),
  logs: () => new AuditService().record('login'),
};

const results = {};
for (const [name, fn] of Object.entries(scenarios)) {
  captured.length = 0;
  await stacklens.trace(`conformance.${name}`, fn).catch(() => {});
  await new Promise((r) => setTimeout(r, 20)); // traces are exported after settleMs
  results[name] = captured[0];
}
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
