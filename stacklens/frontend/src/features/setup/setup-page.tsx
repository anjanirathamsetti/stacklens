import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { CopyButton } from '@/components/data-display/json-view';

type Snippet = { title: string; description: string; file: string; code: string };

const NODE_SNIPPETS: Snippet[] = [
  {
    title: 'NestJS + TypeORM',
    description: 'One call walks the DI container and instruments every controller, provider and repository.',
    file: 'src/main.ts',
    code: `import { stacklens } from '@stacklens/node-tracer';
import * as typeorm from 'typeorm';

stacklens.init({ application: 'billing-api', project: 'payments' });
stacklens.instrumentTypeORM(typeorm); // repositories, query builder, raw SQL

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  stacklens.instrumentNest(app);        // ← before app.listen()
  await app.listen(3000);
}`,
  },
  {
    title: 'Express (JavaScript / CommonJS)',
    description: 'A require-hook wraps everything exported from your source folders – no code changes in services.',
    file: 'index.js',
    code: `const { stacklens } = require('@stacklens/node-tracer');
stacklens.init({ application: 'orders-api', project: 'storefront' });
stacklens.autoInstrument({ include: [__dirname + '/src/'] }); // before requiring app code

const express = require('express');
const app = express();
app.use(stacklens.express());   // entry point: one trace per request
app.use(express.json());
app.use('/api', require('./src/routes'));`,
  },
  {
    title: 'Manual / fine-grained',
    description: 'Instrument specific objects, classes or functions; trace background jobs.',
    file: 'anywhere',
    code: `stacklens.instrument(userService);          // instance or object of functions
stacklens.instrumentClass(PaymentGateway);   // every instance
const fn = stacklens.wrap(calculateTax, 'Tax.calculate');

@Traced()                                    // decorator (class or method)
export class InvoiceService { … }

await stacklens.trace('cron:sync-users', () => syncUsers()); // non-HTTP root
stacklens.log('cache miss', { key });        // attach data to the current call
stacklens.setUser(user.id);                  // tag the trace with the end user
// default user detection: req.user.id | req.user.sub | req.auth.userId | x-user-id header
stacklens.init({ getUserId: (req) => req.session?.accountId });`,
  },
];

const PYTHON_SNIPPETS: Snippet[] = [
  {
    title: 'FastAPI / Starlette + SQLAlchemy',
    description: 'Middleware for every request, a span per route handler, your modules traced, and every SQL statement.',
    file: 'app/main.py',
    code: `import stacklens
from stacklens.integrations.fastapi import instrument_fastapi
from stacklens.integrations.sqlalchemy import instrument_sqlalchemy

stacklens.init(application="catalog-api", project="storefront")
instrument_sqlalchemy()                     # SQL.query spans for every engine

from app import services, repositories     # your code
stacklens.instrument_module(services)       # every class and function in it
stacklens.instrument_module(repositories)

app = FastAPI()
app.include_router(...)
instrument_fastapi(app)                     # one trace per request`,
  },
  {
    title: 'Flask · Django',
    description: 'Flask: one call after registering blueprints. Django: put the middleware first; ORM SQL is recorded too.',
    file: 'app.py · settings.py',
    code: `# Flask
from stacklens.integrations.flask import instrument_flask
stacklens.init(application="inventory-api")
instrument_flask(app)

# Django (settings.py) – call stacklens.init() in wsgi.py / asgi.py
MIDDLEWARE = ["stacklens.integrations.django.StackLensMiddleware", *MIDDLEWARE]`,
  },
  {
    title: 'Celery, jobs and manual instrumentation',
    description: 'Tasks become traces linked to the request that queued them; decorate anything else.',
    file: 'anywhere',
    code: `from stacklens.integrations.celery import instrument_celery
instrument_celery()                          # worker and producers

@stacklens.traced                            # a function, method or whole class
class InvoiceService: ...

with stacklens.trace("nightly-report"):      # non-HTTP root (or @stacklens.trace(...))
    build_report()

stacklens.log("cache miss", {"key": key})    # attach data to the current call
stacklens.set_user(user.id)                  # tag the trace with the end user
# requests, httpx and urllib3 calls are traced and carry a W3C traceparent automatically`,
  },
];

function SnippetCard({ s }: { s: Snippet }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 pb-3 pt-3.5">
        <div className="text-sm font-semibold">{s.title}</div>
        <div className="text-xs text-muted-foreground">{s.description}</div>
      </div>
      <div className="flex items-center justify-between border-y bg-muted/40 px-4 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">{s.file}</span>
        <CopyButton text={s.code} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">{s.code}</pre>
    </Card>
  );
}

export default function SetupPage() {
  return (
    <>
      <PageHeader title="Setup guide" description="Add StackLens at your API entry point – no console.log needed" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Node.js · <span className="font-mono normal-case">@stacklens/node-tracer</span>
          </h2>
          {NODE_SNIPPETS.map((s) => (
            <SnippetCard key={s.title} s={s} />
          ))}
          <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Python 3.9+ · <span className="font-mono normal-case">stacklens-python-tracer</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Not on PyPI yet: install it from a checkout of the repository with{' '}
            <code className="font-mono">pip install -e sdks/python-tracer</code>. The core has no dependencies; integrations load only when
            you use them.
          </p>
          {PYTHON_SNIPPETS.map((s) => (
            <SnippetCard key={s.title} s={s} />
          ))}
          <Card className="p-4 text-xs leading-relaxed text-muted-foreground">
            <div className="mb-1 text-sm font-semibold text-foreground">Configuration</div>
            Set <code className="font-mono">STACKLENS_ENDPOINT</code> (default{' '}
            <code className="font-mono">http://localhost:4300/api/ingest</code>), <code className="font-mono">STACKLENS_ENABLED=false</code>{' '}
            to turn tracing off, and use <code className="font-mono">sampleRate</code>, <code className="font-mono">redactKeys</code>,{' '}
            <code className="font-mono">ignorePaths</code> and <code className="font-mono">maxSpansPerTrace</code> in{' '}
            <code className="font-mono">stacklens.init()</code> (Python: the same names in snake_case, e.g.{' '}
            <code className="font-mono">sample_rate</code>). Passwords, tokens, cookies and API keys are redacted by default.
          </Card>
        </div>
      </div>
    </>
  );
}
