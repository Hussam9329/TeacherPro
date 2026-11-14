// database-error.ts reads PostgreSQL details from Prisma errors in both shapes:
// the native engine's (meta.code / meta.target) and the pg driver adapter's
// (meta.driverAdapterError.cause). The adapter shapes below were captured from
// Prisma 6.19 with engineType "client" against a real PostgreSQL server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
  filename,
);

const { databaseErrorCode, databaseErrorMessage, uniqueConstraintTarget } = require('../src/lib/database-error.ts');

const adapterUnique = {
  code: 'P2002',
  message: 'Unique constraint failed on the fields: (`"phoneKey"`)',
  meta: {
    modelName: 'Student',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        originalMessage: 'duplicate key value violates unique constraint "Student_phoneKey_key"',
        kind: 'UniqueConstraintViolation',
        constraint: { fields: ['"phoneKey"'] },
      },
    },
  },
};
assert.equal(uniqueConstraintTarget(adapterUnique), 'phoneKey');
assert.equal(databaseErrorCode(adapterUnique), '23505');

assert.equal(uniqueConstraintTarget({ code: 'P2002', meta: { target: ['telegramKey'] } }), 'telegramKey');
assert.equal(uniqueConstraintTarget({ code: 'P2002', meta: { target: 'Student_code_key' } }), 'Student_code_key');
assert.equal(
  uniqueConstraintTarget({ code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { index: 'Student_code_key' } } } } }),
  'Student_code_key',
);
assert.equal(uniqueConstraintTarget({ code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { fields: ['"courseId"', '"name"'] } } } } }), 'courseId,name');
assert.equal(uniqueConstraintTarget({ code: 'P2002' }), '');
assert.equal(uniqueConstraintTarget(null), '');

const adapterRaw = {
  code: 'P2010',
  message: 'Raw query failed. Code: `23P01`. Message: `GRACE_PERIOD_OVERLAP`',
  meta: {
    driverAdapterError: {
      cause: { originalCode: '23P01', originalMessage: 'GRACE_PERIOD_OVERLAP', kind: 'postgres', code: '23P01', severity: 'ERROR', message: 'GRACE_PERIOD_OVERLAP' },
    },
  },
};
assert.equal(databaseErrorCode(adapterRaw), '23P01');
assert.ok(databaseErrorMessage(adapterRaw).includes('GRACE_PERIOD_OVERLAP'));

const adapterConflict = {
  code: 'P2034',
  message: 'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
  meta: { driverAdapterError: { cause: { originalCode: '40001', originalMessage: 'could not serialize access due to read/write dependencies among transactions', kind: 'TransactionWriteConflict' } } },
};
assert.equal(databaseErrorCode(adapterConflict), '40001');
assert.match(databaseErrorMessage(adapterConflict), /could not serialize/);

assert.equal(databaseErrorCode({ code: 'P2010', meta: { code: '40P01', database_error: 'deadlock detected' } }), '40P01');
assert.match(databaseErrorMessage({ message: 'x', meta: { database_error: 'deadlock detected' } }), /deadlock detected/);
assert.equal(databaseErrorCode(new Error('plain')), '');
assert.equal(databaseErrorCode(undefined), '');

console.log('database-error: both Prisma error shapes read correctly');
