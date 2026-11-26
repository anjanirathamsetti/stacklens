import type { IngestRequest, IngestResponse, TraceRecord } from '@stacklens/types';
import { getConfig } from '@/server/repositories/config-repository';
import { verifyApiKey } from '@/server/repositories/account-repository';
import { ingestTraces } from '@/server/repositories/trace-repository';

export const dynamic = 'force-dynamic';

/** `Authorization: Bearer slk_…` or `x-stacklens-key: slk_…` */
function keyFrom(req: Request): string | undefined {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return req.headers.get('x-stacklens-key')?.trim() || undefined;
}

/**
 * Receives trace batches from `@stacklens/tracer` (body: `{ traces: TraceRecord[] }` or a single trace).
 * Instrumented apps authenticate with an API key, not a login. Keys are required once an admin
 * turns on "Require an API key" (Admin → API keys); a key that is sent is always checked.
 */
export async function POST(req: Request) {
  const key = keyFrom(req);
  const { requireIngestKey } = await getConfig('security');
  if (key ? !(await verifyApiKey(key)) : requireIngestKey) {
    return Response.json({ error: key ? 'invalid or revoked API key' : 'API key required' }, { status: 401 });
  }
  let body: IngestRequest | TraceRecord;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const traces = 'traces' in body && Array.isArray(body.traces) ? body.traces : [body as TraceRecord];
  const accepted = await ingestTraces(traces);
  return Response.json({ accepted } satisfies IngestResponse);
}
