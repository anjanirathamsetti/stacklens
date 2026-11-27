import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/features/auth/login-form';
import { getCurrentUser } from '@/server/session';
import { countUsers } from '@stacklens/backend/repositories/account-repository';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/overview');
  if ((await countUsers()) === 0) redirect('/welcome');
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
