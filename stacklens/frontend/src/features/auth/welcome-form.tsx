'use client';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AuthCard, FormError, FormField, PasswordInput, SubmitButton } from '@/features/auth/auth-form';

/** First run: create the admin account. */
export function WelcomeForm({ minPasswordLength }: { minPasswordLength: number }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = !!confirm && password !== confirm;
  const short = !!password && password.length < minPasswordLength;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch || short) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? 'Could not create the account');
      window.location.assign('/overview');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Set up StackLens"
      description="Create the first account. It becomes the admin, who can add teammates and manage settings."
      footer={
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> Passwords are hashed with scrypt and never stored in plain text.
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <FormField label="Your name">
          <Input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        </FormField>
        <FormField label="Email" hint="You'll use this to sign in">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" />
        </FormField>
        <FormField
          label="Password"
          hint={`At least ${minPasswordLength} characters`}
          error={short ? `Use at least ${minPasswordLength} characters` : undefined}
        >
          <PasswordInput autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <FormField label="Confirm password" error={mismatch ? 'Passwords don’t match' : undefined}>
          <PasswordInput autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        <SubmitButton busy={busy} disabled={mismatch || short}>
          Create admin account
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
