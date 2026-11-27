import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, userForToken } from '@stacklens/backend/auth/session';

/** The signed-in user for server components (memoized per render). */
export const getCurrentUser = cache(async () => userForToken((await cookies()).get(SESSION_COOKIE)?.value));

export { hasRole } from '@stacklens/backend/auth/session';
