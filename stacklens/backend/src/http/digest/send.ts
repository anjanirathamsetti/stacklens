import { sendDigest } from '../../services/digest-service';
import { withAuth } from '../../auth/guard';

/** Send the digest now to the configured webhook (the "Send test" button). */
export const POST = withAuth('admin', async () => {
  const r = await sendDigest();
  return Response.json(r, { status: r.ok ? 200 : 502 });
});
