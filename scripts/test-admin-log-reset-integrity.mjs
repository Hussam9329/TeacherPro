import assert from 'node:assert/strict';
import fs from 'node:fs';
for (const name of ['clear', 'restore']) {
 const route = fs.readFileSync(`src/app/api/logs/${name}/route.ts`, 'utf8');
 assert.match(route, /requirePermission/);
 assert.match(route, /LEDGER_HISTORY_IMMUTABLE/);
 assert.match(route, /status: 410/);
 assert.doesNotMatch(route, /deleteMany|createMany|\$transaction/);
}
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
assert.match(schema, /model LogClearBackup/); // Keep historical recovery evidence.
console.log('PASS: retired log maintenance cannot delete or replay the accounting ledger');
