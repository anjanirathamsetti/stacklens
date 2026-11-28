import type { CodeLanguage } from '@/lib/highlight';

/** The Setup guide's content. Keep in step with the SDK READMEs (sdks/<language>-tracer/README.md). */

export interface Snippet {
  /** file the code goes in */
  file?: string;
  language: CodeLanguage;
  code: string;
}

export interface Stack {
  id: string;
  label: string;
  /** one line under the instrument step */
  summary: string;
  snippets: Snippet[];
  /** what shows up in a trace once it is set up */
  captures: string[];
  tip?: string;
}

export interface LanguageGuide {
  id: 'node' | 'python';
  label: string;
  packageName: string;
  tagline: string;
  install: Snippet[];
  installNote: string;
  stacks: Stack[];
  extras: { title: string; description: string; snippet: Snippet };
  /** option name in this language, per row of OPTIONS */
  optionKey: 'node' | 'python';
}

export const LANGUAGES: LanguageGuide[] = [
  {
    id: 'node',
    label: 'Node.js',
    packageName: '@stacklens/node-tracer',
    tagline: 'NestJS, Express, TypeORM',
    optionKey: 'node',
    installNote: 'Not on npm yet: build it once in the StackLens repository, then install it into your API by path.',
    install: [
      {
        language: 'bash',
        file: 'in the StackLens repository',
        code: 'npm install\nnpm run build:packages',
      },
      { language: 'bash', file: 'in your API', code: 'npm install /path/to/stacklens/sdks/node-tracer' },
    ],
    stacks: [
      {
        id: 'nestjs',
        label: 'NestJS',
        summary: 'One call walks the DI container and instruments every controller, provider and repository.',
        captures: ['A trace per request', 'Controllers, providers and repositories', 'TypeORM queries and raw SQL', 'Outgoing HTTP calls'],
        snippets: [
          {
            file: 'src/main.ts',
            language: 'ts',
            code: `import { NestFactory } from '@nestjs/core';
import * as typeorm from 'typeorm';
import { stacklens } from '@stacklens/node-tracer';
import { AppModule } from './app.module';

stacklens.init({ application: 'billing-api', project: 'payments' });
stacklens.instrumentTypeORM(typeorm); // repositories, query builder, raw SQL

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  stacklens.instrumentNest(app); // before app.listen()
  await app.listen(3000);
}
bootstrap();`,
          },
        ],
      },
      {
        id: 'express',
        label: 'Express',
        summary: 'A require hook wraps everything your source folders export, so services need no changes.',
        captures: ['A trace per request', 'Every exported function and class in your source', 'console output', 'Outgoing HTTP calls'],
        tip: 'autoInstrument() works with CommonJS (require). It must run before your own modules are loaded.',
        snippets: [
          {
            file: 'index.js',
            language: 'js',
            code: `const { stacklens } = require('@stacklens/node-tracer');
stacklens.init({ application: 'orders-api', project: 'storefront' });
stacklens.autoInstrument({ include: [__dirname + '/src/'] }); // before requiring app code

const express = require('express');
const app = express();

app.use(stacklens.express()); // one trace per request
app.use(express.json());
app.use('/api', require('./src/routes'));
app.listen(3000);`,
          },
        ],
      },
    ],
    extras: {
      title: 'Instrument anything else',
      description: 'Pick out objects, classes or single functions, trace background jobs, and add context to a trace.',
      snippet: {
        file: 'anywhere in your app',
        language: 'ts',
        code: `stacklens.instrument(userService); // an instance or an object of functions
stacklens.instrumentClass(PaymentGateway); // every instance
const tax = stacklens.wrap(calculateTax, 'Tax.calculate'); // one function

// jobs, queue consumers and scripts: a root trace outside HTTP
await stacklens.trace('cron:sync-users', () => syncUsers());

stacklens.log('cache miss', { key }); // attach data to the current call
stacklens.setUser(user.id); // tag the trace with the end user`,
      },
    },
  },
  {
    id: 'python',
    label: 'Python',
    packageName: 'stacklens-python-tracer',
    tagline: 'FastAPI, Flask, Django, Celery',
    optionKey: 'python',
    installNote: 'Not on PyPI yet: install it from your checkout of StackLens. Python 3.9+, and the core has no dependencies.',
    install: [{ language: 'bash', file: 'in your app’s virtualenv', code: 'pip install -e /path/to/stacklens/sdks/python-tracer' }],
    stacks: [
      {
        id: 'fastapi',
        label: 'FastAPI',
        summary: 'Middleware for each request, a span per route handler, your modules traced, and every SQL statement.',
        captures: [
          'A trace per request',
          'Route handlers with their resolved parameters',
          'Your modules’ functions and classes',
          'SQLAlchemy queries',
          'Outgoing HTTP calls',
        ],
        tip: 'Instrument your modules before the routes import them, so Depends() receives the traced functions. Works with any Starlette app.',
        snippets: [
          {
            file: 'app/main.py',
            language: 'python',
            code: `import stacklens
from fastapi import FastAPI
from stacklens.integrations.fastapi import instrument_fastapi
from stacklens.integrations.sqlalchemy import instrument_sqlalchemy

stacklens.init(application="catalog-api", project="storefront")
instrument_sqlalchemy()  # a SQL.query span per statement

from app import repositories, services
stacklens.instrument_module(repositories)  # every class and function in it
stacklens.instrument_module(services)

from app.routes import products

app = FastAPI()
app.include_router(products.router)
instrument_fastapi(app)  # one trace per request`,
          },
        ],
      },
      {
        id: 'flask',
        label: 'Flask',
        summary: 'One call after registering your blueprints.',
        captures: ['A trace per request with the route template', 'A span per view', 'The exception behind a 500', 'Outgoing HTTP calls'],
        tip: 'Add instrument_sqlalchemy() for SQL spans, and instrument_module() for your service and repository modules.',
        snippets: [
          {
            file: 'app.py',
            language: 'python',
            code: `import stacklens
from flask import Flask
from stacklens.integrations.flask import instrument_flask

stacklens.init(application="inventory-api", project="storefront")

app = Flask(__name__)
app.register_blueprint(stock)
instrument_flask(app)  # after registering blueprints`,
          },
        ],
      },
      {
        id: 'django',
        label: 'Django',
        summary: 'Add the middleware first, so it sees the whole request. Works under WSGI and ASGI.',
        captures: [
          'A trace per request, named after the URL pattern',
          'Function and class-based views',
          'Every query the ORM runs',
          'Outgoing HTTP calls',
        ],
        snippets: [
          {
            file: 'settings.py',
            language: 'python',
            code: `MIDDLEWARE = [
    "stacklens.integrations.django.StackLensMiddleware",  # first
    *MIDDLEWARE,
]`,
          },
          {
            file: 'wsgi.py (or asgi.py)',
            language: 'python',
            code: `import stacklens

stacklens.init(application="accounts-api")`,
          },
        ],
      },
      {
        id: 'celery',
        label: 'Celery',
        summary: 'Each task becomes a trace, linked to the request that queued it.',
        captures: ['A trace per task run', 'The task’s arguments, result and retries', '“Called by …” links to the enqueueing request'],
        tip: 'Call instrument_celery() in the worker and in every process that queues tasks.',
        snippets: [
          {
            file: 'worker.py',
            language: 'python',
            code: `import stacklens
from celery import Celery
from stacklens.integrations.celery import instrument_celery

stacklens.init(application="notifications-worker")
instrument_celery()

app = Celery("notifications")`,
          },
        ],
      },
    ],
    extras: {
      title: 'Instrument anything else',
      description: 'Decorate functions or classes, trace scripts and jobs, and add context to a trace.',
      snippet: {
        file: 'anywhere in your app',
        language: 'python',
        code: `@stacklens.traced  # a function, a method or a whole class
class InvoiceService:
    ...

tax = stacklens.wrap(calculate_tax, "Tax.calculate")  # one function

# jobs and scripts: a root trace outside HTTP
with stacklens.trace("nightly-report"):
    build_report()

stacklens.log("cache miss", {"key": key})  # attach data to the current call
stacklens.set_user(user.id)  # tag the trace with the end user`,
      },
    },
  },
];

export interface OptionRow {
  node: string;
  python: string;
  env?: string;
  fallback: string;
  description: string;
}

export const OPTIONS: OptionRow[] = [
  {
    node: 'application',
    python: 'application',
    env: 'STACKLENS_APP',
    fallback: 'package or project name',
    description: 'The name your app appears under.',
  },
  { node: 'project', python: 'project', env: 'STACKLENS_PROJECT', fallback: 'default', description: 'Groups related apps.' },
  {
    node: 'endpoint',
    python: 'endpoint',
    env: 'STACKLENS_ENDPOINT',
    fallback: 'http://localhost:4300/api/ingest',
    description: 'Where traces are sent.',
  },
  { node: 'apiKey', python: 'api_key', env: 'STACKLENS_API_KEY', fallback: 'none', description: 'Needed when the server requires a key.' },
  { node: 'enabled', python: 'enabled', env: 'STACKLENS_ENABLED', fallback: 'true', description: 'Set false to turn tracing off.' },
  { node: 'sampleRate', python: 'sample_rate', fallback: '1', description: 'Share of requests to trace, 0 to 1.' },
  {
    node: 'redactKeys',
    python: 'redact_keys',
    fallback: 'passwords, tokens, cookies, keys',
    description: 'Fields hidden before data leaves your app.',
  },
  { node: 'ignorePaths', python: 'ignore_paths', fallback: '/health, /favicon.ico', description: 'Requests that aren’t traced.' },
  {
    node: 'maxRepeatedCalls',
    python: 'max_repeated_calls',
    fallback: '10',
    description: 'Loop calls recorded one by one before they fold into one row.',
  },
  { node: 'maxSpansPerTrace', python: 'max_spans_per_trace', fallback: '2000', description: 'Hard cap on calls recorded per trace.' },
  { node: 'propagateTo', python: 'propagate_to', fallback: 'every host', description: 'Hosts that receive the traceparent header.' },
];
