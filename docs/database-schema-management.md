# Database schema management

TeacherPro has one schema authority: the ordered SQL files under
`prisma/migrations`. Application and API code must never run `CREATE`, `ALTER`,
`DROP`, or schema-repair SQL.

`20260601000000_initial_schema_bridge` makes the historical migration chain
reproducible on an empty PostgreSQL database. It is idempotent for the existing
production database, whose base tables predate Prisma Migrate. The guarded
deployment verifies the five core tables and records this bridge as an applied
baseline on the existing database; an empty database executes it normally.

## Development

1. Change `prisma/schema.prisma`.
2. Run `npm run db:migrate -- --name <descriptive_name>` against a development
   database.
3. Review the generated SQL. Put one-time backfills or cleanup needed by that
   schema change in the same migration, before constraints are enforced.
4. Run the integrity tests and application build.

Do not use `prisma db push` for shared or production databases. It bypasses the
versioned history and recreates the same conflict this policy removes.

## Production

Vercel production must define:

- `DATABASE_URL`: pooled runtime connection.
- `DIRECT_URL`: direct database connection for DDL when the provider offers one.
- `TEACHERPRO_RUN_MIGRATIONS=true`: required production deployment opt-in.

The guarded build compiles first, warms the database, runs
the read-only orphan preflight, runs `prisma migrate deploy`, and verifies
`prisma migrate status`. Any failure stops the deployment, so Vercel keeps
serving the previous compatible release. The preflight reports legacy broken
relations but never deletes or rewrites them.

At runtime, `src/lib/schema-readiness.ts` only reads `_prisma_migrations`. If the
required migration is absent, the API returns HTTP 503 with code
`DATABASE_MIGRATION_REQUIRED`; it does not try to repair the database.

## Emergency changes

Do not hotfix production schema manually unless service recovery requires it.
If a manual hotfix is unavoidable, immediately create an equivalent migration
and reconcile its state with `prisma migrate resolve` only after comparing the
database and migration SQL. Never mark an unverified migration as applied.
