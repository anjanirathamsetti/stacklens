import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { capture, inferType, serialize, type SerializeLimits } from '../src/serialization';

const limits: SerializeLimits = {
  maxDepth: 6,
  maxStringLength: 40,
  maxArrayLength: 30,
  maxObjectKeys: 50,
  redact: (k) => /pass|token|secret/i.test(k),
};

/** `capture()` is the single-pass hot path; it must equal the two reference walkers exactly. */
function expectEquivalent(value: unknown) {
  const reference = { value: serialize(value, limits), type: inferType(value) };
  expect(capture(value, limits, true)).toStrictEqual(reference);
  expect(capture(value, limits, false)).toStrictEqual({ value: reference.value });
}

class User {
  id = 1;
  name = 'Ada';
  tags = ['a', 'b'];
  created = new Date(0);
}
class Money {
  constructor(private v: number) {}
  toJSON() {
    return { amount: this.v, currency: 'USD' };
  }
}

describe('capture', () => {
  it.each<[string, unknown]>([
    ['number', 42],
    ['NaN', NaN],
    ['long string', 'x'.repeat(100)],
    ['bigint', 10n],
    ['undefined', undefined],
    ['null', null],
    ['class instance', new User()],
    ['toJSON object', new Money(5)],
    ['Map', new Map([['a', { x: 1 }]])],
    ['Set', new Set([1, 2])],
    ['Date', new Date(0)],
    ['Invalid Date', new Date('x')],
    ['Buffer', Buffer.from('hi')],
    ['typed array', new Uint8Array([1, 2])],
    ['Error', new TypeError('bad')],
    ['RegExp', /a+/g],
    ['EventEmitter', new EventEmitter()],
    ['function', function named(_a: number, _b = 2) {}],
    ['big array', Array.from({ length: 45 }, (_, i) => ({ i }))],
    ['many keys', Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`k${i}`, i]))],
    ['redacted keys', { password: 'hunter2', apiToken: 'x', safe: 'ok' }],
    ['undefined values', { a: undefined, 'weird key': 1 }],
    ['mixed array', [1, 'a', null, { x: 1 }, [2]]],
  ])('matches the reference walkers for %s', (_label, value) => expectEquivalent(value));

  it('handles circular references', () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    o.list = [o, { back: o }];
    expectEquivalent(o);
    expect((serialize(o, limits) as Record<string, unknown>).self).toStrictEqual({ $t: 'circular' });
  });

  it('handles getters that throw', () => {
    const o = { ok: 1 };
    Object.defineProperty(o, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter!');
      },
    });
    expectEquivalent(o);
  });

  it('handles deep nesting beyond the depth limit', () => {
    const root: Record<string, unknown> = {};
    let cur = root;
    for (let i = 0; i < 12; i++) cur = (cur.next = { level: i }) as Record<string, unknown>;
    expectEquivalent(root);
  });

  it('matches on randomly generated structures', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let budget = 0;
    const leaf = () =>
      [() => Math.floor(rnd() * 100), () => `s${Math.floor(rnd() * 9)}`, () => rnd() > 0.5, () => null, () => undefined, () => new User()][
        Math.floor(rnd() * 6)
      ]();
    const gen = (d: number): unknown => {
      const r = rnd();
      if (d > 7 || r < 0.35 || --budget < 0) return leaf();
      if (r < 0.6) return Array.from({ length: Math.floor(rnd() * (d < 2 ? 35 : 4)) }, () => gen(d + 1));
      const o: Record<string, unknown> = {};
      for (let i = 0, n = Math.floor(rnd() * (d < 2 ? 55 : 5)); i < n; i++) o[(rnd() > 0.9 ? 'password' : 'f') + i] = gen(d + 1);
      return o;
    };
    for (let i = 0; i < 500; i++) {
      budget = 300;
      expectEquivalent(gen(0));
    }
  });
});

describe('inferType', () => {
  it('describes object shapes', () => {
    expect(inferType({ id: 1, email: 'a', roles: ['x'], created: new Date() })).toBe(
      '{ id: number; email: string; roles: string[]; created: Date }',
    );
    expect(inferType([1, 'a'])).toBe('(number | string)[]');
    expect(inferType(new User())).toBe('User { id: number; name: string; tags: string[]; created: Date }');
  });
});
