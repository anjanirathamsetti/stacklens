import { clearTraces, pageTraces } from '@/server/repositories/trace-repository';
import { parseQuery } from '@/server/parse-query';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return Response.json(await pageTraces(parseQuery(req.url)));
}

export async function DELETE() {
  await clearTraces();
  return Response.json({ ok: true });
}
