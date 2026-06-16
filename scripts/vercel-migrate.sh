#!/bin/bash
# Vercel build-time migration runner.
# Handles the case where the production database was provisioned before
# migration tracking was enabled (P3005: database schema is not empty).
#
# Strategy:
#   1. Try `prisma migrate deploy` to apply any pending migrations.
#   2. If it fails (e.g. P3005), baseline ALL existing migrations as
#      already applied EXCEPT the newest one, then retry. The newest
#      migration is the one we actually want to run.
#   3. If migrate deploy still fails, fall back to executing the newest
#      migration SQL directly via `prisma db execute`. This is safe only
#      because we ensure new migrations are idempotent.
set -uo pipefail

echo "=== vercel-migrate: start ==="

MIGRATIONS_DIR="prisma/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "No migrations directory found, skipping."
  exit 0
fi

# List migration folder names sorted chronologically
ALL_MIGRATIONS=$(ls -1 "$MIGRATIONS_DIR" | sort)
NEWEST_MIGRATION=$(echo "$ALL_MIGRATIONS" | tail -1)
echo "Newest migration (will be applied if pending): $NEWEST_MIGRATION"

run_migrate_deploy() {
  if ! npx prisma migrate deploy 2>&1; then
    echo "prisma migrate deploy failed (exit $?)"
    return 1
  fi
  return 0
}

baseline_existing() {
  echo "=== Baslining existing migrations (except newest) ==="
  while IFS= read -r mig_name; do
    if [ "$mig_name" = "$NEWEST_MIGRATION" ]; then
      echo "  skip (newest): $mig_name"
      continue
    fi
    echo "  resolving as applied: $mig_name"
    npx prisma migrate resolve --applied "$mig_name" 2>&1 || true
  done <<< "$ALL_MIGRATIONS"
}

run_sql_directly() {
  local sql_file="$MIGRATIONS_DIR/$NEWEST_MIGRATION/migration.sql"
  if [ ! -f "$sql_file" ]; then
    echo "No SQL file at $sql_file, nothing to fall back to."
    return 0
  fi
  echo "=== Fallback: executing $sql_file directly ==="
  npx prisma db execute --file "$sql_file" --schema prisma/schema.prisma 2>&1 || {
    echo "prisma db execute failed (exit $?)"
    return 1
  }
}

# Step 1: try migrate deploy
if run_migrate_deploy; then
  echo "=== vercel-migrate: success (migrate deploy) ==="
  exit 0
fi

# Step 2: baseline then retry
echo "=== Step 2: baseline then retry ==="
baseline_existing
if run_migrate_deploy; then
  echo "=== vercel-migrate: success (baseline + migrate deploy) ==="
  exit 0
fi

# Step 3: fallback to direct SQL execution
echo "=== Step 3: fallback to direct SQL execution ==="
if run_sql_directly; then
  echo "=== vercel-migrate: success (direct SQL) ==="
  exit 0
fi

echo "=== vercel-migrate: FAILED ==="
exit 1
