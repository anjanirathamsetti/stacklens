import { NextResponse, type NextRequest } from 'next/server';

/**
 * Fast first gate, before any page or API route runs: visitors without a session cookie are sent
 * to /login (pages) or get 401 (API). It only checks that the cookie exists – the session itself
 * is validated against the database by the (app) layout and by `withAuth` in every API route.
 */

const SESSION_COOKIE = 'stacklens_session';

/** Reachable without signing in. */
const PUBLIC_PAGES = ['/login', '/welcome'];
const PUBLIC_API = ['/api/auth/login', '/api/auth/setup', '/api/auth/me', '/api/auth/logout', '/api/health', '/api/ingest'];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PAGES.includes(pathname) || PUBLIC_API.includes(pathname)) return NextResponse.next();
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const login = new URL('/login', req.url);
  if (pathname !== '/' && pathname !== '/change-password') login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // everything except Next's own assets and files with an extension (icons, images, fonts)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
