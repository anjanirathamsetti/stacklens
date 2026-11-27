---
description: Security requirements for all StackLens changes
---

# Security rules

- Never commit secrets. `dump.txt`, `.env`, `.env.*` (except `.env.example`) stay out of git. Don't print API keys or passwords in logs or chat.
- Auth: session cookie is HttpOnly + SameSite=Lax (+ Secure over HTTPS). State-changing handlers reject cross-site requests (`isCrossSiteWrite`) and require a role via `withAuth`.
- Passwords: scrypt via `auth/password.ts`; compare in constant time; rate-limit login and setup. Generic error messages for failed sign-in.
- Ingest: API keys are stored as SHA-256 hashes and checked before the body is parsed (required when the admin enables "require ingest key"). There is no body-size cap yet; don't add work that makes oversized payloads more expensive.
- SQL is always parameterised. Never build SQL from request strings.
- Trust `x-forwarded-*` only when `env.trustProxy` is set.
- Anything rendered from traces is untrusted user data: no `dangerouslySetInnerHTML` without escaping (the SQL/type highlighters tokenize and escape).
- Admin actions are audited. Don't widen a role check without saying so in the summary.
