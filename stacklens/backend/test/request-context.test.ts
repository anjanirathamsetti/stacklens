import { describe, expect, it } from 'vitest';
import { perRequest, requestCookie, route, serializeCookie, setResponseCookie, deleteResponseCookie } from '../src/http/request-context';

describe('request context', () => {
  it('reads request cookies and appends queued Set-Cookie headers', async () => {
    const handler = route(async () => {
      expect(requestCookie('a')).toBe('1 2');
      setResponseCookie('s', 'tok', { httpOnly: true, sameSite: 'lax', secure: true });
      deleteResponseCookie('old');
      return Response.json({ ok: true }, { headers: { 'x-test': 'y' } });
    });
    const res = await handler(new Request('http://x/', { headers: { cookie: 'a=1%202; b=3' } }), {});
    expect(res.headers.get('x-test')).toBe('y');
    const cookies = res.headers.getSetCookie();
    expect(cookies[0]).toBe('s=tok; Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(cookies[1]).toMatch(/^old=; Path=\/; Expires=Thu, 01 Jan 1970.*Max-Age=0/);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('memoizes per request and nests without a new scope', async () => {
    let calls = 0;
    const inner = route(async () => {
      await perRequest('k', async () => ++calls);
      return new Response('ok');
    });
    const outer = route(async (req: Request) => {
      await perRequest('k', async () => ++calls);
      setResponseCookie('n', '1');
      return inner(req, {});
    });
    const res = await outer(new Request('http://x/'), {});
    expect(calls).toBe(1);
    expect(res.headers.getSetCookie()).toEqual(['n=1; Path=/']);
  });

  it('throws outside a request', () => {
    expect(() => requestCookie('a')).toThrow(/No request context/);
    expect(serializeCookie('a', 'b', { maxAge: 10 })).toBe('a=b; Path=/; Max-Age=10');
  });
});
