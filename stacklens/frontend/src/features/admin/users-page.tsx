'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, KeyRound, MoreHorizontal, Plus, ShieldCheck, Trash2, UserCheck, UserPlus, UserX, Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { copyWithToast, toast } from '@/components/ui/toast';
import { CopyButton } from '@/components/data-display/json-view';
import { ROLE_LABELS, useCurrentUser } from '@/lib/current-user';
import { initials } from '@/lib/settings-context';
import { sendJson, useResource } from '@/lib/use-resource';
import { cn, timeAgo } from '@/lib/utils';
import type { AuthUser, Role } from '@stacklens/shared/api-types';

const URL_ = '/api/admin/users';
const ROLES: Role[] = ['admin', 'member', 'viewer'];

function Avatar({ name, dim }: { name: string; dim?: boolean }) {
  return (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand/80 to-violet-500/80 text-[11px] font-semibold text-white',
        dim && 'opacity-40 grayscale',
      )}
    >
      {initials(name)}
    </span>
  );
}

function RolePicker({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="grid gap-2">
      {ROLES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={cn(
            'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer hover:bg-accent/50',
            value === r && 'border-brand/50 bg-brand/[0.05] ring-1 ring-brand/30',
          )}
        >
          <span
            className={cn('mt-0.5 grid size-4 place-items-center rounded-full border', value === r && 'border-brand bg-brand text-white')}
          >
            {value === r && <Check className="size-3" />}
          </span>
          <span>
            <span className="block text-sm font-medium">{ROLE_LABELS[r].label}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_LABELS[r].description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Shows a one-time password exactly once. */
function TempPasswordDialog({
  data,
  onClose,
}: {
  data: { name: string; email: string; password: string; reset?: boolean } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!data} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        {data && (
          <>
            <div className="mb-4 flex items-start gap-3 pr-8">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-success/12 text-success">
                <ShieldCheck className="size-4.5" />
              </div>
              <div>
                <DialogTitle>{data.reset ? 'Password reset' : `${data.name.split(' ')[0]} can now sign in`}</DialogTitle>
                <DialogDescription>
                  Share this one-time password with {data.name} through a private channel. They’ll choose their own password when they sign
                  in.
                </DialogDescription>
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Email</div>
                <div className="font-mono text-sm">{data.email}</div>
                <div className="mt-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">One-time password</div>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-base font-semibold tracking-wide">{data.password}</code>
                  <CopyButton text={data.password} />
                </div>
              </div>
              <div className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">This password won’t be shown again.</div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  copyWithToast(
                    `StackLens: ${window.location.origin}/login\nEmail: ${data.email}\nOne-time password: ${data.password}`,
                    'Sign-in details copied',
                  )
                }
              >
                Copy sign-in details
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (u: AuthUser, password: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await sendJson<{ user: AuthUser; tempPassword: string }>(URL_, 'POST', { name, email, role });
      onCreated(r.user, r.tempPassword);
      setName('');
      setEmail('');
      setRole('member');
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <form onSubmit={submit}>
          <div className="mb-4 flex items-start gap-3 pr-8">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
              <UserPlus className="size-4.5" />
            </div>
            <div>
              <DialogTitle>Add user</DialogTitle>
              <DialogDescription>You’ll get a one-time password to share. StackLens doesn’t send email.</DialogDescription>
            </div>
          </div>
          <div className="space-y-3.5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Name</span>
              <Input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Email</span>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
            </label>
            <div className="space-y-1.5">
              <span className="text-xs font-medium">Role</span>
              <RolePicker value={role} onChange={setRole} />
            </div>
            {error && <div className="text-xs text-destructive">{error}</div>}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              <UserPlus /> Add user
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ u }: { u: AuthUser }) {
  if (u.disabled) return <Badge tone="neutral">Disabled</Badge>;
  if (u.mustChangePassword) return <Badge tone="warning">Invited</Badge>;
  return <Badge tone="success">Active</Badge>;
}

export default function UsersPage() {
  const router = useRouter();
  const { user: me } = useCurrentUser();
  const { data, reload } = useResource<{ users: AuthUser[] }>(URL_);
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState<{ name: string; email: string; password: string; reset?: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const users = data?.users ?? [];
  const shown = users.filter((u) => !query || `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()));
  const admins = users.filter((u) => u.role === 'admin' && !u.disabled).length;

  const patch = async (u: AuthUser, body: Partial<AuthUser>, message: string) => {
    try {
      await sendJson(`${URL_}/${u.id}`, 'PATCH', body);
      toast(message);
      void reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const resetPassword = async (u: AuthUser) => {
    if (!window.confirm(`Reset ${u.name}'s password? They'll be signed out everywhere and need the new one-time password.`)) return;
    try {
      const r = await sendJson<{ tempPassword: string }>(`${URL_}/${u.id}/password`, 'POST');
      setTemp({ name: u.name, email: u.email, password: r.tempPassword, reset: true });
      void reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const remove = async (u: AuthUser) => {
    if (!window.confirm(`Delete ${u.name} (${u.email})? This can't be undone. Disable the account instead if you might need it again.`))
      return;
    try {
      await sendJson(`${URL_}/${u.id}`, 'DELETE');
      toast(`Deleted ${u.name}`);
      void reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Users" description="Who can sign in to StackLens, and what they can do">
        <Button onClick={() => setAdding(true)}>
          <Plus /> Add user
        </Button>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 p-6">
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Users', users.length],
              ['Admins', admins],
              ['Disabled', users.filter((u) => u.disabled).length],
            ].map(([l, v]) => (
              <Card key={l} className="px-4 py-3">
                <div className="text-xs font-medium text-muted-foreground">{l}</div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{v}</div>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b p-3">
              <Input placeholder="Search by name or email…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
              <span className="ml-auto text-xs text-muted-foreground">
                {shown.length} of {users.length}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="h-9 pl-4 font-medium">User</th>
                  <th className="h-9 px-3 font-medium">Role</th>
                  <th className="h-9 px-3 font-medium">Status</th>
                  <th className="h-9 px-3 font-medium">Last sign-in</th>
                  <th className="h-9 w-12 pr-4" />
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => {
                  const isMe = u.id === me.id;
                  return (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="py-2.5 pl-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} dim={u.disabled} />
                          <div className="min-w-0">
                            <div className={cn('truncate font-medium', u.disabled && 'text-muted-foreground')}>
                              {u.name}
                              {isMe && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3">
                        <Select
                          value={u.role}
                          onChange={(e) => {
                            const role = e.target.value as Role;
                            if (role !== u.role) void patch(u, { role }, `${u.name} is now ${ROLE_LABELS[role].label.toLowerCase()}`);
                          }}
                          className="w-32"
                          aria-label={`Role of ${u.name}`}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r].label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3">
                        <StatusBadge u={u} />
                      </td>
                      <td className="px-3 text-xs text-muted-foreground">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</td>
                      <td className="pr-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {!isMe && (
                              <DropdownMenuItem onSelect={() => void resetPassword(u)}>
                                <KeyRound /> Reset password
                              </DropdownMenuItem>
                            )}
                            {isMe && (
                              <DropdownMenuItem onSelect={() => router.push('/settings?tab=profile')}>
                                <KeyRound /> Change your password
                              </DropdownMenuItem>
                            )}
                            {!isMe &&
                              (u.disabled ? (
                                <DropdownMenuItem onSelect={() => void patch(u, { disabled: false }, `${u.name} can sign in again`)}>
                                  <UserCheck /> Enable
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() => void patch(u, { disabled: true }, `${u.name} is disabled and signed out`)}
                                >
                                  <UserX /> Disable
                                </DropdownMenuItem>
                              ))}
                            {!isMe && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => void remove(u)} className="text-destructive">
                                  <Trash2 /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data && shown.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
                <Users className="size-5" /> No users match “{query}”
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold">Roles</div>
            <div className="grid gap-3 sm:grid-cols-3">
              {ROLES.map((r) => (
                <div key={r} className="rounded-md border p-3">
                  <div className="text-sm font-medium">{ROLE_LABELS[r].label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{ROLE_LABELS[r].description}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <AddUserDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(u, password) => {
          setTemp({ name: u.name, email: u.email, password });
          void reload();
        }}
      />
      <TempPasswordDialog data={temp} onClose={() => setTemp(null)} />
    </>
  );
}
