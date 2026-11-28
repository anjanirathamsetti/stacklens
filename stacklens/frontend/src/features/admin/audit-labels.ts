/** Audit log wording and colours, shared by the Audit log page and its PDF export. */

/** Plain-language labels for audit actions. */
const LABELS: Record<string, string> = {
  login: 'Signed in',
  logout: 'Signed out',
  'login.failed': 'Failed sign-in',
  'login.blocked': 'Blocked sign-in (disabled account)',
  'setup.admin_created': 'Created the first admin',
  'setup.admin_bootstrapped': 'Created the first admin from environment variables',
  'password.changed': 'Changed their password',
  'profile.updated': 'Updated their profile',
  'user.created': 'Added a user',
  'user.updated': 'Changed a user',
  'user.deleted': 'Deleted a user',
  'user.password_reset': 'Reset a user’s password',
  'api_key.created': 'Created an API key',
  'api_key.revoked': 'Revoked an API key',
  'data.traces_cleared': 'Deleted all trace data',
};

export const auditLabel = (a: string) => LABELS[a] ?? (a.startsWith('settings.') ? `Changed ${a.split('.')[1]} settings` : a);
export const auditTone = (a: string) =>
  a === 'login.failed' || a === 'login.blocked' || a.endsWith('deleted') || a.endsWith('revoked') || a.endsWith('cleared')
    ? 'bg-destructive'
    : a.startsWith('login') || a === 'logout'
      ? 'bg-muted-foreground/40'
      : 'bg-brand';
