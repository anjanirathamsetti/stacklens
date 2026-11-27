import { describe, expect, it } from 'vitest';
import type { SpanRecord, TraceRecord } from '@stacklens/types';
import { busyTime, callCount, selfTimes } from '@stacklens/shared/span-tree';
import { summarize } from '../src/domain/trace-summary';

const span = (s: Partial<SpanRecord> & Pick<SpanRecord, 'id' | 'name'>): SpanRecord => ({
  parentId: null,
  method: s.name,
  kind: 'service',
  start: 0,
  duration: 0,
  status: 'ok',
  async: false,
  params: [],
  ...s,
});

/** root (0–100ms) → checkout (2–100) → lineTotal ×10 recorded + ×9,990 collapsed → findPrice ×9,980 collapsed */
function loopTrace(): TraceRecord {
  const spans: SpanRecord[] = [
    span({ id: 'root', name: 'POST /checkout', kind: 'http', duration: 100 }),
    span({ id: 'checkout', parentId: 'root', name: 'CartService.checkout', start: 2, duration: 98 }),
    ...Array.from({ length: 10 }, (_, i) =>
      span({ id: `l${i}`, parentId: 'checkout', name: 'CartService.lineTotal', start: 3 + i * 0.1, duration: 0.05 }),
    ),
    span({
      id: 'agg',
      parentId: 'checkout',
      name: 'CartService.lineTotal',
      start: 5,
      duration: 90, // wall-clock window
      collapsed: { count: 9_990, totalDuration: 60, minDuration: 0.004, maxDuration: 0.4, errors: 2 },
    }),
    span({
      id: 'agg2',
      parentId: 'agg',
      name: 'PriceRepository.findPrice',
      kind: 'repository',
      start: 5.01,
      duration: 89,
      collapsed: { count: 9_980, totalDuration: 40, minDuration: 0.002, maxDuration: 0.2, errors: 0 },
    }),
  ];
  return {
    id: 't1',
    service: 'shop',
    application: 'shop',
    name: 'POST /checkout',
    kind: 'http',
    startTime: 0,
    duration: 100,
    status: 'ok',
    spans,
  };
}

describe('collapsed spans', () => {
  it('counts calls and busy time, not rows and windows', () => {
    const t = loopTrace();
    const agg = t.spans.find((s) => s.id === 'agg')!;
    expect(callCount(agg)).toBe(9_990);
    expect(busyTime(agg)).toBe(60);
    expect(callCount(t.spans[0])).toBe(1);
  });

  it('computes self time from busy time', () => {
    const self = selfTimes(loopTrace().spans);
    expect(self.get('agg2')).toBe(40); // leaf: all of its busy time
    expect(self.get('agg')).toBe(20); // 60 busy − 40 in its nested calls
    // checkout: 98ms − (10 × 0.05 recorded calls + 60 busy in the collapsed calls) = 37.5ms of loop overhead
    expect(self.get('checkout')).toBeCloseTo(37.5, 5);
  });

  it('reports every folded call in the trace summary', () => {
    const s = summarize(loopTrace());
    expect(s.spanCount).toBe(2 + 10 + 9_990 + 9_980);
    expect(s.kindTime.repository).toBe(40);
  });
});
