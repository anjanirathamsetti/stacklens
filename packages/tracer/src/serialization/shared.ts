/**
 * Helpers shared by the serializers.
 *
 * Serialized values are JSON the StackLens UI knows how to render.
 * Special values are encoded as objects with a `$t` marker:
 *   { $t: 'undefined' } | { $t: 'fn', name } | { $t: 'circular' } | { $t: 'Date', v }
 *   { $t: 'Buffer', length } | { $t: 'Error', name, message, stack } | { $t: 'more', count }
 *   { $t: 'Map', entries } | { $t: 'Set', values } | { $t: 'Promise' } | { $t: 'ref', name, summary }
 * Class instances keep their properties and get a `$class` key.
 */

export interface SerializeLimits {
  maxDepth: number;
  maxStringLength: number;
  maxArrayLength: number;
  maxObjectKeys: number;
  redact: (key: string) => boolean;
}

/** Constructors whose instances are summarized instead of walked (sockets, DB clients, …). */
export const HEAVY_CTORS = new Set([
  'IncomingMessage',
  'ServerResponse',
  'Socket',
  'TLSSocket',
  'Server',
  'EventEmitter',
  'DataSource',
  'Connection',
  'EntityManager',
  'QueryRunner',
  'PostgresQueryRunner',
  'MysqlQueryRunner',
  'Pool',
  'Client',
  'Readable',
  'Writable',
  'Duplex',
  'Transform',
  'ModuleRef',
  'NestApplication',
]);

export function ctorName(v: object): string | undefined {
  try {
    const c = (v as any).constructor;
    return c && typeof c === 'function' ? c.name : undefined;
  } catch {
    return undefined;
  }
}

export function isPlain(v: object): boolean {
  const p = Object.getPrototypeOf(v);
  return p === null || p === Object.prototype;
}

export function summarizeHeavy(name: string, v: any): unknown {
  if (name === 'IncomingMessage' || (v && typeof v.method === 'string' && typeof v.url === 'string' && v.headers)) {
    return { $t: 'ref', name: 'Request', summary: `${v.method} ${v.originalUrl ?? v.url}` };
  }
  if (name === 'ServerResponse') return { $t: 'ref', name: 'Response', summary: `status ${v.statusCode}` };
  if (name === 'Repository' || (v && v.metadata && v.manager && typeof v.find === 'function')) {
    return { $t: 'ref', name: 'Repository', summary: v.metadata?.name };
  }
  return { $t: 'ref', name };
}
