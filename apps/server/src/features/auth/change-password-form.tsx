'use client';
import { useState } from 'react';
import { signOut } from '@/lib/current-user';
import { AuthCard, FormError, FormField, PasswordInput, SubmitButton } from './auth-form';

/** Forced after an admin creates an account or resets a password (one-time password). */
export function ChangePasswordForm({ name, minPasswordLength }: { name: string; minPasswordLength: number }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = !!confirm && next !== confirm;
  const short = !!next && next.length < minPasswordLength;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch || short) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? 'Could not change the password');
      window.location.assign('/overview');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title={`Welcome, ${name.split(' ')[0]}`}
      description="You signed in with a one-time password. Choose your own password to continue."
      footer={
        <button type="button" onClick={() => void signOut()} className="hover:text-foreground hover:underline cursor-pointer">
          Not you? Sign out
        </button>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <FormField label="One-time password">
          <PasswordInput autoComplete="current-password" autoFocus required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
        <FormField
          label="New password"
          hint={`At least ${minPasswordLength} characters`}
          error={short ? `Use at least ${minPasswordLength} characters` : undefined}
        >
          <PasswordInput autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
        </FormField>
        <FormField label="Confirm new password" error={mismatch ? 'Passwords don’t match' : undefined}>
          <PasswordInput autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        <SubmitButton busy={busy} disabled={mismatch || short}>
          Set password and continue
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
