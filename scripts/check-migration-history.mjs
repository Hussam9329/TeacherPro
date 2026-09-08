import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 30000 });
try {
 await client.connect();
 await client.query('BEGIN READ ONLY');
 const exists = await client.query(`SELECT to_regclass('"_prisma_migrations"') AS relation`);
 if (exists.rows[0].relation) {
  const rows = (await client.query('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows;
  const legacy = JSON.parse(fs.readFileSync('prisma/legacy-migration-manifest.json','utf8')).migrations;
  for (const row of rows) {
   const file = path.join('prisma/migrations', row.migration_name, 'migration.sql');
   if (fs.existsSync(file)) {
    const checksum = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (checksum !== row.checksum) throw new Error(`Applied migration was modified: ${row.migration_name}`);
   } else if (!legacy.some(item => item.migration_name === row.migration_name && item.checksum === row.checksum)) {
    throw new Error(`Unreviewed production-only migration: ${row.migration_name}`);
   }
  }
  console.log(`Migration history verified: ${rows.length} applied entries; documented legacy exceptions remain in the manifest.`);
 }
 await client.query('ROLLBACK');
} catch (error) {
 await client.query('ROLLBACK').catch(()=>{});
 console.error(error.message);
 process.exitCode=1;
} finally { await client.end().catch(()=>{}); }
