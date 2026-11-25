import type { IngestRequest, IngestResponse, TraceRecord } from '@stacklens/types';
import { ingestTraces } from '@/server/repositories/trace-repository';

export const dynamic = 'force-dynamic';

/** Receives trace batches from `@stacklens/tracer` (body: `{ traces: TraceRecord[] }` or a single trace). */
export async function POST(req: Request) {
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
