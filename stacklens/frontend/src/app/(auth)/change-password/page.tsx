import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '@/features/auth/change-password-form';
import { getCurrentUser } from '@/server/session';
import { getConfig } from '@stacklens/backend/repositories/config-repository';

export const metadata: Metadata = { title: 'Choose a password' };

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.mustChangePassword) redirect('/settings?tab=profile');
  const { minPasswordLength } = await getConfig('security');
  return <ChangePasswordForm name={user.name} minPasswordLength={minPasswordLength} />;
}
