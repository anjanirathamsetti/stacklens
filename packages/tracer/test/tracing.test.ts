import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { instrument, stacklens, wrapFunction, type TraceRecord } from '../src';

const exported: TraceRecord[] = [];
const nextTrace = () =>
  new Promise<TraceRecord>((resolve) => {
    const start = exported.length;
    const iv = setInterval(() => {
      if (exported.length > start) {
        clearInterval(iv);
        resolve(exported[exported.length - 1]);
      }
    }, 5);
  });

beforeAll(() => {
  stacklens.init({ application: 'test-app', exporter: (t) => exported.push(t), settleMs: 0, captureConsole: false, debug: false });
});
beforeEach(() => {
  exported.length = 0;
});

class UserRepository {
  async findById(id: number) {
    await new Promise((r) => setTimeout(r, 2));
    return id === 1 ? { id, name: 'Ada' } : null;
  }
}
class UserService {
  constructor(private repo: UserRepository) {}
  async getProfile(id: number) {
    const user = await this.repo.findById(id);
    if (!user) throw Object.assign(new Error(`User ${id} not found`), { status: 404 });
    return { ...user, initials: this.initials(user.name) };
  }
  initials(name: string) {
    return name.slice(0, 1);
  }
}

describe('wrapFunction', () => {
  it('is a pass-through outside a trace and keeps name and length', () => {
    const add = (a: number, b: number) => a + b;
    const wrapped = wrapFunction(add, { method: 'add' });
    expect(wrapped(1, 2)).toBe(3);
    expect(wrapped.name).toBe('add');
    expect(wrapped.length).toBe(2);
    expect(exported).toHaveLength(0);
  });

  it('records nested calls, arguments, results and types inside stacklens.trace()', async () => {
    const service = instrument(new UserService(instrument(new UserRepository())));
    const pending = nextTrace();
    await stacklens.trace('job:test', () => service.getProfile(1));
    const trace = await pending;

    const byName = Object.fromEntries(trace.spans.map((s) => [s.name, s]));
    expect(trace.kind).toBe('job');
    expect(byName['UserService.getProfile'].args).toStrictEqual([1]);
    expect(byName['UserService.getProfile'].resultType).toBe('{ id: number; name: string; initials: string }');
    // nesting follows the await chain
    expect(byName['UserRepository.findById'].parentId).toBe(byName['UserService.getProfile'].id);
    expect(byName['UserService.initials'].parentId).toBe(byName['UserService.getProfile'].id);
  });

  it('records errors with their HTTP status', async () => {
    const service = instrument(new UserService(instrument(new UserRepository())));
    const pending = nextTrace();
    await expect(stacklens.trace('job:fail', () => service.getProfile(9))).rejects.toThrow('User 9 not found');
    const trace = await pending;
    const span = trace.spans.find((s) => s.name === 'UserService.getProfile')!;
    expect(span.status).toBe('error');
    expect(span.error).toMatchObject({ message: 'User 9 not found', status: 404 });
  });
});

describe('express middleware', () => {
  let base = '';
  let close = () => {};
  beforeAll(async () => {
    const service = instrument(new UserService(instrument(new UserRepository())));
    const app = express();
    app.use(stacklens.express());
    app.use(express.json());
    app.get('/users/:id', async (req, res) => {
      try {
        res.json(await service.getProfile(Number(req.params.id)));
      } catch (e) {
        res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
      }
    });
    app.post('/echo', (req, res) => res.status(201).json(req.body));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it('creates one trace per request with route, status, user and body', async () => {
    const pending = nextTrace();
    const res = await fetch(`${base}/users/1`, { headers: { 'x-user-id': 'u_1' } });
    expect(res.headers.get('x-stacklens-trace-id')).toMatch(/^[0-9a-f]{32}$/);
    const trace = await pending;
    expect(trace.http).toMatchObject({ method: 'GET', route: '/users/:id', statusCode: 200 });
    expect(trace.userId).toBe('u_1');
    expect(trace.http?.response?.body).toMatchObject({ id: 1, name: 'Ada' });
    expect(trace.spans.map((s) => s.name)).toEqual(expect.arrayContaining(['UserService.getProfile', 'UserRepository.findById']));
  });

  it('keeps context through express.json() so the body is captured', async () => {
    const pending = nextTrace();
    await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world', password: 'x' }),
    });
    const trace = await pending;
    expect(trace.http?.request?.body).toStrictEqual({ hello: 'world', password: '[REDACTED]' });
    expect(trace.http?.statusCode).toBe(201);
  });

  it('marks 4xx as ok and records the thrown error on the span', async () => {
    const pending = nextTrace();
    await fetch(`${base}/users/9`);
    const trace = await pending;
    expect(trace.status).toBe('ok');
    expect(trace.http?.statusCode).toBe(404);
    expect(trace.spans.find((s) => s.name === 'UserService.getProfile')?.error?.status).toBe(404);
  });
});
