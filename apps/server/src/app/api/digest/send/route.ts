import { sendDigest } from '@/server/services/digest-service';
import { withAuth } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

/** Send the digest now to the configured webhook (the "Send test" button). */
export const POST = withAuth('admin', async () => {
  const r = await sendDigest();
  return Response.json(r, { status: r.ok ? 200 : 502 });
});
