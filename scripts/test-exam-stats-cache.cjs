// «سجل الامتحانات»: per-exam numbers are cached by exam id and requested only
// for exams on screen. A filter change reuses the cache, a data change refreshes
// what is on screen while keeping the old numbers shown, an answer from before a
// data change never counts as fresh, and deleting waits for a fresh count.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = process.cwd(), resolve = Module._resolveFilename;
Module._resolveFilename = function (r, p, ...a) { return resolve.call(this, r.startsWith('@/') ? path.join(root, 'src', r.slice(2)) : r, p, ...a); };
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { ExamStatsCache, chunkIds } = require('../src/lib/exam-stats-cache.ts');

const stat = (total) => ({ total, passCount: 0, notPassedCount: 0, protectedCount: 0 });

{
  const cache = new ExamStatsCache();
  const first = cache.take(['a', 'b', 'a', '']);
  assert.deepEqual(first.ids, ['a', 'b'], 'each exam on screen is asked once');
  assert.deepEqual(cache.take(['a', 'b']).ids, [], 'an exam already in flight is not asked again');
  assert.equal(cache.state('a'), 'loading');
  cache.resolve(first.ids, first.generation, { a: stat(3), b: stat(0) });
  assert.equal(cache.state('a'), 'fresh');
  assert.equal(cache.value('a').total, 3);
  assert.deepEqual(cache.take(['b', 'a', 'c']).ids, ['c'], 'a search or filter change asks only for exams not loaded yet');
  console.log('PASS: exams on screen are asked once, and filters reuse what is loaded');
}

{
  const cache = new ExamStatsCache();
  const first = cache.take(['a', 'b']);
  cache.resolve(first.ids, first.generation, { a: stat(3), b: stat(5) });
  cache.invalidate();
  assert.equal(cache.state('a'), 'stale');
  assert.equal(cache.value('a').total, 3, 'a data change keeps the old number shown until the new one arrives');
  const refresh = cache.take(['a']);
  assert.deepEqual(refresh.ids, ['a'], 'only the exams on screen refresh at once');
  cache.resolve(refresh.ids, refresh.generation, { a: stat(4) });
  assert.equal(cache.state('a'), 'fresh');
  assert.equal(cache.value('a').total, 4);
  assert.equal(cache.state('b'), 'stale', 'an exam off screen stays stale');
  assert.deepEqual(cache.take(['b']).ids, ['b'], 'and refreshes when it is scrolled to');
  console.log('PASS: a data change refreshes the exams on screen now and the rest when scrolled to');
}

{
  const cache = new ExamStatsCache();
  const old = cache.take(['a']);
  cache.invalidate();
  const again = cache.take(['a']);
  assert.deepEqual(again.ids, ['a'], 'a request from before a data change does not block the new one');
  cache.resolve(old.ids, old.generation, { a: stat(1) });
  assert.equal(cache.state('a'), 'stale', 'an answer from before a data change is never fresh');
  cache.resolve(again.ids, again.generation, { a: stat(2) });
  assert.equal(cache.state('a'), 'fresh');
  assert.equal(cache.value('a').total, 2);

  const late = new ExamStatsCache();
  const before = late.take(['x']);
  late.invalidate();
  late.resolve(before.ids, before.generation, {});
  assert.equal(late.state('x'), 'loading', 'an old answer without the exam does not hide it');
  assert.deepEqual(late.take(['x']).ids, ['x']);
  console.log('PASS: answers from before a data change never count as up to date');
}

{
  const cache = new ExamStatsCache();
  const first = cache.take(['a', 'b']);
  cache.resolve(first.ids, first.generation, { a: stat(2) });
  assert.equal(cache.state('b'), 'missing', 'an exam the server has no numbers for shows «—»');
  const failed = cache.take(['c']);
  cache.resolve(failed.ids, failed.generation, null);
  assert.equal(cache.state('c'), 'missing', 'a failed request shows «—»');
  assert.deepEqual(cache.take(['b', 'c']).ids, [], 'and is not retried in a loop');
  cache.invalidate();
  const retry = cache.take(['a', 'b', 'c']);
  assert.deepEqual(retry.ids, ['a', 'b', 'c'], 'the next data change asks again');
  cache.resolve(retry.ids, retry.generation, null);
  assert.equal(cache.value('a').total, 2, 'a failed refresh keeps the shown number');
  assert.equal(cache.state('a'), 'stale', 'but it is not up to date');
  assert.deepEqual(cache.take(['a']).ids, [], 'and is not retried in a loop either');
  console.log('PASS: missing and failed numbers show «—», keep shown numbers, and are not retried in a loop');
}

assert.deepEqual(chunkIds(['1', '2', '3', '4', '5'], 2), [['1', '2'], ['3', '4'], ['5']]);
assert.deepEqual(chunkIds([], 24), []);
console.log('PASS: requests go in batches');

const view = fs.readFileSync(path.join(root, 'src/components/teacher-pro/exam-records.tsx'), 'utf8');
assert.ok(!view.includes('examStatsApi\n      .get(examIds'), 'the view must not request the numbers of every filtered exam');
assert.ok(view.includes('new IntersectionObserver(') && view.includes('data-exam-id={exam.id}') && view.includes('ref={examListRef}'), 'cards and rows report when they are on screen');
assert.ok(view.includes('chunkIds(ids, EXAM_STATS_BATCH_SIZE)'), 'the view requests in batches');
assert.ok(view.includes('examStatsCache.invalidate()') && view.includes('statsSyncKeyRef.current === syncKey'), 'a data change invalidates the cache');
assert.ok(view.includes('examStatsView.cache.state(deleteDialog.id) === "fresh"'), 'deleting waits for an up-to-date count');
assert.ok(view.includes('dialogExamIdsRef.current = [deleteDialog.open ? deleteDialog.id : "", disableExamId || ""]'), 'the dialogs get their count even off screen');
console.log('PASS: «سجل الامتحانات» requests numbers for exams on screen only, in batches');
