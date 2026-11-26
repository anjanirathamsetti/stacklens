'use client';
import { Clock, KeyRound, LockKeyhole } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { SaveBar } from '@/components/layout/save-bar';
import { Field, Section } from '@/components/layout/settings-ui';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useConfigDraft } from '@/lib/use-config';

export default function SecurityPage() {
  const { draft, update, dirty, save, saving, discard } = useConfigDraft('security');
  return (
    <>
      <PageHeader title="Security" description="Sign-in and password rules for everyone" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <Section title="Sessions" description="How long someone stays signed in.">
            <Field label="Sign out after" hint="Days without activity. Activity extends the session.">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={draft.sessionDays}
                  onChange={(e) => update({ sessionDays: Number(e.target.value) })}
                  className="w-24 text-right font-mono"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            </Field>
          </Section>
          <Section title="Passwords" description="Applies to new passwords. Existing passwords keep working.">
            <Field label="Minimum length" hint="8–64 characters">
              <div className="flex items-center gap-2">
                <LockKeyhole className="size-4 text-muted-foreground" />
                <Input
                  type="number"
                  min={8}
                  max={64}
                  value={draft.minPasswordLength}
                  onChange={(e) => update({ minPasswordLength: Number(e.target.value) })}
                  className="w-24 text-right font-mono"
                />
                <span className="text-sm text-muted-foreground">characters</span>
              </div>
            </Field>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              Passwords are hashed with scrypt. Sign-in attempts are rate limited per email and address, and changing a password signs the
              person out everywhere else.
            </div>
          </Section>
          <Section title="Locked out?" description="If no admin can sign in.">
            <div className="flex items-start gap-3 text-sm">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                Any admin can reset another user’s password from <span className="text-foreground">Users</span>. On a fresh database, set{' '}
                <code className="font-mono text-xs">STACKLENS_ADMIN_EMAIL</code> and{' '}
                <code className="font-mono text-xs">STACKLENS_ADMIN_PASSWORD</code> to create the first admin at startup.
              </p>
            </div>
          </Section>
          <SaveBar
            dirty={dirty}
            saving={saving}
            onDiscard={discard}
            onSave={() =>
              save()
                .then(() => toast('Security settings saved'))
                .catch((e: Error) => toast(e.message, 'error'))
            }
          />
        </div>
      </div>
    </>
  );
}
