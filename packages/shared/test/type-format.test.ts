import { describe, expect, it } from 'vitest';
import { formatSignature, formatType, tokenizeType } from '../src/type-format';

const sig = (text: string) =>
  tokenizeType(text)
    .map((t) => t.text)
    .join('');

describe('formatType', () => {
  it('keeps short types on one line', () => {
    expect(formatType('Repository<User>')).toBe('Repository<User>');
    expect(formatType('{ id: number; name: string }')).toBe('{ id: number; name: string }');
    expect(formatType('string[] | null')).toBe('string[] | null');
    expect(formatType('(id: number) => unknown')).toBe('(id: number) => unknown');
  });

  it('expands long object types one member per line, recursively', () => {
    const out = formatType(
      '{ id: number; name: string; email: string; roles: string[]; createdAt: Date; orders: { id: number; total: number; status: "paid" | "pending" }[] }',
    );
    expect(out).toBe(
      [
        '{',
        '  id: number;',
        '  name: string;',
        '  email: string;',
        '  roles: string[];',
        '  createdAt: Date;',
        '  orders: {',
        '    id: number;',
        '    total: number;',
        '    status: "paid" | "pending";',
        '  }[];',
        '}',
      ].join('\n'),
    );
  });

  it('only changes whitespace and member semicolons', () => {
    const t = 'Promise<QueryResult { records: unknown[]; affected?: number; raw: Map<string, { a: 1 }> }>';
    const strip = (x: string) => sig(x).replace(/;/g, '');
    expect(strip(formatType(t, 20))).toBe(strip(t));
  });
});

describe('formatSignature', () => {
  it('stays on one line when it fits', () => {
    expect(formatSignature({ name: 'tax', params: [{ name: 'amount', type: 'number' }], returnType: 'number' })).toBe(
      'tax(amount: number): number',
    );
  });

  it('puts parameters on their own lines when they do not fit', () => {
    expect(
      formatSignature({
        async: true,
        name: 'query',
        params: [
          { name: 'query', type: 'string' },
          { name: 'parameters', type: 'string[]' },
          { name: 'useStructuredResult', type: 'boolean' },
        ],
        returnType: 'Promise<QueryResult { records: unknown[]; affected: number; raw: unknown[] }>',
      }),
    ).toBe(
      [
        'async query(',
        '  query: string,',
        '  parameters: string[],',
        '  useStructuredResult: boolean,',
        '): Promise<QueryResult {',
        '  records: unknown[];',
        '  affected: number;',
        '  raw: unknown[];',
        '}>',
      ].join('\n'),
    );
  });

  it('keeps a short parameter list inline and expands the return type instead', () => {
    expect(
      formatSignature({
        async: true,
        name: 'getProfile',
        params: [{ name: 'id', type: 'number' }],
        returnType: 'Promise<{ id: number; name: string; initials: string }>',
      }),
    ).toBe(['async getProfile(id: number): Promise<{', '  id: number;', '  name: string;', '  initials: string;', '}>'].join('\n'));
  });

  it('marks parameters, keys, primitives and type names for highlighting', () => {
    const kinds = Object.fromEntries(tokenizeType('{ user: User; tags?: string[] }').map((t) => [t.text, t.type]));
    expect(kinds).toMatchObject({ user: 'key', User: 'type', tags: 'key', string: 'primitive' });
  });
});

describe('Python types and signatures', () => {
  it('formats a Python signature with def and ->', () => {
    expect(
      formatSignature({
        language: 'python',
        async: true,
        name: 'create_quote',
        params: [
          { name: 'user', type: 'dict[str, Any]' },
          { name: 'zip_code', type: 'str' },
        ],
        returnType: 'Quote',
      }),
    ).toBe('async def create_quote(user: dict[str, Any], zip_code: str) -> Quote');
  });

  it('breaks long Python signatures one parameter per line', () => {
    const out = formatSignature(
      {
        language: 'python',
        name: 'reserve',
        params: [
          { name: 'items', type: 'list[{ sku: str; qty: int; warehouse: str }]' },
          { name: 'order_ref', type: 'str' },
        ],
        returnType: 'Reservation { id: int; warehouse_code: str }',
      },
      40,
    );
    expect(out.startsWith('def reserve(\n  items: ')).toBe(true);
    expect(out).toContain('\n) -> Reservation');
  });

  it('tokenizes Python primitives and arrows', () => {
    const toks = tokenizeType('(a, b) -> None | int');
    expect(toks.find((t) => t.text === '->')?.type).toBe('op');
    expect(toks.find((t) => t.text === 'None')?.type).toBe('primitive');
    expect(toks.find((t) => t.text === 'int')?.type).toBe('primitive');
  });
});
