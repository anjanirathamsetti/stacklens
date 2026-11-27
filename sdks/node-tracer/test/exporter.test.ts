import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpExporter } from '../src/core/exporter';
import type { TraceRecord } from '../src/types';

const record = (id: string): TraceRecord => ({
  id,
  service: 's',
  name: 'GET /',
  kind: 'http',
  startTime: 0,
  duration: 1,
  status: 'ok',
  spans: [],
});

describe('HttpExporter', () => {
  const received: unknown[] = [];
  const authHeaders: (string | undefined)[] = [];
  let endpoint = '';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      authHeaders.push(req.headers.authorization);
      received.push(JSON.parse(body));
      res.end('{"accepted":1}');
    });
  });
  beforeAll(async () => {
    server.listen(0);
    await new Promise((r) => server.once('listening', r));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ingest`;
  });
  afterAll(() => server.close());

  it('batches queued traces into one POST', async () => {
    const exporter = new HttpExporter({ endpoint: () => endpoint, debug: () => false, flushIntervalMs: 10_000 });
    exporter.enqueue(record('a'));
    exporter.enqueue(record('b'));
    await exporter.flush();
    expect(received.at(-1)).toStrictEqual({ traces: [record('a'), record('b')] });
  });

  it('sends the API key as a bearer token only when one is set', async () => {
    authHeaders.length = 0;
    const withKey = new HttpExporter({ endpoint: () => endpoint, apiKey: () => 'slk_test', debug: () => false });
    withKey.enqueue(record('k1'));
    await withKey.flush();
    const without = new HttpExporter({ endpoint: () => endpoint, debug: () => false });
    without.enqueue(record('k2'));
    await without.flush();
    expect(authHeaders).toEqual(['Bearer slk_test', undefined]);
  });

  it('never throws when the server is unreachable', async () => {
    const exporter = new HttpExporter({ endpoint: () => 'http://127.0.0.1:9/api/ingest', debug: () => false });
    exporter.enqueue(record('c'));
    await expect(exporter.flush()).resolves.toBeUndefined();
  });
});
