---
name: add-db-migration
description: Change the StackLens PostgreSQL schema safely (new table, column or index) for both the pg driver and embedded PGlite.
---

# Add a database migration

1. Open `stacklens/backend/src/db/migrations.ts`. Append a new entry with the next version number. **Never edit or reorder released migrations.**
2. Write forward-only SQL that works on PostgreSQL 15+ and PGlite:
   - `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS … DEFAULT …`, `CREATE INDEX IF NOT EXISTS`.
   - New columns on big tables (`traces`, `error_events`) need a default or must be nullable; backfill in batches only if required.
3. Update the repository functions in `stacklens/backend/src/repositories/` and any summary logic in `domain/trace-summary.ts`.
4. Retention: if the new table grows with traffic, add cleanup to `services/maintenance.ts`.
5. Add tests in `stacklens/backend/test/repositories.test.ts`; they run against PGlite and (with `TEST_DATABASE_URL`) real PostgreSQL:
   ```bash
   npm test -w @stacklens/backend
   ```
6. Start the dev server against an existing data dir to confirm the migration applies on upgrade, not just on a fresh DB.
