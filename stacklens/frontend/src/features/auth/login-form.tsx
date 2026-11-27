'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { AuthCard, FormError, FormField, PasswordInput, SubmitButton, safeNext } from '@/features/auth/auth-form';

export function LoginForm() {
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? 'Sign in failed');
      // full navigation so the signed-in layout loads fresh
      window.location.assign(body.user?.mustChangePassword ? '/change-password' : safeNext(sp.get('next')));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to see your traces."
      footer="Forgot your password? Ask a StackLens admin to reset it."
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <FormField label="Email">
          <Input
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="h-9"
          />
        </FormField>
        <FormField label="Password">
          <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
