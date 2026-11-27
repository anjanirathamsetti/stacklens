import type { TraceRecord } from '../types';
import { originalConsole } from './console';
import { traceContext } from './context';

export interface HttpExporterOptions {
  endpoint: () => string;
  /** sent as `Authorization: Bearer …` when set */
  apiKey?: () => string | undefined;
  debug: () => boolean;
  /** Send as soon as this many traces are queued. */
  batchSize?: number;
  /** Otherwise send this long after the first trace was queued. */
  flushIntervalMs?: number;
}

/**
 * Batches traces and POSTs them to the StackLens server, off the request path.
 *
 * Each trace is JSON-encoded when it is queued rather than the whole batch at once: spreading the
 * encoding work avoids one large `JSON.stringify` stalling the event loop (visible as p99 latency).
 * Network failures are swallowed and reported once until the next success.
 */
export class HttpExporter {
  private queue: string[] = [];
  private timer?: NodeJS.Timeout;
  private warned = false;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  constructor(private readonly opts: HttpExporterOptions) {
    this.batchSize = opts.batchSize ?? 25;
    this.flushIntervalMs = opts.flushIntervalMs ?? 250;
  }

  enqueue(record: TraceRecord): void {
    let json: string;
    try {
      json = JSON.stringify(record);
    } catch (e) {
      if (this.opts.debug()) originalConsole.warn('[stacklens] could not encode trace', (e as Error).message);
      return;
    }
    this.queue.push(json);
    if (this.queue.length >= this.batchSize) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, this.queue.length);
    const endpoint = this.opts.endpoint();
    const apiKey = this.opts.apiKey?.();
    // run outside any trace so the request isn't attributed to a user span
    await traceContext.exit(async () => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: apiKey
            ? { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
            : { 'content-type': 'application/json' },
          body: `{"traces":[${batch.join(',')}]}`,
        });
        if (!res.ok)
          throw new Error(
            res.status === 401
              ? `HTTP 401 – ${apiKey ? 'API key rejected' : 'the server requires an API key (set STACKLENS_API_KEY)'}`
              : `HTTP ${res.status}`,
          );
        this.warned = false;
      } catch (e) {
        if (this.opts.debug() && !this.warned) {
          this.warned = true;
          originalConsole.warn(`[stacklens] could not send traces to ${endpoint}: ${(e as Error).message}`);
        }
      }
    });
  }
}
