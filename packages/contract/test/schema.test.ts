import { describe, expect, it } from 'vitest';
import type {
  CollapsedCalls,
  HttpExchange,
  IngestRequest,
  OutboundCall,
  SpanError,
  SpanLog,
  SpanRecord,
  TraceParent,
  TraceRecord,
} from '../src/index';
import { schema, validate } from '../schema/validate.mjs';

/* Fully-populated values. `satisfies Required<…>` fails to compile when a field is added to a type
   but not here, and the key comparison below fails when it is missing from the schema. */
const log = { t: 1.5, level: 'info', message: 'hi', data: { a: 1 } } satisfies Required<SpanLog>;
const error = { name: 'NotFound', message: 'nope', stack: 'Error: nope', status: 404 } satisfies Required<SpanError>;
const collapsed = { count: 9990, totalDuration: 12, minDuration: 0, maxDuration: 1, errors: 0 } satisfies Required<CollapsedCalls>;
const outbound = {
  method: 'GET',
  url: 'http://billing:3002/orders/1?token=[REDACTED]',
  host: 'billing:3002',
  statusCode: 200,
  propagated: true,
  childTraceId: 'c0ffee',
} satisfies Required<OutboundCall>;
const parent = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  service: 'orders-api',
} satisfies Required<TraceParent>;
const span = {
  id: 's2',
  parentId: 's1',
  name: 'UserService.find',
  className: 'UserService',
  method: 'find',
  kind: 'service',
  start: 0.4,
  duration: 2.1,
  status: 'error',
  async: true,
  params: ['id'],
  args: [42],
  argTypes: ['number'],
  result: null,
  resultType: 'null',
  error,
  logs: [log],
  attributes: { sql: 'SELECT 1' },
  collapsed,
  valuesDropped: false,
  droppedLogs: 0,
  outbound,
} satisfies Required<SpanRecord>;
const http = {
  method: 'GET',
  url: '/users/42',
  route: '/users/:id',
  statusCode: 404,
  ip: '127.0.0.1',
  request: { headers: {}, query: {}, params: { id: '42' } },
  response: { body: { error: 'nope' } },
} satisfies Required<HttpExchange>;
const root: SpanRecord = {
  id: 's1',
  parentId: null,
  name: 'GET /users/:id',
  method: 'GET',
  kind: 'http',
  start: 0,
  duration: 3,
  status: 'error',
  async: true,
  params: [],
};
const trace = {
  id: 't1',
  service: 'api',
  application: 'api',
  project: 'shop',
  environment: 'dev',
  userId: 'u1',
  name: 'GET /users/:id',
  kind: 'http',
  startTime: Date.now(),
  duration: 3,
  status: 'error',
  http,
  spans: [root, span],
  truncated: false,
  droppedSpans: 0,
  valuesTruncated: false,
  parent,
} satisfies Required<TraceRecord>;

const keysOf = (def: string) => Object.keys(schema.$defs[def].properties ?? {}).sort();

describe('trace.schema.json', () => {
  it.each([
    ['SpanLog', log],
    ['SpanError', error],
    ['CollapsedCalls', collapsed],
    ['OutboundCall', outbound],
    ['TraceParent', parent],
    ['SpanRecord', span],
    ['HttpExchange', http],
    ['TraceRecord', trace],
  ])('%s lists exactly the TypeScript fields', (def, value) => {
    expect(keysOf(def)).toEqual(Object.keys(value).sort());
  });

  it('accepts a full payload and a bare trace', () => {
    expect(validate({ traces: [trace] } satisfies IngestRequest)).toEqual([]);
    expect(validate(trace)).toEqual([]);
  });

  it('rejects contract violations with a path', () => {
    const bad = {
      ...trace,
      spans: [
        { ...span, kind: 'lambda', duration: -1 },
        { ...root, extra: 1 },
      ],
    };
    const errors = validate(bad, 'TraceRecord');
    expect(errors).toContain('$.spans[0].kind: "lambda" is not one of http, controller, handler, service, repository, db, function, job');
    expect(errors).toContain('$.spans[0].duration: -1 < 0');
    expect(errors).toContain('$.spans[1]: unknown property "extra"');
    expect(validate({ traces: [{ id: 'x' }] })).toContain('$.traces[0]: missing required "spans"');
    expect(validate({ ...trace, parent: { traceId: 'a' } }, 'TraceRecord')).toContain('$.parent: missing required "spanId"');
    expect(validate({ ...trace, spans: [{ ...span, outbound: { method: 'GET', url: '/x' } }] }, 'TraceRecord')).toContain(
      '$.spans[0].outbound: missing required "host"',
    );
  });
});
