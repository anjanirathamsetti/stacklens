import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WelcomeForm } from '@/features/auth/welcome-form';
import { getConfig } from '@/server/repositories/config-repository';
import { countUsers } from '@/server/repositories/account-repository';

export const metadata: Metadata = { title: 'Set up' };

/** Only available until the first account exists. */
export default async function WelcomePage() {
  if ((await countUsers()) > 0) redirect('/login');
  const { minPasswordLength } = await getConfig('security');
  return <WelcomeForm minPasswordLength={minPasswordLength} />;
}
