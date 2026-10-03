import assert from 'node:assert/strict';
import fs from 'node:fs';
// The old clear/restore tool is deleted: nothing can wipe or replay the ledger.
for (const name of ['clear', 'restore']) {
 assert.equal(fs.existsSync(`src/app/api/logs/${name}/route.ts`), false, `logs/${name} must stay deleted`);
}
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
assert.match(schema, /model LogClearBackup/); // Keep historical recovery evidence.
console.log('PASS: retired log maintenance cannot delete or replay the accounting ledger');
