import { getDb } from '@/server/db/client';
import { TRACES_CHANNEL } from '@/server/repositories/trace-repository';

export const dynamic = 'force-dynamic';

/**
 * Server-sent events: tells the UI when new traces arrive. Backed by PostgreSQL LISTEN/NOTIFY, so it
 * works across server replicas (ingest on one, UI connected to another).
 */
export async function GET(req: Request) {
  const db = await getDb();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          cleanup();
        }
      };
      send(': connected\n\n');
      const unsub = await db.listen(TRACES_CHANNEL, (payload) => send(`data: ${payload}\n\n`));
      const ping = setInterval(() => send(': ping\n\n'), 15000);
      cleanup = () => {
        unsub();
        clearInterval(ping);
      };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  });
}
