import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tracer } from '../core/tracer';
import { instrumentClass } from '../instrumentation/wrap';

const REPO_METHODS = [
  'find',
  'findOne',
  'findOneBy',
  'findBy',
  'findAndCount',
  'findAndCountBy',
  'findOneOrFail',
  'findOneByOrFail',
  'save',
  'insert',
  'update',
  'upsert',
  'delete',
  'remove',
  'softDelete',
  'softRemove',
  'restore',
  'count',
  'countBy',
  'exist',
  'exists',
  'existsBy',
  'increment',
  'decrement',
  'query',
  'preload',
  'sum',
  'average',
  'minimum',
  'maximum',
];

/**
 * Patch TypeORM so that every repository / entity-manager call and the raw SQL it
 * runs show up in the call tree (kind = "repository" / "db").
 *
 * ```ts
 * stacklens.instrumentTypeORM(require('typeorm'));
 * ```
 */
export interface TypeOrmInstrumentOptions {
  /** Also record QueryBuilder executions and raw SQL (QueryRunner.query). Default true. */
  sql?: boolean;
}

export function instrumentTypeORM(typeorm: any, opts: TypeOrmInstrumentOptions = {}) {
  if (!typeorm) return;
  if (typeorm.Repository) {
    instrumentClass(typeorm.Repository, { include: REPO_METHODS, kind: 'repository' });
  }
  if (typeorm.EntityManager) {
    instrumentClass(typeorm.EntityManager, {
      include: [...REPO_METHODS, 'transaction'],
      kind: 'repository',
      name: 'EntityManager',
    });
  }
  if (opts.sql !== false && typeorm.SelectQueryBuilder) {
    instrumentClass(typeorm.SelectQueryBuilder, {
      include: ['getMany', 'getOne', 'getRawMany', 'getRawOne', 'getManyAndCount', 'getCount', 'getExists', 'execute', 'getOneOrFail'],
      kind: 'db',
      name: 'QueryBuilder',
    });
  }
  // Raw SQL: wrap QueryRunner.query for every driver we can find
  if (opts.sql !== false) patchQueryRunners(typeorm);
}

function patchQueryRunners(typeorm: any) {
  const names = Object.keys(typeorm).filter((k) => /QueryRunner$/.test(k) && typeof typeorm[k] === 'function');
  const candidates = names.map((n) => typeorm[n]);
  // Drivers are not always re-exported; try well-known paths
  const paths = [
    'typeorm/driver/postgres/PostgresQueryRunner',
    'typeorm/driver/mysql/MysqlQueryRunner',
    'typeorm/driver/sqlite/SqliteQueryRunner',
    'typeorm/driver/better-sqlite3/BetterSqlite3QueryRunner',
    'typeorm/driver/sqljs/SqljsQueryRunner',
    'typeorm/driver/sqlserver/SqlServerQueryRunner',
    'typeorm/driver/oracle/OracleQueryRunner',
  ];
  // Resolve from the host application (where typeorm is installed), not only from wherever the
  // process happened to be started: the entry script's folder first, then the working directory.
  // (process.argv[1] works in both the ESM and CommonJS builds, unlike require.main / __filename.)
  const entry = process.argv[1] ? resolve(process.argv[1]) : undefined;
  const bases = [entry, join(process.cwd(), 'package.json')].filter((b): b is string => !!b);
  for (const p of paths) {
    for (const base of bases) {
      try {
        const mod = createRequire(base)(p);
        const C = Object.values(mod).find((v) => typeof v === 'function') as Function | undefined;
        if (C && !candidates.includes(C)) candidates.push(C);
        break;
      } catch {
        /* not resolvable from this base (or driver not installed) */
      }
    }
  }
  for (const C of candidates) {
    instrumentClass(C, { include: ['query'], kind: 'db', name: 'SQL' });
  }
  if (tracer.opts.debug && candidates.length === 0) {
    console.log('[stacklens] no TypeORM query runners found – SQL spans disabled');
  }
}
