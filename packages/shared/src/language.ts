/**
 * Language of the app that recorded a trace, and the idioms that depend on it: how a signature reads
 * (`async def f(x: int) -> str` vs `async f(x: number): Promise<string>`), how an empty or failed return
 * is named, and how a stack trace is laid out. SDKs say which language they are in `trace.sdk`; traces
 * from older SDKs (which don't) are recognised by their stack traces and otherwise treated as Node.js.
 */
import type { SpanRecord, TraceRecord } from './api-types';

export type Language = 'node' | 'python';

const PY_TRACEBACK = /^Traceback \(most recent call last\):/;

export function languageOf(trace?: Pick<TraceRecord, 'sdk' | 'spans'> | null): Language {
  const lang = trace?.sdk?.language?.toLowerCase();
  if (lang === 'python') return 'python';
  if (lang) return 'node';
  if (trace?.spans?.some((s) => s.error?.stack && PY_TRACEBACK.test(s.error.stack))) return 'python';
  return 'node';
}

const PY_TYPE =
  /(^|[\s:<([{|,])(str|int|float|bool|None|bytes|Decimal|datetime|NoReturn)(?=$|[\s;,)\]}|])|(^|[\s:(|,])(list|dict|tuple|set|type)\[/;

/**
 * Language guessed from inferred type strings, for aggregated views without a trace (hotspots): the Python
 * SDK uses Python names (`str`, `list[int]`, `None`), the Node SDK TypeScript ones (`string`, `number[]`).
 */
export function languageOfTypes(types: (string | undefined | null)[]): Language {
  return types.some((t) => !!t && PY_TYPE.test(t)) ? 'python' : 'node';
}

/** Display name of a language, with the runtime when the SDK sent it (`Python · CPython 3.12.4`). */
export function languageLabel(trace?: Pick<TraceRecord, 'sdk' | 'spans'> | null): string {
  const lang = languageOf(trace);
  return lang === 'python' ? 'Python' : 'Node.js';
}

/** Return type as the language writes it. Python's `async def` already implies the awaitable. */
export function returnTypeOf(span: Pick<SpanRecord, 'status' | 'resultType' | 'async'>, lang: Language): string {
  if (lang === 'python') {
    if (span.status === 'error') return 'NoReturn';
    return span.resultType ?? 'None';
  }
  const ret = span.status === 'error' ? 'never' : (span.resultType ?? 'void');
  return span.async ? `Promise<${ret}>` : ret;
}

/** Type shown above a return value (no `never`/`NoReturn`: only used for calls that returned). */
export function resultTypeOf(span: Pick<SpanRecord, 'resultType' | 'async'>, lang: Language): string | undefined {
  if (!span.resultType) return undefined;
  return lang === 'python' || !span.async ? span.resultType : `Promise<${span.resultType}>`;
}

export const isPythonTraceback = (stack?: string): boolean => !!stack && PY_TRACEBACK.test(stack);

/**
 * The part of a stack trace worth showing under the error's name and message: the frames.
 * Node stacks start with `Name: message`; Python tracebacks end with it (after the frames, most recent
 * call last), and chained exceptions keep their own messages in between.
 */
export function stackFrames(error: { name: string; message: string; stack?: string }): string {
  const stack = error.stack ?? '';
  if (!isPythonTraceback(stack)) return stack.split('\n').slice(1).join('\n').trim();
  const text = stack.replace(/\s+$/, '');
  // the final `module.Name: message` block (messages can span lines), or a bare `Name` without a message
  const tail = error.message ? `${error.name}: ${error.message.replace(/\s+$/, '')}` : error.name;
  const at = text.lastIndexOf(tail);
  if (at >= 0 && text.slice(at + tail.length).trim() === '') return text.slice(0, text.lastIndexOf('\n', at) + 1).trim();
  return text;
}

/** Text to copy for an error: the language's own format. */
export function errorText(error: { name: string; message: string; stack?: string }): string {
  if (isPythonTraceback(error.stack)) return error.stack!;
  return `${error.name}: ${error.message}\n${error.stack ?? ''}`;
}
