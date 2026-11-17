const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { withChunkRecovery } = require('../src/lib/chunk-recovery.ts');

const KEY = 'teacherpro:section-chunk-reload-at';
const FALLBACK = Symbol('fallback');
const failing = () => Promise.reject(new Error('chunk failed'));
const settled = async (promise) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('pending'), 20))]);

function makeTab(initial = {}, { brokenStorage = false } = {}) {
  const store = { ...initial };
  const tab = {
    reloads: 0,
    store,
    sessionStorage: {
      getItem: (key) => { if (brokenStorage) throw new Error('blocked'); return key in store ? store[key] : null; },
      setItem: (key, value) => { if (brokenStorage) throw new Error('blocked'); store[key] = value; },
    },
    location: { reload: () => { tab.reloads += 1; } },
  };
  return tab;
}

(async () => {
  let tab = makeTab();
  assert.equal(await withChunkRecovery(async () => 'page', FALLBACK, () => tab)(), 'page');
  assert.equal(tab.reloads, 0);
  assert.equal(KEY in tab.store, false);
  console.log('PASS: a chunk that downloads is passed through untouched');

  tab = makeTab();
  assert.equal(await settled(withChunkRecovery(failing, FALLBACK, () => tab)()), 'pending');
  assert.equal(tab.reloads, 1);
  assert.ok(Number(tab.store[KEY]) > 0);
  console.log('PASS: the first failure reloads the tab once and keeps the loading state up');

  assert.equal(await withChunkRecovery(failing, FALLBACK, () => tab)(), FALLBACK);
  assert.equal(tab.reloads, 1);
  console.log('PASS: a failure right after that reload shows the fallback, not another reload');

  tab = makeTab({ [KEY]: String(Date.now() - 61_000) });
  assert.equal(await settled(withChunkRecovery(failing, FALLBACK, () => tab)()), 'pending');
  assert.equal(tab.reloads, 1);
  console.log('PASS: a failure long after the last reload may reload again');

  tab = makeTab({}, { brokenStorage: true });
  assert.equal(await withChunkRecovery(failing, FALLBACK, () => tab)(), FALLBACK);
  assert.equal(tab.reloads, 0);
  console.log('PASS: without session storage there is no reload that could loop');

  const layout = fs.readFileSync(path.join(__dirname, '../src/components/teacher-pro/layout.tsx'), 'utf8');
  const pages = [...layout.matchAll(/=\s*dynamic(?:<[\s\S]*?>)?\(\s*([^,]+),/g)].map((match) => match[1].trim());
  assert.equal(pages.length, 15);
  for (const loader of pages) assert.match(loader, /^recoverable\(sectionLoaders/);
  console.log('PASS: every page of the layout is loaded through the recovery');
})().catch((error) => { console.error(error); process.exitCode = 1; });
