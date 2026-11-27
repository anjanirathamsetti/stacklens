import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { instrument, stacklens, type TraceRecord } from '../src';

/**
 * Loop / cardinality protection: a helper called in a 10,000-item loop must not turn into
 * 10,000 spans, a huge payload or a truncated tree that hides the calls after the loop.
 */

const exported: TraceRecord[] = [];
const BASE = { application: 'test-app', exporter: (t: TraceRecord) => exported.push(t), settleMs: 0, captureConsole: false, debug: false };
const DEFAULTS = { maxRepeatedCalls: 10, maxCaptureBytes: 1_000_000, maxSpansPerTrace: 2000, maxLogsPerSpan: 50 };

const nextTrace = () =>
  new Promise<TraceRecord>((resolve) => {
    const start = exported.length;
    const iv = setInterval(() => {
      if (exported.length > start) {
        clearInterval(iv);
        resolve(exported[exported.length - 1]);
      }
    }, 5);
  });

async function traced(fn: () => unknown): Promise<TraceRecord> {
  const pending = nextTrace();
  await stacklens.trace('job:test', fn as () => Promise<unknown>);
  return pending;
}

beforeAll(() => stacklens.init({ ...BASE, ...DEFAULTS }));
beforeEach(() => {
  exported.length = 0;
});
afterEach(() => stacklens.init({ ...BASE, ...DEFAULTS }));

class PriceRepository {
  findPrice(sku: string) {
    return { sku, cents: sku.length * 100, currency: 'EUR', tags: ['a', 'b', 'c'] };
  }
}

class CartService {
  constructor(private prices: PriceRepository) {}
  lineTotal(item: { sku: string; qty: number }) {
    if (item.sku.endsWith('-bad')) throw new Error(`Unknown SKU ${item.sku}`);
    return this.prices.findPrice(item.sku).cents * item.qty;
  }
  save(total: number) {
    return { saved: true, total };
  }
  checkout(items: { sku: string; qty: number }[]) {
    let total = 0;
    for (const item of items) {
      try {
        total += this.lineTotal(item);
      } catch {
        /* skip bad lines */
      }
    }
    return this.save(total);
  }
  async checkoutAsync(items: { sku: string; qty: number }[]) {
    let total = 0;
    for (const item of items) total += await this.lineTotalAsync(item);
    return total;
  }
  async lineTotalAsync(item: { sku: string; qty: number }) {
    return this.prices.findPrice(item.sku).cents * item.qty;
  }
}

const items = (n: number, bad = (_i: number) => false) =>
  Array.from({ length: n }, (_, i) => ({ sku: bad(i) ? `sku-${i}-bad` : `sku-${i}`, qty: 1 }));

describe('repeated calls', () => {
  it('collapses a 10,000-item loop into a few spans and keeps the calls after it', async () => {
    const cart = instrument(new CartService(instrument(new PriceRepository())));
    const trace = await traced(() => cart.checkout(items(10_000)));
    const named = (n: string) => trace.spans.filter((s) => s.name === n);

    const line = named('CartService.lineTotal');
    expect(line.filter((s) => !s.collapsed)).toHaveLength(10); // first 10 recorded in full
    const agg = line.find((s) => s.collapsed)!;
    expect(agg.collapsed!.count).toBe(9_990);
    expect(agg.collapsed!.minDuration).toBeLessThanOrEqual(agg.collapsed!.maxDuration);
    expect(agg.args).toBeUndefined(); // no value capture for collapsed calls

    // queries made inside collapsed calls nest under the aggregate and collapse the same way
    const nestedAgg = named('PriceRepository.findPrice').find((s) => s.collapsed && s.parentId === agg.id)!;
    expect(nestedAgg.collapsed!.count).toBe(9_980);

    // the call after the loop is still there – nothing was truncated
    expect(named('CartService.save')).toHaveLength(1);
    expect(trace.truncated).toBeUndefined();
    expect(trace.spans.length).toBeLessThan(60);
    expect(JSON.stringify(trace).length).toBeLessThan(100_000);
  });

  it('counts failures in collapsed calls and keeps the first few with their arguments', async () => {
    const cart = instrument(new CartService(instrument(new PriceRepository())));
    const trace = await traced(() => cart.checkout(items(5_000, (i) => i % 500 === 499)));
    const all = trace.spans.filter((s) => s.name === 'CartService.lineTotal');
    const agg = trace.spans.find((s) => s.name === 'CartService.lineTotal' && s.collapsed)!;
    expect(agg.collapsed!.errors).toBe(7); // 10 failures: 3 kept as real spans, 7 counted
    expect(agg.status).toBe('ok'); // the failures are reported on their own spans, not the aggregate
    const kept = trace.spans.filter((s) => s.name === 'CartService.lineTotal' && s.status === 'error');
    expect(kept).toHaveLength(3);
    expect(kept[0].args).toStrictEqual([{ sku: 'sku-499-bad', qty: 1 }]);
    expect(kept[0].error?.message).toBe('Unknown SKU sku-499-bad');
    // every call is accounted for exactly once: 10 recorded + 3 kept failures + the aggregate's count
    const aggCount = all.find((s) => s.collapsed)!.collapsed!.count;
    expect(all.filter((s) => !s.collapsed).length + aggCount).toBe(5_000);
  });

  it('collapses awaited calls in a loop', async () => {
    const cart = instrument(new CartService(instrument(new PriceRepository())));
    const trace = await traced(() => cart.checkoutAsync(items(500)));
    const agg = trace.spans.find((s) => s.name === 'CartService.lineTotalAsync' && s.collapsed)!;
    expect(agg.collapsed!.count).toBe(490);
    expect(agg.async).toBe(true);
    expect(agg.duration).toBeGreaterThan(0);
  });

  it('can be turned off, leaving maxSpansPerTrace as the backstop', async () => {
    stacklens.init({ ...BASE, ...DEFAULTS, maxRepeatedCalls: 0, maxSpansPerTrace: 100 });
    const cart = instrument(new CartService(instrument(new PriceRepository())));
    const trace = await traced(() => cart.checkout(items(1_000)));
    expect(trace.spans).toHaveLength(100);
    expect(trace.truncated).toBe(true);
    expect(trace.droppedSpans).toBeGreaterThan(1_800);
  });
});

describe('capture budget', () => {
  it('stops capturing values once maxCaptureBytes is used, but keeps timing', async () => {
    stacklens.init({ ...BASE, ...DEFAULTS, maxCaptureBytes: 3_000, maxRepeatedCalls: 1_000 });
    const cart = instrument(new CartService(instrument(new PriceRepository())));
    const trace = await traced(() => cart.checkout(items(200)));
    const lines = trace.spans.filter((s) => s.name === 'CartService.lineTotal');
    expect(lines).toHaveLength(200);
    expect(lines[0].args).toBeDefined();
    const dropped = lines.filter((s) => s.valuesDropped);
    expect(dropped.length).toBeGreaterThan(150);
    expect(dropped.every((s) => s.result === undefined && s.duration >= 0)).toBe(true);
    // only the call that crossed the budget keeps its (already captured) arguments
    expect(dropped.filter((s) => s.args !== undefined).length).toBeLessThanOrEqual(1);
    expect(trace.valuesTruncated).toBe(true);
  });
});

describe('logs', () => {
  it('keeps maxLogsPerSpan lines and counts the rest', async () => {
    stacklens.init({ ...BASE, ...DEFAULTS, maxLogsPerSpan: 5 });
    const trace = await traced(() => {
      for (let i = 0; i < 40; i++) stacklens.log('info', `line ${i}`);
    });
    const root = trace.spans[0];
    expect(root.logs).toHaveLength(5);
    expect(root.droppedLogs).toBe(35);
  });
});
