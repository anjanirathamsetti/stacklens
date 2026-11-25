import 'server-only';
import type { TraceQuery } from './repositories/trace-repository';

export function parseQuery(url: string): TraceQuery {
  const sp = new URL(url).searchParams;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  const str = (k: string) => sp.get(k) || undefined;
  return {
    search: str('search'),
    status: str('status'),
    method: str('method'),
    application: str('app') ?? str('application') ?? str('service'),
    project: str('project'),
    environment: str('env'),
    userId: str('user'),
    route: str('route'),
    minDuration: num('minDuration'),
    from: num('from'),
    to: num('to'),
    limit: num('limit'),
    offset: num('offset'),
    sort: (str('sort') as TraceQuery['sort']) ?? undefined,
    order: sp.get('order') === 'asc' ? 'asc' : sp.get('order') === 'desc' ? 'desc' : undefined,
  };
}
