import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SERVER_PORT, INGEST_PATH } from '@stacklens/types';
import type { StackLensOptions, TraceRecord } from '../types';

type Pattern = string | RegExp;

/** Keys whose values are replaced by "[REDACTED]" unless `redactKeys` is set. */
export const DEFAULT_REDACT_KEYS: Pattern[] = [
  /pass(word|wd)?$/i,
  /secret/i,
  /token/i,
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /api[-_]?key/i,
  /^cvv$/i,
  /card(number)?$/i,
  /^ssn$/i,
];

export const DEFAULT_IGNORE_PATHS: Pattern[] = [/\/favicon\.ico$/, /^\/health/];

/** Fully resolved options – every field has a value. */
export interface ResolvedOptions extends Required<
  Omit<StackLensOptions, 'exporter' | 'redactKeys' | 'ignorePaths' | 'ignoreMethods' | 'serviceName' | 'getUserId' | 'apiKey'>
> {
  exporter?: (trace: TraceRecord) => void;
  apiKey?: string;
  getUserId: (req: any) => string | number | undefined | null;
  redactKeys: Pattern[];
  ignorePaths: Pattern[];
  ignoreMethods: Pattern[];
}

/** Case-insensitive exact match for strings, `.test()` for RegExps. */
export function matcher(list: Pattern[]): (s: string) => boolean {
  return (s) => list.some((p) => (typeof p === 'string' ? p.toLowerCase() === s.toLowerCase() : p.test(s)));
}

/**
 * `matcher()` memoised per key. Object keys repeat constantly (`id`, `status`, …), so after the
 * first lookup redaction is a Map hit instead of ~10 regex tests. Bounded to guard against
 * unbounded dynamic keys.
 */
export function cachedMatcher(list: Pattern[], maxEntries = 5000): (s: string) => boolean {
  const base = matcher(list);
  const cache = new Map<string, boolean>();
  return (s) => {
    let v = cache.get(s);
    if (v === undefined) {
      v = base(s);
      if (cache.size >= maxEntries) cache.clear();
      cache.set(s, v);
    }
    return v;
  };
}

/** `req.user.id | userId | _id | sub`, `req.auth.userId | sub`, or the `x-user-id` header. */
function defaultUserId(req: any): string | number | undefined {
  const user = req?.user;
  const fromUser = user && (typeof user === 'object' ? (user.id ?? user.userId ?? user._id ?? user.sub) : user);
  const header = req?.headers?.['x-user-id'];
  return fromUser ?? req?.auth?.userId ?? req?.auth?.sub ?? (Array.isArray(header) ? header[0] : header);
}

/** Name of the host application, read from its package.json. */
function defaultApplicationName(): string {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name || 'node-app';
  } catch {
    return 'node-app';
  }
}

function envFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value !== 'false' && value !== '0';
}

/** Merge user options with environment variables and defaults. */
export function resolveOptions(o: StackLensOptions, env: NodeJS.ProcessEnv = process.env): ResolvedOptions {
  return {
    application: o.application ?? o.serviceName ?? env.STACKLENS_APP ?? env.STACKLENS_SERVICE ?? defaultApplicationName(),
    project: o.project ?? env.STACKLENS_PROJECT ?? 'default',
    environment: o.environment ?? env.STACKLENS_ENV ?? env.NODE_ENV ?? 'development',
    getUserId: o.getUserId ?? defaultUserId,
    endpoint: o.endpoint ?? env.STACKLENS_ENDPOINT ?? `http://localhost:${DEFAULT_SERVER_PORT}${INGEST_PATH}`,
    apiKey: o.apiKey ?? (env.STACKLENS_API_KEY || undefined),
    enabled: o.enabled ?? envFlag(env.STACKLENS_ENABLED) ?? true,
    sampleRate: o.sampleRate ?? 1,
    captureArgs: o.captureArgs ?? true,
    captureResults: o.captureResults ?? true,
    inferTypes: o.inferTypes ?? true,
    captureConsole: o.captureConsole ?? true,
    maxSpansPerTrace: o.maxSpansPerTrace ?? 2000,
    maxDepth: o.maxDepth ?? 6,
    maxStringLength: o.maxStringLength ?? 2000,
    maxArrayLength: o.maxArrayLength ?? 30,
    maxObjectKeys: o.maxObjectKeys ?? 50,
    redactKeys: o.redactKeys ?? DEFAULT_REDACT_KEYS,
    ignorePaths: o.ignorePaths ?? DEFAULT_IGNORE_PATHS,
    ignoreMethods: o.ignoreMethods ?? [],
    settleMs: o.settleMs ?? 30,
    debug: o.debug ?? true,
    exporter: o.exporter,
  };
}
