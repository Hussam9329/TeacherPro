// Finding a Mirmaz student by name behaves exactly like «أداة مرماز» (section
// 20, «اغلاق الكودات»): the spellings it treats as one, the one-letter
// tolerance, and its «مطابق» / «محتمل» verdicts.
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeArabicName, compareNames, wordsMatch, findStudentsByName } from "../src/lib/mirmaz-name-match.ts";

test("spellings the platform tells apart are one name", () => {
  assert.equal(normalizeArabicName("رقية"), normalizeArabicName("رقيه"));
  assert.equal(normalizeArabicName("أحمد"), normalizeArabicName("احمد"));
  assert.equal(normalizeArabicName("إسراء"), normalizeArabicName("اسرا"));
  assert.equal(normalizeArabicName("مصطفى"), normalizeArabicName("مصطفي"));
  assert.equal(normalizeArabicName("عبد الله"), normalizeArabicName("عبدالله"));
  assert.equal(normalizeArabicName("لؤي"), normalizeArabicName("لوي"));
  assert.equal(normalizeArabicName("مُحَمَّد"), normalizeArabicName("محمد"));
  assert.equal(normalizeArabicName("آيه  فلاح-عبدالله"), "ايه فلاح عبدالله");
});

test("words: «ال» at the start, and one letter in a long word", () => {
  assert.ok(wordsMatch("الحسن", "حسن"));
  assert.ok(wordsMatch("مصطفي", "مصطفا"));       // one letter, 5 letters
  assert.ok(wordsMatch("حسين", "حسنين"));        // one letter added: the tool takes it too
  assert.ok(!wordsMatch("علي", "علا"));          // three letters: no tolerance
  assert.ok(!wordsMatch("كاظم", "كاظمين"));      // two letters apart
});

test("verdicts as the tool gives them", () => {
  assert.deepEqual(compareNames("آيه فلاح عبدالله", "ايه فلاح عبد الله"), { matched: 3, of: 3, full: true, likely: true });
  // Mirmaz keeps three names, TeacherPro four: the shared three all match.
  assert.equal(compareNames("رقية علي حسين", "رقيه علي حسين جاسم").full, true);
  // The grandfather differs: likely, never full.
  const near = compareNames("محمد علي حسين", "محمد علي حسن");
  assert.equal(near.full, false);
  assert.equal(near.likely, true);
  // A different first name with only one more word in common: not even likely.
  assert.equal(compareNames("زهراء علي حسين", "فاطمة علي كاظم").likely, false);
});

test("candidates are listed closest first, unrelated names left out", () => {
  const students = [
    { id: "a", name: "محمد علي حسن" },
    { id: "b", name: "محمد علي حسين" },
    { id: "c", name: "سجاد كريم" },
  ];
  const found = findStudentsByName("محمد علي حسين", students);
  assert.deepEqual(found.map((s) => s.id), ["b", "a"]);
  assert.equal(found[0].nameMatch.full, true);
  assert.equal(found[1].nameMatch.full, false);
});
