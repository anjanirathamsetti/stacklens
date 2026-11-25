import crypto from 'node:crypto';
import type { ErrorRef, SpanKind, TraceRecord, TraceSummary } from '@/lib/api-types';
import { errorOrigins, selfTimes } from '@/lib/span-tree';

/** Everything the database stores about a trace besides the raw call tree. */
export function summarize(t: TraceRecord): TraceSummary {
  const depth = new Map<string | null, number>([[null, 0]]);
  let maxDepth = 0;
  for (const s of t.spans) {
    const d = (depth.get(s.parentId) ?? 0) + 1;
    depth.set(s.id, d);
    if (d > maxDepth) maxDepth = d;
  }
  const self = selfTimes(t.spans);
  const kindTime: Partial<Record<SpanKind, number>> = {};
  for (const s of t.spans) {
    if (s.parentId === null) continue;
    kindTime[s.kind] = (kindTime[s.kind] ?? 0) + (self.get(s.id) ?? 0);
  }
  const origins = errorOrigins(t.spans);
  const errors: ErrorRef[] = t.spans
    .filter((s) => origins.has(s.id) && s.parentId !== null)
    .map((s) => ({
      spanName: s.name,
      kind: s.kind,
      name: s.error?.name ?? 'Error',
      message: s.error?.message ?? '',
      status: s.error?.status,
    }));
  const application = t.application ?? t.service ?? 'unknown';
  return {
    id: t.id,
    service: application,
    application,
    project: t.project ?? 'default',
    environment: t.environment,
    userId: t.userId,
    name: t.name,
    kind: t.kind,
    startTime: t.startTime,
    duration: t.duration,
    status: t.status,
    method: t.http?.method,
    url: t.http?.url,
    route: t.http?.route,
    statusCode: t.http?.statusCode,
    spanCount: t.spans.length,
    errorCount: errors.length,
    maxDepth,
    truncated: t.truncated,
    kindTime,
    errors,
    hasPayload: true,
  };
}

/** Collapse ids, numbers and quoted strings so "User 9 not found" and "User 42 not found" group together. */
export function normalizeMessage(m: string): string {
  return m
    .replace(/\s*\(status \d{3}\)$/, '')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/(["'`]).*?\1/g, '<str>');
}

/** Stable 12-char id of an error group: application + throwing function + error name + normalized message. */
export function errorIdOf(application: string, e: Pick<ErrorRef, 'spanName' | 'name' | 'message'>): string {
  return crypto
    .createHash('sha1')
    .update(`${application}|${e.spanName}|${e.name}|${normalizeMessage(e.message)}`)
    .digest('hex')
    .slice(0, 12);
}

/** HTTP status of an error – from the SDK, or parsed from legacy "(status 404)" messages. */
export function errorStatus(e: Pick<ErrorRef, 'status' | 'message'>): number | undefined {
  return e.status ?? (Number(/\(status (\d{3})\)/.exec(e.message)?.[1] ?? 0) || undefined);
}
