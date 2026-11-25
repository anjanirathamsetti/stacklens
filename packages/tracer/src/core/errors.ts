import type { SpanError } from '../types';

/** Stack frames that belong to the tracer itself – hidden so stacks point at user code. */
const OWN_FRAMES = /[\\/](@stacklens[\\/]tracer|packages[\\/]tracer)[\\/]dist[\\/]|node:internal\/async_local_storage/;

function cleanStack(stack?: string): string | undefined {
  return stack
    ?.split('\n')
    .filter((line) => !OWN_FRAMES.test(line))
    .join('\n');
}

/** Normalize anything that was thrown into a `SpanError`, keeping an HTTP status when the error carries one. */
export function toSpanError(e: unknown): SpanError {
  if (!(e instanceof Error)) return { name: typeof e, message: String(e) };
  const err = e as Error & { getStatus?: () => unknown; status?: unknown; statusCode?: unknown };
  let status: unknown;
  try {
    status = typeof err.getStatus === 'function' ? err.getStatus() : (err.status ?? err.statusCode);
  } catch {
    status = undefined;
  }
  return {
    name: err.name || err.constructor?.name || 'Error',
    message: err.message,
    stack: cleanStack(err.stack),
    status: typeof status === 'number' && status >= 100 && status < 600 ? status : undefined,
  };
}
