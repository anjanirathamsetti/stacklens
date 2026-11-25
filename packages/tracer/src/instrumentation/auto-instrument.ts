import Module from 'node:module';
import path from 'node:path';
import { tracer } from '../core/tracer';
import { instrument, instrumentClass, isClass, isWrapped, kindFromName, wrapFunction } from './wrap';

export interface AutoInstrumentOptions {
  /**
   * Files to instrument (absolute path is tested). Strings are treated as path fragments.
   * Default: everything under `<cwd>/src` except node_modules.
   */
  include?: (string | RegExp)[];
  exclude?: (string | RegExp)[];
}

let installed = false;

function test(list: (string | RegExp)[], file: string) {
  return list.some((p) => (typeof p === 'string' ? file.includes(p) : p.test(file)));
}

function labelFromFile(file: string) {
  // users.service.js → UsersService ; user-repository.js → UserRepository
  const base = path.basename(file).replace(/\.(c|m)?(j|t)sx?$/, '');
  return base
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Zero-touch instrumentation for CommonJS apps (plain Express / JS projects).
 * Call this at the very top of your entry file, **before** requiring your app code:
 *
 * ```js
 * require('@stacklens/tracer').stacklens.autoInstrument({ include: ['/src/'] });
 * const app = require('./src/app');
 * ```
 *
 * Every function, class and object exported by a matching module is wrapped.
 * Note: calls between functions *inside* the same file that don't go through
 * `module.exports` / `this` can't be intercepted – export them or use `stacklens.wrap`.
 */
export function autoInstrument(opts: AutoInstrumentOptions = {}) {
  if (installed) return;
  installed = true;
  const include = opts.include ?? [path.join(process.cwd(), 'src') + path.sep];
  const exclude = [/node_modules/, /@stacklens/, ...(opts.exclude ?? [])];

  const M = Module as any;
  const origLoad = M._load;
  const done = new WeakSet<object>();

  M._load = function (this: unknown, ...args: [request: string, parent: any, isMain: boolean]) {
    const [request, parent, isMain] = args;
    const exp = origLoad.apply(this, args);
    let filename: string | undefined;
    try {
      filename = M._resolveFilename(request, parent, isMain);
    } catch {
      return exp;
    }
    if (!filename || !path.isAbsolute(filename) || !test(include, filename) || test(exclude, filename)) return exp;
    if (exp == null || (typeof exp !== 'object' && typeof exp !== 'function') || done.has(exp)) return exp;
    done.add(exp);

    const label = labelFromFile(filename);
    try {
      if (typeof exp === 'function') {
        if (isClass(exp)) return instrumentClass(exp);
        // express.Router() instances / apps – leave alone
        if (Array.isArray((exp as any).stack) && typeof (exp as any).use === 'function') return exp;
        // module.exports = function … – replace in the require cache
        const wrapped = wrapFunction(exp, { className: label, method: exp.name || 'default', kind: kindFromName(label) });
        // copy static props (e.g. router.get) so things keep working
        for (const k of Object.keys(exp)) (wrapped as any)[k] = (exp as any)[k];
        const cached = M._cache[filename];
        if (cached) cached.exports = wrapped;
        return wrapped;
      }
      // Express routers are functions; objects that look like express apps should not be wrapped
      if (typeof (exp as any).listen === 'function' && typeof (exp as any).use === 'function') return exp;
      for (const key of Object.keys(exp)) {
        const v = (exp as any)[key];
        if (typeof v === 'function' && isClass(v)) instrumentClass(v);
        else if (v && typeof v === 'object' && !Array.isArray(v) && !isWrapped(v)) {
          // exported singleton instance: `module.exports = { userService: new UserService() }`
          const proto = Object.getPrototypeOf(v);
          if (proto && proto !== Object.prototype) instrument(v);
        }
      }
      instrument(exp, { name: label, kind: kindFromName(label) });
    } catch (e) {
      if (tracer.opts.debug) console.warn(`[stacklens] failed to instrument ${filename}`, e);
    }
    return exp;
  };
}
