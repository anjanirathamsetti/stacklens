'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Newspaper } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/layout/settings-ui';
import { Button } from '@/components/ui/button';
import { DataTab, IntegrationsTab, type ServerInfo } from './components/data-and-integrations';

function useServerInfo() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const load = useCallback(() => {
    fetch('/api/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  }, []);
  useEffect(() => load(), [load]);
  return { info, load };
}

export function DataPage() {
  const { info, load } = useServerInfo();
  return (
    <>
      <PageHeader title="Data & storage" description="Database, retention and stored traces" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          <DataTab info={info} reload={load} />
        </div>
      </div>
    </>
  );
}

export function IntegrationsPage() {
  const { info } = useServerInfo();
  return (
    <>
      <PageHeader title="Integrations" description="ServiceNow, the trace collector and digest delivery" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <IntegrationsTab info={info} />
          <Section title="Daily digest" description="Slack or webhook delivery of the daily summary.">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Newspaper className="size-4" /> Delivery is set up next to the digest itself.
              </div>
              <Link href="/digest">
                <Button variant="outline" size="sm">
                  Open digest
                </Button>
              </Link>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
