import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ApiKeyInfo, AuditEntry, AuthUser, Role } from '@/lib/api-types';
import { getDb } from '../db/client';

/** Users, login sessions, API keys and the audit log. */

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ms = (d: Date | string | null) => (d ? new Date(d).getTime() : undefined);

/* -------------------------------- Users -------------------------------- */

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  disabled: boolean;
  must_change_password: boolean;
  created_at: Date | string;
  last_login_at: Date | string | null;
}

const toUser = (r: UserRow): AuthUser => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  disabled: r.disabled,
  mustChangePassword: r.must_change_password,
  createdAt: ms(r.created_at)!,
  lastLoginAt: ms(r.last_login_at),
});

export const ROLES: Role[] = ['admin', 'member', 'viewer'];
export const isRole = (r: unknown): r is Role => ROLES.includes(r as Role);
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: unknown): e is string =>
  typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) && e.length <= 254;

export async function countUsers(): Promise<number> {
  const db = await getDb();
  const [r] = await db.query<{ n: string }>('select count(*) as n from users');
  return Number(r.n);
}

export async function countActiveAdmins(exceptId?: string): Promise<number> {
  const db = await getDb();
  const [r] = await db.query<{ n: string }>(
    `select count(*) as n from users where role = 'admin' and not disabled and ($1::text is null or id <> $1)`,
    [exceptId ?? null],
  );
  return Number(r.n);
}

export async function listUsers(): Promise<AuthUser[]> {
  const db = await getDb();
  return (await db.query<UserRow>('select * from users order by lower(name)')).map(toUser);
}

export async function getUser(id: string): Promise<AuthUser | undefined> {
  const db = await getDb();
  const [r] = await db.query<UserRow>('select * from users where id = $1', [id]);
  return r ? toUser(r) : undefined;
}

/** Includes the password hash – only for login and password changes. */
export async function getUserWithHash(by: { email: string } | { id: string }): Promise<(AuthUser & { passwordHash: string }) | undefined> {
  const db = await getDb();
  const [r] =
    'email' in by
      ? await db.query<UserRow>('select * from users where lower(email) = $1', [normalizeEmail(by.email)])
      : await db.query<UserRow>('select * from users where id = $1', [by.id]);
  return r ? { ...toUser(r), passwordHash: r.password_hash } : undefined;
}

export async function createUser(u: {
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  mustChangePassword?: boolean;
}): Promise<AuthUser> {
  const db = await getDb();
  const [r] = await db.query<UserRow>(
    `insert into users (id, email, name, role, password_hash, must_change_password)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [randomUUID(), normalizeEmail(u.email), u.name.trim(), u.role, u.passwordHash, !!u.mustChangePassword],
  );
  return toUser(r);
}

/** Creates the very first account as admin; returns undefined if any account already exists. */
export async function createFirstAdmin(u: { email: string; name: string; passwordHash: string }): Promise<AuthUser | undefined> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query('lock table users in exclusive mode');
    const [{ n }] = await tx.query<{ n: string }>('select count(*) as n from users');
    if (Number(n) > 0) return undefined;
    const [r] = await tx.query<UserRow>(
      `insert into users (id, email, name, role, password_hash) values ($1, $2, $3, 'admin', $4) returning *`,
      [randomUUID(), normalizeEmail(u.email), u.name.trim(), u.passwordHash],
    );
    return toUser(r);
  });
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<AuthUser, 'name' | 'email' | 'role' | 'disabled'>>,
): Promise<AuthUser | undefined> {
  const db = await getDb();
  const [r] = await db.query<UserRow>(
    `update users set name = coalesce($2, name), email = coalesce($3, email), role = coalesce($4, role),
       disabled = coalesce($5, disabled), updated_at = now()
     where id = $1 returning *`,
    [id, patch.name?.trim() ?? null, patch.email ? normalizeEmail(patch.email) : null, patch.role ?? null, patch.disabled ?? null],
  );
  return r ? toUser(r) : undefined;
}

export async function setPassword(id: string, passwordHash: string, mustChange: boolean): Promise<void> {
  const db = await getDb();
  await db.query('update users set password_hash = $2, must_change_password = $3, updated_at = now() where id = $1', [
    id,
    passwordHash,
    mustChange,
  ]);
}

export async function deleteUser(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query('delete from users where id = $1 returning id', [id])).length > 0;
}

export async function emailTaken(email: string, exceptId?: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query('select 1 from users where lower(email) = $1 and ($2::text is null or id <> $2)', [
    normalizeEmail(email),
    exceptId ?? null,
  ]);
  return rows.length > 0;
}

/* ------------------------------- Sessions ------------------------------ */

export async function createSession(
  userId: string,
  days: number,
  meta: { userAgent?: string; ip?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  const db = await getDb();
  await db.query(`insert into sessions (token_hash, user_id, expires_at, user_agent, ip) values ($1, $2, $3, $4, $5)`, [
    sha256(token),
    userId,
    expiresAt,
    meta.userAgent?.slice(0, 300) ?? null,
    meta.ip ?? null,
  ]);
  await db.query('update users set last_login_at = now() where id = $1', [userId]);
  return { token, expiresAt };
}

/**
 * The user behind a session token, or undefined when it is unknown, expired or the user is disabled.
 * Sliding expiry: activity pushes the expiry out (at most once an hour, to keep writes cheap).
 */
export async function userForSession(token: string, days: number): Promise<AuthUser | undefined> {
  const db = await getDb();
  const hash = sha256(token);
  const [r] = await db.query<UserRow & { last_seen_at: Date | string }>(
    `select u.*, s.last_seen_at from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and not u.disabled`,
    [hash],
  );
  if (!r) return undefined;
  if (Date.now() - new Date(r.last_seen_at).getTime() > 3_600_000) {
    await db.query(`update sessions set last_seen_at = now(), expires_at = now() + make_interval(days => $2) where token_hash = $1`, [
      hash,
      days,
    ]);
  }
  return toUser(r);
}

export async function deleteSession(token: string): Promise<void> {
  const db = await getDb();
  await db.query('delete from sessions where token_hash = $1', [sha256(token)]);
}

/** Sign a user out everywhere, optionally keeping the current session. */
export async function deleteUserSessions(userId: string, keepToken?: string): Promise<void> {
  const db = await getDb();
  await db.query('delete from sessions where user_id = $1 and ($2::text is null or token_hash <> $2)', [
    userId,
    keepToken ? sha256(keepToken) : null,
  ]);
}

export async function pruneSessions(): Promise<void> {
  const db = await getDb();
  await db.query('delete from sessions where expires_at < now()');
}

/* ------------------------------- API keys ------------------------------ */

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scope: 'ingest';
  created_by_name: string | null;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}

const toKey = (r: KeyRow): ApiKeyInfo => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  scope: r.scope,
  createdBy: r.created_by_name ?? undefined,
  createdAt: ms(r.created_at)!,
  lastUsedAt: ms(r.last_used_at),
  revokedAt: ms(r.revoked_at),
});

export async function listApiKeys(): Promise<ApiKeyInfo[]> {
  const db = await getDb();
  return (
    await db.query<KeyRow>(
      `select k.*, u.name as created_by_name from api_keys k left join users u on u.id = k.created_by
       order by k.revoked_at is not null, k.created_at desc`,
    )
  ).map(toKey);
}

/** Returns the full key exactly once; only its hash is stored. */
export async function createApiKey(name: string, createdBy: string): Promise<{ key: string; info: ApiKeyInfo }> {
  const key = `slk_${randomBytes(24).toString('base64url')}`;
  const db = await getDb();
  const id = randomUUID();
  await db.query(`insert into api_keys (id, name, prefix, key_hash, created_by) values ($1, $2, $3, $4, $5)`, [
    id,
    name.trim(),
    key.slice(0, 10),
    sha256(key),
    createdBy,
  ]);
  const [r] = await db.query<KeyRow>(
    'select k.*, u.name as created_by_name from api_keys k left join users u on u.id = k.created_by where k.id = $1',
    [id],
  );
  return { key, info: toKey(r) };
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query('update api_keys set revoked_at = now() where id = $1 and revoked_at is null returning id', [id])).length > 0;
}

const lastUsedWrites = new Map<string, number>();

/** True for an unrevoked key. Records "last used" at most once a minute per key. */
export async function verifyApiKey(key: string): Promise<boolean> {
  if (!key.startsWith('slk_')) return false;
  const db = await getDb();
  const hash = sha256(key);
  const [r] = await db.query<{ id: string }>('select id from api_keys where key_hash = $1 and revoked_at is null', [hash]);
  if (!r) return false;
  const last = lastUsedWrites.get(r.id) ?? 0;
  if (Date.now() - last > 60_000) {
    lastUsedWrites.set(r.id, Date.now());
    await db.query('update api_keys set last_used_at = now() where id = $1', [r.id]);
  }
  return true;
}

/* ------------------------------- Audit log ----------------------------- */

export async function audit(
  actor: Pick<AuthUser, 'id' | 'email'> | null,
  action: string,
  target?: string,
  details: Record<string, unknown> = {},
  ip?: string,
): Promise<void> {
  const db = await getDb();
  await db.query(`insert into audit_log (actor_id, actor_email, action, target, details, ip) values ($1, $2, $3, $4, $5::jsonb, $6)`, [
    actor?.id ?? null,
    actor?.email ?? null,
    action,
    target ?? null,
    JSON.stringify(details),
    ip ?? null,
  ]);
}

export async function listAudit(limit = 200, before?: number): Promise<AuditEntry[]> {
  const db = await getDb();
  const rows = await db.query<{
    id: string;
    at: Date | string;
    actor_email: string | null;
    action: string;
    target: string | null;
    details: Record<string, unknown>;
    ip: string | null;
  }>('select * from audit_log where ($2::bigint is null or id < $2) order by id desc limit $1', [Math.min(500, limit), before ?? null]);
  return rows.map((r) => ({
    id: Number(r.id),
    at: ms(r.at)!,
    actorEmail: r.actor_email ?? undefined,
    action: r.action,
    target: r.target ?? undefined,
    details: r.details,
    ip: r.ip ?? undefined,
  }));
}
