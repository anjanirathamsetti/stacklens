import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Framework-agnostic request context for HTTP handlers.
 *
 * Handlers are plain `(req: Request, ctx) => Response` functions. `route()` runs each one inside an
 * AsyncLocalStorage scope so helpers deep in the call stack (sessions, rate limits, audit) can read
 * the request's headers and cookies and queue `Set-Cookie` headers, which `route()` adds to the
 * response. No Next.js APIs are involved, so the same handlers can be mounted on any server.
 */

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  expires?: Date;
  maxAge?: number;
}

interface RequestContext {
  req: Request;
  cookies: Map<string, string>;
  setCookies: string[];
  /** per-request memo (e.g. the signed-in user) */
  memo: Map<string, unknown>;
}

const store = new AsyncLocalStorage<RequestContext>();

function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    try {
      out.set(name, decodeURIComponent(raw));
    } catch {
      out.set(name, raw);
    }
  }
  return out;
}

export function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`];
  if (o.expires) parts.push(`Expires=${o.expires.toUTCString()}`);
  if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(o.maxAge)}`);
  if (o.httpOnly) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  if (o.sameSite) parts.push(`SameSite=${o.sameSite[0].toUpperCase()}${o.sameSite.slice(1)}`);
  return parts.join('; ');
}

function current(): RequestContext {
  const ctx = store.getStore();
  if (!ctx) throw new Error('No request context: wrap the handler with route() or withAuth()');
  return ctx;
}

export const inRequest = () => store.getStore() !== undefined;
export const requestHeader = (name: string): string | null => current().req.headers.get(name);
export const requestCookie = (name: string): string | undefined => current().cookies.get(name);

export function setResponseCookie(name: string, value: string, opts?: CookieOptions): void {
  const ctx = current();
  ctx.setCookies.push(serializeCookie(name, value, opts));
  ctx.cookies.set(name, value);
}

export function deleteResponseCookie(name: string): void {
  const ctx = current();
  ctx.setCookies.push(serializeCookie(name, '', { maxAge: 0, expires: new Date(0) }));
  ctx.cookies.delete(name);
}

/** Memoize a value for the rest of this request. */
export async function perRequest<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const ctx = store.getStore();
  if (!ctx) return compute();
  if (!ctx.memo.has(key)) ctx.memo.set(key, compute());
  return ctx.memo.get(key) as Promise<T>;
}

export type Handler<C = unknown> = (req: Request, ctx: C) => Promise<Response> | Response;

/** Wrap a handler so it runs with a request context and its queued cookies reach the response. */
export function route<C = unknown>(handler: Handler<C>): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    // nested route()/withAuth() share the outer context
    if (store.getStore()) return handler(req, ctx);
    const context: RequestContext = { req, cookies: parseCookies(req.headers.get('cookie')), setCookies: [], memo: new Map() };
    const res = await store.run(context, () => handler(req, ctx));
    if (!context.setCookies.length) return res;
    const headers = new Headers(res.headers);
    for (const c of context.setCookies) headers.append('set-cookie', c);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
