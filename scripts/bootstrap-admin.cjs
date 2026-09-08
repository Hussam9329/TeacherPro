const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(r,p,...args) { return resolve.call(this,r.startsWith('@/') ? path.join(process.cwd(),'src',r.slice(2)) : r,p,...args); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const { db } = require('../src/lib/db.ts');
(async () => {
 if (await db.appUser.count()) { console.log('Existing accounts preserved; bootstrap skipped.'); return; }
 await require('../src/lib/admin-seed.ts').ensureInitialAdminSeed();
 console.log('Initial administrator created from deployment configuration.');
})().catch(() => { console.error('Administrator bootstrap failed; check configuration.'); process.exitCode=1; }).finally(() => db.$disconnect());
