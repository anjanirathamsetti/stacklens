import type { SpanRecord, TraceRecord } from '@stacklens/types';

let n = 0;

/** A realistic trace: controller → service → repository (+ optional error thrown in the service). */
export function makeTrace(
  opts: {
    app?: string;
    project?: string;
    route?: string;
    method?: string;
    status?: number;
    startTime?: number;
    duration?: number;
    userId?: string;
    error?: { name: string; message: string; status?: number };
  } = {},
): TraceRecord {
  const id = `t${String(++n).padStart(6, '0')}${Math.random().toString(16).slice(2, 10)}`;
  const status = opts.status ?? 200;
  const duration = opts.duration ?? 20;
  const route = opts.route ?? '/users/:id';
  const span = (s: Partial<SpanRecord> & Pick<SpanRecord, 'id' | 'name' | 'kind'>): SpanRecord => ({
    parentId: null,
    method: s.name.split('.').pop()!,
    start: 0,
    duration,
    status: 'ok',
    async: true,
    params: [],
    ...s,
  });
  const failed = !!opts.error;
  return {
    id,
    service: opts.app ?? 'orders-api',
    application: opts.app ?? 'orders-api',
    project: opts.project ?? 'storefront',
    environment: 'test',
    userId: opts.userId,
    name: `${opts.method ?? 'GET'} ${route}`,
    kind: 'http',
    startTime: opts.startTime ?? Date.now(),
    duration,
    status: status >= 500 ? 'error' : 'ok',
    http: { method: opts.method ?? 'GET', url: route.replace(':id', '1'), route, statusCode: status, response: { body: { ok: !failed } } },
    spans: [
      span({ id: 'root', name: `${opts.method ?? 'GET'} ${route}`, kind: 'http' }),
      span({
        id: 'ctrl',
        parentId: 'root',
        name: 'UserController.get',
        className: 'UserController',
        kind: 'controller',
        start: 1,
        duration: duration - 2,
        status: failed ? 'error' : 'ok',
        error: failed ? opts.error : undefined,
      }),
      span({
        id: 'svc',
        parentId: 'ctrl',
        name: 'UserService.getProfile',
        className: 'UserService',
        kind: 'service',
        start: 2,
        duration: duration - 4,
        args: [1],
        argTypes: ['number'],
        params: ['id'],
        status: failed ? 'error' : 'ok',
        error: failed ? opts.error : undefined,
      }),
      span({
        id: 'repo',
        parentId: 'svc',
        name: 'UserRepository.findById',
        className: 'UserRepository',
        kind: 'repository',
        start: 3,
        duration: duration / 2,
        resultType: '{ id: number }',
      }),
    ],
  };
}
