'use client';
import { Suspense, useEffect, useState } from 'react';
import { Activity, Cable, Check, Construction, KeyRound, MessageSquareText, Plus, Shield, Terminal, Wrench } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { SaveBar } from '@/components/layout/save-bar';
import { useFacets } from '@/components/layout/filter-bar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { toast, copyWithToast } from '@/components/ui/toast';
import { CopyButton } from '@/components/data-display/json-view';
import { useConfigDraft } from '@/lib/use-config';
import { MCP_TOOLS } from '@stacklens/shared/config-defaults';
import { cn } from '@/lib/utils';

const MCP_PATH = '/api/mcp';

function useOrigin() {
  const [origin, setOrigin] = useState('http://localhost:4300');
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

function Section({
  icon: Icon,
  title,
  description,
  children,
  right,
  flush,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <Icon className="mt-0.5 size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
        </div>
        {right}
      </div>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </Card>
  );
}

function Snippet({ file, code }: { file?: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-md border bg-muted/30">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1">
        <span className="font-mono text-[11px] text-muted-foreground">{file ?? 'terminal'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[11.5px] leading-relaxed">{code}</pre>
    </div>
  );
}

function ClientSetup({ url }: { url: string }) {
  const header = 'Authorization: Bearer <token>';
  const json = (o: unknown) => JSON.stringify(o, null, 2);
  return (
    <Tabs defaultValue="claude-code">
      <TabsList className="mb-3 flex-wrap">
        <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
        <TabsTrigger value="cursor">Cursor</TabsTrigger>
        <TabsTrigger value="vscode">VS Code</TabsTrigger>
        <TabsTrigger value="desktop">Claude Desktop</TabsTrigger>
        <TabsTrigger value="other">Other</TabsTrigger>
      </TabsList>
      <TabsContent value="claude-code" className="space-y-2">
        <Snippet code={`claude mcp add --transport http stacklens ${url} \\\n  --header "${header}"`} />
        <p className="text-xs text-muted-foreground">
          Add <code className="font-mono">--scope project</code> to share it with your team through{' '}
          <code className="font-mono">.mcp.json</code>.
        </p>
      </TabsContent>
      <TabsContent value="cursor">
        <Snippet
          file=".cursor/mcp.json"
          code={json({ mcpServers: { stacklens: { url, headers: { Authorization: 'Bearer <token>' } } } })}
        />
      </TabsContent>
      <TabsContent value="vscode">
        <Snippet
          file=".vscode/mcp.json"
          code={json({ servers: { stacklens: { type: 'http', url, headers: { Authorization: 'Bearer <token>' } } } })}
        />
      </TabsContent>
      <TabsContent value="desktop" className="space-y-2">
        <Snippet
          file="claude_desktop_config.json"
          code={json({ mcpServers: { stacklens: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', header] } } })}
        />
        <p className="text-xs text-muted-foreground">
          Or add it as a custom connector in Claude Desktop settings when your server is reachable over HTTPS.
        </p>
      </TabsContent>
      <TabsContent value="other" className="space-y-2 text-sm">
        <p className="text-muted-foreground">Any MCP client that supports the Streamable HTTP transport can connect.</p>
        <div className="grid gap-1.5 rounded-md border p-3 font-mono text-xs">
          <div>
            <span className="text-muted-foreground">URL </span>
            {url}
          </div>
          <div>
            <span className="text-muted-foreground">Transport </span>Streamable HTTP
          </div>
          <div>
            <span className="text-muted-foreground">Auth </span>
            {header}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

const EXAMPLES = [
  'Why did POST /orders fail for user 42 in the last hour?',
  'Which function got slower since yesterday’s deploy?',
  'Show the inputs that make UsersService.getById throw.',
  'Are any SLOs burning their error budget right now?',
];

function McpInner() {
  const origin = useOrigin();
  const url = `${origin}${MCP_PATH}`;
  const facets = useFacets();
  const { draft: cfg, update, dirty, save, saving, discard } = useConfigDraft('mcp');
  const enabledTools = MCP_TOOLS.filter((t) => cfg.tools[t.id]).length;

  return (
    <>
      <PageHeader title="MCP server" description="Let AI assistants in your editor read traces, errors and metrics">
        <Badge tone="warning">
          <Construction /> Coming soon
        </Badge>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-6">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-5 bg-gradient-to-br from-viz/[0.07] via-transparent to-violet-500/[0.05] p-6">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Cable className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold tracking-tight">Ask about production from your editor</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  StackLens will expose traces, error groups, hotspots and SLOs over the Model Context Protocol. Claude Code, Cursor and
                  other assistants can then look up the failing request and read your source code in the same conversation.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 border-t bg-amber-500/[0.06] px-5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
              <Construction className="mt-px size-3.5 shrink-0" />
              <span>
                <b>Preview.</b> The MCP endpoint isn’t running yet. Tool and access settings below are saved and will apply when it ships.
              </span>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-4">
              <Section
                icon={Terminal}
                title="Connect a client"
                description="Copy the config for your assistant. Replace <token> with an access token."
              >
                <ClientSetup url={url} />
              </Section>

              <Section
                icon={Wrench}
                title="Tools"
                description="What connected assistants are allowed to call. Every tool is read-only."
                right={
                  <span className="text-xs text-muted-foreground">
                    {enabledTools} of {MCP_TOOLS.length} on
                  </span>
                }
                flush
              >
                <div className="divide-y">
                  {MCP_TOOLS.map((t) => (
                    <div key={t.id} className={cn('flex items-center gap-4 px-4 py-3', !cfg.tools[t.id] && 'opacity-60')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-mono text-[13px] font-medium">{t.id}</code>
                          <Badge tone="outline">read-only</Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground/80">({t.params})</div>
                      </div>
                      <Switch
                        checked={cfg.tools[t.id]}
                        onCheckedChange={(v) => update((c) => ({ tools: { ...c.tools, [t.id]: v } }))}
                        aria-label={`Allow ${t.id}`}
                      />
                    </div>
                  ))}
                </div>
              </Section>

              <Section
                icon={MessageSquareText}
                title="Things to ask"
                description="Once connected, try prompts like these in your assistant."
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {EXAMPLES.map((e) => (
                    <button
                      key={e}
                      onClick={() => copyWithToast(e, 'Prompt copied')}
                      className="rounded-md border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground cursor-pointer"
                    >
                      “{e}”
                    </button>
                  ))}
                </div>
              </Section>
            </div>

            <div className="space-y-4">
              <Section icon={Cable} title="Server">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-muted-foreground/40" /> Not running
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Transport</span>
                    <span>Streamable HTTP</span>
                  </div>
                  <div>
                    <div className="mb-1 text-muted-foreground">Endpoint</div>
                    <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1 pl-2.5 pr-1 font-mono text-xs">
                      <span className="min-w-0 flex-1 truncate">{url}</span>
                      <CopyButton text={url} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <span>
                      <span className="block font-medium">Enable when available</span>
                      <span className="block text-xs text-muted-foreground">Start serving MCP as soon as it ships</span>
                    </span>
                    <Switch checked={cfg.enabled} onCheckedChange={(enabled) => update({ enabled })} aria-label="Enable MCP" />
                  </div>
                </div>
              </Section>

              <Section
                icon={KeyRound}
                title="Access tokens"
                right={
                  <Tooltip content="Available when the MCP server ships">
                    <span>
                      <Button size="sm" variant="outline" disabled>
                        <Plus /> New token
                      </Button>
                    </span>
                  </Tooltip>
                }
              >
                <div className="flex flex-col items-center py-4 text-center">
                  <KeyRound className="mb-2 size-5 text-muted-foreground" />
                  <div className="text-sm font-medium">No tokens</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Each person or CI job gets its own token, which you can revoke at any time.
                  </div>
                </div>
              </Section>

              <Section icon={Shield} title="Data access">
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-medium">Projects</div>
                    <div className="mb-2 text-xs text-muted-foreground">
                      {cfg.projects.length ? 'Only these projects are visible' : 'All projects are visible'}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(facets?.projects ?? []).map((p) => {
                        const on = cfg.projects.includes(p);
                        return (
                          <button
                            key={p}
                            onClick={() => update((c) => ({ projects: on ? c.projects.filter((x) => x !== p) : [...c.projects, p] }))}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors cursor-pointer',
                              on ? 'border-brand/50 bg-brand/10 text-brand' : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {on && <Check className="size-3" />}
                            {p}
                          </button>
                        );
                      })}
                      {!facets?.projects.length && <span className="text-xs text-muted-foreground">No projects seen yet</span>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>
                      <span className="block text-sm font-medium">Hide argument & return values</span>
                      <span className="block text-xs text-muted-foreground">Tools return names, types, timings and errors only</span>
                    </span>
                    <Switch
                      checked={cfg.redactPayloads}
                      onCheckedChange={(redactPayloads) => update({ redactPayloads })}
                      aria-label="Hide values"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">Max results per call</span>
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={cfg.maxResults}
                      onChange={(e) => update({ maxResults: Number(e.target.value) })}
                      className="w-20 text-right font-mono text-xs"
                    />
                  </div>
                </div>
              </Section>

              <Section icon={Activity} title="Recent activity">
                <div className="py-3 text-center text-xs text-muted-foreground">
                  No client has connected yet. Tool calls will be listed here.
                </div>
              </Section>
            </div>
          </div>
          <SaveBar
            dirty={dirty}
            saving={saving}
            onDiscard={discard}
            onSave={() =>
              save()
                .then(() => toast('MCP settings saved'))
                .catch((e: Error) => toast(e.message, 'error'))
            }
          />
        </div>
      </div>
    </>
  );
}

export default function McpPage() {
  return (
    <Suspense>
      <McpInner />
    </Suspense>
  );
}
