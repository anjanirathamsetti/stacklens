import { describe, expect, it } from 'vitest';
import { errorText, languageLabel, languageOf, languageOfTypes, resultTypeOf, returnTypeOf, stackFrames } from '../src/language';

const pyStack = [
  'Traceback (most recent call last):',
  '  File "/app/catalog/services.py", line 88, in bundle_discount',
  '    per_unit_split = (qty - 1) / rule.percent_off',
  'ZeroDivisionError: division by zero',
].join('\n');

describe('language', () => {
  it('reads the SDK language and falls back to the stack shape', () => {
    expect(languageOf({ sdk: { name: 'stacklens-python-tracer', language: 'python' }, spans: [] })).toBe('python');
    expect(languageOf({ sdk: { name: '@stacklens/node-tracer', language: 'node' }, spans: [] })).toBe('node');
    expect(languageOf({ spans: [{ error: { name: 'E', message: 'm', stack: pyStack } }] as never })).toBe('python');
    expect(languageOf({ spans: [] })).toBe('node');
    expect(languageOf(undefined)).toBe('node');
    expect(languageLabel({ sdk: { name: 'x', language: 'python' }, spans: [] })).toBe('Python');
  });

  it('names return types the way each language does', () => {
    expect(returnTypeOf({ status: 'ok', async: true, resultType: 'Quote' }, 'python')).toBe('Quote');
    expect(returnTypeOf({ status: 'ok', async: true, resultType: 'Quote' }, 'node')).toBe('Promise<Quote>');
    expect(returnTypeOf({ status: 'error', async: false }, 'python')).toBe('NoReturn');
    expect(returnTypeOf({ status: 'ok', async: false }, 'python')).toBe('None');
    expect(returnTypeOf({ status: 'ok', async: false }, 'node')).toBe('void');
    expect(resultTypeOf({ async: true, resultType: 'int' }, 'python')).toBe('int');
  });

  it('shows the frames of Python tracebacks and Node stacks', () => {
    const err = { name: 'ZeroDivisionError', message: 'division by zero', stack: pyStack };
    expect(stackFrames(err)).toBe(pyStack.split('\n').slice(0, 3).join('\n'));
    expect(errorText(err)).toBe(pyStack);
    const multi = {
      name: 'HTTPStatusError',
      message: "Client error '422'\nFor more information check: x",
      stack: `${pyStack.split('\n').slice(0, 3).join('\n')}\nhttpx.HTTPStatusError: Client error '422'\nFor more information check: x`,
    };
    expect(stackFrames(multi)).toBe(pyStack.split('\n').slice(0, 3).join('\n'));
    const node = { name: 'TypeError', message: 'x is undefined', stack: 'TypeError: x is undefined\n    at f (/app/a.js:1:2)' };
    expect(stackFrames(node)).toBe('at f (/app/a.js:1:2)');
    expect(errorText(node)).toBe('TypeError: x is undefined\nTypeError: x is undefined\n    at f (/app/a.js:1:2)');
  });
});

describe('languageOfTypes', () => {
  it('recognises Python type names', () => {
    expect(languageOfTypes(['list[int]'])).toBe('python');
    expect(languageOfTypes(['{ id: int; email: str }'])).toBe('python');
    expect(languageOfTypes([undefined, 'None'])).toBe('python');
    expect(languageOfTypes(['{ id: number; email: string }', 'string[]'])).toBe('node');
    expect(languageOfTypes(['Repository<User>', undefined])).toBe('node');
    expect(languageOfTypes(['{ structure: string }'])).toBe('node');
  });
});
