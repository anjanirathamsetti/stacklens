import type { LogLevel } from '../types';

/** Pristine console methods, captured before the tracer patches `console`. */
export const originalConsole: Record<LogLevel, (...args: unknown[]) => void> = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

let patched = false;

/**
 * Route `console.*` through `onLog` (which attaches the line to the current span) and
 * then to the original method. Idempotent.
 */
export function patchConsole(onLog: (level: LogLevel, args: unknown[]) => void): void {
  if (patched) return;
  patched = true;
  for (const level of Object.keys(originalConsole) as LogLevel[]) {
    console[level] = (...args: unknown[]) => {
      onLog(level, args);
      originalConsole[level](...args);
    };
  }
}
