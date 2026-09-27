const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const test = require('node:test');

require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { gradeRecordResultPresentation: result } = require('../src/lib/grade-records-presentation.ts');
const exam = { fullMark: 100, passMark: 50, discountMark: 25, type: 'تراكمي' };

test('academic failure has the same result whether penalty is enabled or disabled', () => {
  const grade = { status: 'درجة', score: 20 };
  const first = result(grade, exam);
  assert.deepEqual(first, result(grade, { ...exam, noDiscount: true }));
  assert.equal(first.label, 'راسب');
  assert.equal(first.tone, 'fail-light');
  assert.equal(first.scoreText, '20/100');
  assert.doesNotMatch(first.label, /خصم|فصل/);
});

test('final zero is a failed academic result, not an invented recorded dismissal', () => {
  const actual = result({ status: 'درجة', score: 0 }, { ...exam, type: 'فاينل', dismissalGrade: 20 });
  assert.equal(actual.scoreText, '0/100');
  assert.equal(actual.label, 'راسب');
  assert.equal(actual.tone, 'fail-light');
});

test('pending status stays pending even when a legacy numeric score is present', () => {
  for (const score of [null, 0, 80]) {
    assert.deepEqual(result({ status: 'درجة معلّقة', score }, exam), {
      scoreText: 'درجة معلّقة', label: '', tone: 'neutral', numeric: false,
    });
  }
});

test('missing numeric score is not coerced to a failing zero', () => {
  for (const score of [null, undefined, '', ' ']) {
    const actual = result({ status: 'درجة', score }, exam);
    assert.equal(actual.scoreText, 'بانتظار الدرجة');
    assert.equal(actual.numeric, false);
    assert.equal(actual.tone, 'neutral');
  }
});

test('numeric grade retains the actual result when its accounting effect is excluded', () => {
  const protectedGrade = { status: 'درجة', score: 80, academicEffectExcluded: true, effectiveImpactExcluded: true };
  assert.equal(result(protectedGrade, exam).label, 'ناجح');
  assert.equal(result({ ...protectedGrade, score: 15 }, exam).label, 'راسب');
});

test('excused and absence statuses never fall through to a numeric zero', () => {
  assert.equal(result({ status: 'مجاز', score: null }, exam).scoreText, 'مجاز');
  assert.equal(result({ status: 'مجاز', score: null }, exam).tone, 'excused');
  assert.equal(result({ status: 'غائب', score: null }, exam).scoreText, 'غائب');
  assert.equal(result({ status: 'غش', score: null }, exam).scoreText, 'غش');
});

test('registration and retired grace markers remain separate from a result', () => {
  assert.equal(result({ status: 'قبل تسجيل الطالب', score: null }, exam).scoreText, 'قبل التسجيل');
  assert.equal(result({ status: 'ضمن فترة السماح', score: null }, exam).scoreText, 'لا توجد نتيجة مسجّلة');
});

test('pass threshold boundary uses the actual academic score', () => {
  assert.equal(result({ status: 'درجة', score: 50 }, exam).label, 'ناجح');
  assert.equal(result({ status: 'درجة', score: 49 }, exam).label, 'راسب');
  assert.equal(result({ status: 'درجة', score: 20 }, { fullMark: 50 }).label, 'درجة مسجّلة');
});
