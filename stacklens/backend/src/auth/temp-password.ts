import 'server-only';
import { randomInt } from 'node:crypto';

/** Readable one-time password (no 0/O/1/l), e.g. `kq7m-3vtx-9wpe-hr4a`. The user must change it at first sign-in. */
export function tempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return [group(), group(), group(), group()].join('-');
}
