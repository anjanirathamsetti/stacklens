import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { CopyButton } from '@/components/data-display/json-view';

const SNIPPETS: { title: string; description: string; file: string; code: string }[] = [
  {
    title: 'NestJS + TypeORM',
    description: 'One call walks the DI container and instruments every controller, provider and repository.',
    file: 'src/main.ts',
    code: `import { stacklens } from '@stacklens/tracer';
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
    code: `const { stacklens } = require('@stacklens/tracer');
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

export default function SetupPage() {
  return (
    <>
      <PageHeader title="Setup guide" description="Add StackLens at your API entry point – no console.log needed" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {SNIPPETS.map((s) => (
            <Card key={s.title} className="overflow-hidden">
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
          ))}
          <Card className="p-4 text-xs leading-relaxed text-muted-foreground">
            <div className="mb-1 text-sm font-semibold text-foreground">Configuration</div>
            Set <code className="font-mono">STACKLENS_ENDPOINT</code> (default{' '}
            <code className="font-mono">http://localhost:4300/api/ingest</code>), <code className="font-mono">STACKLENS_ENABLED=false</code>{' '}
            to turn tracing off, and use <code className="font-mono">sampleRate</code>, <code className="font-mono">redactKeys</code>,{' '}
            <code className="font-mono">ignorePaths</code> and <code className="font-mono">maxSpansPerTrace</code> in{' '}
            <code className="font-mono">stacklens.init()</code>. Passwords, tokens, cookies and API keys are redacted by default.
          </Card>
        </div>
      </div>
    </>
  );
}
