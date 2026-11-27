import { describe, expect, it } from 'vitest';
import { formatSql, looksLikeSql, sqlSummary, tokenizeSql } from '../src/sql-format';

const TYPEORM_FIND = `SELECT "User"."id" AS "User_id", "User"."name" AS "User_name", "User__User_orders"."id" AS "User__User_orders_id" FROM "user" "User" LEFT JOIN "order" "User__User_orders" ON "User__User_orders"."userId"="User"."id" WHERE (("User"."id" = ?)) LIMIT 1`;

const SAMPLES = [
  TYPEORM_FIND,
  `SELECT o.status AS status, COUNT(*) AS count FROM "order" "o" WHERE o.amount BETWEEN $1 AND $2 AND o.note = 'it''s, AND fine' GROUP BY o.status ORDER BY count DESC`,
  `INSERT INTO "order"("amount", "status") VALUES (?, ?), (?, ?) RETURNING "id"`,
  `SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 100 AND status = 'paid') OR admin = true; -- trailing comment`,
  `update "user" set "name" = $1, meta = meta || '{"a":1}'::jsonb where "id" = $3`,
];

const significant = (sql: string) =>
  tokenizeSql(sql)
    .filter((t) => t.type !== 'ws')
    .map((t) => t.text);

describe('formatSql', () => {
  it('only changes whitespace', () => {
    for (const sql of SAMPLES) expect(significant(formatSql(sql))).toEqual(significant(sql));
  });

  it('puts clauses on their own lines with indented contents', () => {
    expect(formatSql(TYPEORM_FIND)).toBe(
      [
        'SELECT',
        '  "User"."id" AS "User_id",',
        '  "User"."name" AS "User_name",',
        '  "User__User_orders"."id" AS "User__User_orders_id"',
        'FROM',
        '  "user" "User"',
        '  LEFT JOIN "order" "User__User_orders" ON "User__User_orders"."userId" = "User"."id"',
        'WHERE',
        '  (("User"."id" = ?))',
        'LIMIT 1',
      ].join('\n'),
    );
  });

  it('keeps BETWEEN … AND together, splits other ANDs, and leaves string literals alone', () => {
    const out = formatSql(SAMPLES[1]);
    expect(out).toContain('o.amount BETWEEN $1 AND $2\n  AND o.note');
    expect(out).toContain(`'it''s, AND fine'`);
    expect(out).toContain('COUNT(*) AS count');
  });

  it('indents subqueries and closes them on their own line', () => {
    expect(formatSql(SAMPLES[3])).toContain(
      [
        '  id IN (',
        '    SELECT',
        '      user_id',
        '    FROM',
        '      orders',
        '    WHERE',
        '      total > 100',
        "      AND status = 'paid'",
        '  )',
        '  OR admin = true;',
      ].join('\n'),
    );
  });

  it('keeps casts and function calls tight', () => {
    const out = formatSql(SAMPLES[4]);
    expect(out).toContain(`'{"a":1}'::jsonb`);
    expect(formatSql(SAMPLES[2])).toContain('INSERT INTO "order" ("amount", "status")');
  });
});

describe('helpers', () => {
  it('recognises SQL inside captured values', () => {
    expect(looksLikeSql(TYPEORM_FIND)).toBe(true);
    expect(looksLikeSql('select the best option')).toBe(false);
    expect(looksLikeSql('Order #2 is not refundable')).toBe(false);
    expect(looksLikeSql('DELETE FROM sessions WHERE expires_at < now()')).toBe(true);
  });

  it('summarises a statement as verb + table', () => {
    expect(sqlSummary(TYPEORM_FIND)).toBe('SELECT "user"');
    expect(sqlSummary(SAMPLES[2])).toBe('INSERT "order"');
    expect(sqlSummary(SAMPLES[4])).toBe('UPDATE "user"');
    expect(sqlSummary('BEGIN TRANSACTION')).toBe('BEGIN');
    expect(sqlSummary('SELECT DISTINCT "a"."id" FROM (SELECT "Order"."id" FROM "order" "Order") "a"')).toBe('SELECT "order"');
  });
});
