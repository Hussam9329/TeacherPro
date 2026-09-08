import { Prisma } from '@prisma/client';
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
 await client.connect(); await client.query('BEGIN READ ONLY');
 const rows=(await client.query("SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema='public'")).rows;
 const columns=new Map(rows.map(r=>[`${r.table_name}.${r.column_name}`,r]));
 for(const model of Prisma.dmmf.datamodel.models) for(const field of model.fields.filter(f=>f.kind!=='object')) {
  const key=`${model.dbName||model.name}.${field.dbName||field.name}`;
  if(!columns.has(key)) throw new Error(`Current runtime schema missing ${key}`);
  if(field.isRequired && columns.get(key).is_nullable!=='NO') throw new Error(`Current runtime schema permits unexpected null: ${key}`);
 }
 const triggers=(await client.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")).rows.map(r=>r.tgname);
 for(const name of ['tp_sync_exam_course_projection_trg','tp_exam_course_projection_guard','tp_revoke_changed_credentials','tp_assign_exam_chapter']) if(!triggers.includes(name)) throw new Error(`Missing runtime database guard: ${name}`);
 await client.query('ROLLBACK');console.log('Current schema contract verified independently of legacy SQL provenance.');
} catch(error) { console.error(error.message);process.exitCode=1; }
finally { await client.end().catch(()=>{}); }
