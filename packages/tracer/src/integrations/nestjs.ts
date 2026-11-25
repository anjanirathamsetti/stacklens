import { tracer } from '../core/tracer';
import { instrument, kindFromName } from '../instrumentation/wrap';
import type { InstrumentOptions } from '../types';
import { expressMiddleware, type ExpressMiddlewareOptions } from './express';

export interface NestInstrumentOptions extends ExpressMiddlewareOptions {
  /** Only instrument providers/controllers whose class name matches. */
  include?: (string | RegExp)[];
  /** Skip providers/controllers whose class name matches. */
  exclude?: (string | RegExp)[];
  /** Pass `app.get(ModulesContainer)` if your Nest version hides the internal container. */
  modulesContainer?: Map<string, any>;
  /** Register the entry-point middleware automatically. Default true */
  registerMiddleware?: boolean;
  /** Also trace TypeORM repositories found in the DI container. Default true */
  repositories?: boolean;
  /** Per-class overrides */
  classOptions?: Record<string, InstrumentOptions>;
}

/** Framework / infrastructure classes that would only add noise. */
const NEST_INTERNALS = new Set([
  'ModuleRef',
  'Reflector',
  'HttpAdapterHost',
  'ApplicationConfig',
  'ExternalContextCreator',
  'ModulesContainer',
  'LazyModuleLoader',
  'SerializedGraph',
  'Logger',
  'ConfigService',
  'ConfigHostModule',
  'DataSource',
  'Connection',
  'EntityManager',
  'DiscoveryService',
  'MetadataScanner',
  'JwtService',
  'EventEmitter2',
  'SchedulerRegistry',
  'SchedulerOrchestrator',
  'SchedulerMetadataAccessor',
  'ScheduleExplorer',
  'EventSubscribersLoader',
  'EventsMetadataAccessor',
  'TypeOrmCoreModule',
]);

const INTERNAL_MODULES =
  /^(InternalCoreModule|InternalCoreModuleFactory|ConfigHostModule|TypeOrmCoreModule|DiscoveryModule|ScheduleModule|EventEmitterModule)$/;

function matches(list: (string | RegExp)[] | undefined, name: string) {
  return !!list?.some((p) => (typeof p === 'string' ? p === name : p.test(name)));
}

function getModules(app: any, opts: NestInstrumentOptions): Iterable<any> {
  if (opts.modulesContainer) return opts.modulesContainer.values();
  const container = app?.container ?? app?.['container'];
  if (container && typeof container.getModules === 'function') return container.getModules().values();
  throw new Error('[stacklens] Could not access the Nest DI container. Pass { modulesContainer: app.get(ModulesContainer) }.');
}

function isTypeOrmRepository(instance: any) {
  return instance && typeof instance === 'object' && instance.metadata && instance.manager && typeof instance.find === 'function';
}

/**
 * Instrument a NestJS application in one line. Call it in `main.ts` **before** `app.listen()`:
 *
 * ```ts
 * const app = await NestFactory.create(AppModule);
 * stacklens.instrumentNest(app);
 * await app.listen(3000);
 * ```
 *
 * Walks the DI container and patches every controller, provider and TypeORM repository
 * so the full call tree (controller → service → handler → repository → …) is captured.
 */
export function instrumentNest(app: any, opts: NestInstrumentOptions = {}) {
  const instrumented: string[] = [];
  const seenCtors = new Set<Function>();

  for (const mod of getModules(app, opts)) {
    const modName: string = mod?.metatype?.name ?? mod?.name ?? '';
    if (INTERNAL_MODULES.test(modName)) continue;

    const visit = (wrappers: Map<unknown, any> | undefined, role: 'controller' | 'provider') => {
      if (!wrappers) return;
      for (const wrapper of wrappers.values()) {
        const instance = wrapper?.instance;
        if (!instance || typeof instance !== 'object') continue;
        const ctor = instance.constructor;
        const isRepo = isTypeOrmRepository(instance);
        if (isRepo && opts.repositories === false) continue;
        const name: string = isRepo ? `${instance.metadata.name}Repository` : (ctor?.name ?? String(wrapper.name));
        if (!name || (!isRepo && (ctor === Object || NEST_INTERNALS.has(name)))) continue;
        if (wrapper.metatype === mod.metatype) continue; // the module class itself
        if (opts.include && !matches(opts.include, name)) continue;
        if (matches(opts.exclude, name)) continue;
        if (!isRepo && seenCtors.has(ctor)) continue;
        seenCtors.add(ctor);

        const kind = role === 'controller' ? 'controller' : isRepo ? 'repository' : kindFromName(name, 'service');
        instrument(instance, { kind, ...(opts.classOptions?.[name] ?? {}) });
        instrumented.push(name);
      }
    };
    visit(mod.controllers, 'controller');
    visit(mod.providers, 'provider');
  }

  if (opts.registerMiddleware !== false && typeof app.use === 'function') {
    app.use(expressMiddleware(opts));
  }

  if (tracer.opts.debug) {
    console.log(`[stacklens] instrumented ${instrumented.length} Nest classes: ${[...new Set(instrumented)].join(', ')}`);
  }
  return instrumented;
}
