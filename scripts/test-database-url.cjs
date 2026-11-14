// pgConnectionString names sslmode=verify-full where pg 8 already behaves as
// verify-full, so the connection is unchanged and pg's per-start warning goes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { parse } = require('pg-connection-string');

require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
  filename,
);

const warnings = [];
process.on('warning', (warning) => warnings.push(String(warning.message)));

(async () => {
  const { pgConnectionString } = require('../src/lib/database-url.ts');
  const neon = 'postgresql://user:p%40ss@ep-x-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

  const converted = pgConnectionString(neon);
  const url = new URL(converted);
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(url.searchParams.get('channel_binding'), 'require', 'other parameters are kept');
  assert.equal(url.username, 'user');
  assert.equal(decodeURIComponent(url.password), 'p@ss', 'credentials are kept');
  assert.equal(url.host, 'ep-x-pooler.c-8.us-east-1.aws.neon.tech');
  assert.equal(url.pathname, '/neondb');

  for (const mode of ['prefer', 'require', 'verify-ca']) {
    assert.match(pgConnectionString(`postgresql://u:p@h/db?sslmode=${mode}`), /sslmode=verify-full/);
  }
  for (const unchanged of [
    'postgresql://u:p@h/db?sslmode=disable',
    'postgresql://u:p@h/db?sslmode=verify-full',
    'postgresql://u:p@h/db',
    'postgresql://u:p@h/db?sslmode=require&uselibpqcompat=true',
    'not a url',
  ]) {
    assert.equal(pgConnectionString(unchanged), unchanged);
  }
  assert.equal(pgConnectionString(undefined), undefined);
  assert.equal(pgConnectionString(''), '');

  // pg builds the same TLS settings from both strings; only the original warns.
  // pg warns once per process, so the converted string is parsed first.
  const after = parse(converted);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warnings.filter((message) => message.includes('SSL modes')).length, 0, 'verify-full does not warn');
  const before = parse(neon);
  assert.deepEqual(after.ssl, before.ssl);
  assert.equal(after.host, before.host);
  assert.equal(after.database, before.database);
  assert.equal(after.user, before.user);
  assert.equal(after.password, before.password);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warnings.filter((message) => message.includes('SSL modes')).length, 1, 'only the original sslmode=require warns');

  console.log('database-url: verify-full named explicitly, same pg TLS settings, no warning');
})().catch((error) => { console.error(error); process.exitCode = 1; });
