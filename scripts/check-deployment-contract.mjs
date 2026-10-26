import fs from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
export function validatePendingMigration(name, sql, policy, populated) {
 if (!policy || policy.checksum !== createHash('sha256').update(sql).digest('hex')) throw new Error(`Unreviewed migration policy: ${name}`);
 if (policy.kind === 'historical-bootstrap') {
  if (populated) throw new Error(`Historical migration replay on populated database blocked: ${name}`);
  return;
 }
 if (!['expand', 'audited-data-reconciliation'].includes(policy.kind)) throw new Error(`Contract migration cannot run during build: ${name}`);
 let statements = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
 // A reviewed policy may name CHECK constraints the migration widens. Each one is
 // dropped and added back under the same name in one ALTER TABLE, so the table is
 // never without it; any other DROP still stops the build.
 for (const constraint of policy.widensCheck || []) {
  if (policy.kind !== 'expand' || typeof constraint !== 'string' || !/^\w+$/.test(constraint)) throw new Error(`Invalid CHECK widening policy: ${name}`);
  const replaced = new RegExp(`DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?"${constraint}"\\s*,(?=\\s*ADD\\s+CONSTRAINT\\s+"${constraint}"\\s+CHECK\\b)`, 'gi');
  const widened = statements.replace(replaced, '');
  if (widened === statements) throw new Error(`Policy names a CHECK widening the migration does not do: ${name}`);
  statements = widened;
 }
 if (/\b(?:DROP\b|TRUNCATE\b|RENAME\b|ALTER\s+COLUMN\s+\S+\s+(?:TYPE|SET\s+NOT\s+NULL))/i.test(statements)) throw new Error(`Destructive schema change requires a separate contract release: ${name}`);
}
if (process.argv[1]?.endsWith('check-deployment-contract.mjs')) {
 const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
 try {
  await client.connect(); await client.query('BEGIN READ ONLY');
  const tables = (await client.query(`SELECT to_regclass('"_prisma_migrations"') history, to_regclass('"Student"') students`)).rows[0];
  const applied = tables.history ? (await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map(r=>r.migration_name) : [];
  const populated = tables.students ? (await client.query('SELECT EXISTS(SELECT 1 FROM "Student") AS populated')).rows[0].populated : false;
  const policies = JSON.parse(fs.readFileSync('prisma/deployment-migration-policy.json','utf8'));
  for (const name of fs.readdirSync('prisma/migrations').sort()) {
   const file = `prisma/migrations/${name}/migration.sql`;
   if (applied.includes(name) || !fs.existsSync(file)) continue;
   validatePendingMigration(name, fs.readFileSync(file,'utf8'), policies[name], populated);
  }
  await client.query('ROLLBACK'); console.log('Pending migrations preserve compatibility with the running deployment.');
 } catch (error) { console.error(error.message); process.exitCode=1; }
 finally { await client.end().catch(()=>{}); }
}
