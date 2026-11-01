// A duplicate row in «إضافة طلاب جماعية» shows how alike it is to the existing
// student, and «تحويل يدوي…» opens that student's «تعديل الطالب» with the
// row's course filled in.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const compile = (file, requireFn) => {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("module", "exports", "require", output)(module, module.exports, requireFn);
  return module.exports;
};
const format = compile("src/lib/format.ts", () => ({}));
const utils = compile("src/lib/student-utils.ts", (name) => (name === "./format" || name === "@/lib/format" ? format : {}));
const match = compile("src/lib/bulk-duplicate-match.ts", (name) => {
  assert.equal(name, "@/lib/student-utils");
  return utils;
});

// The case from the request: the same student, a new course.
const existing = {
  id: "s1", code: "BIO-1473", name: "زهراء عمار علي جارالله", status: "نشط",
  phone: "07703749556", parentPhone: "07703749556", telegram: null, username: "lxolz",
  school: "ثانوية الوحده الوطنيه للبنات", gender: "أنثى", courseId: "summer", courseName: "الدورة الصيفية",
  courseProgram: "كورسات", courseTerm: "الكورس الأول", studyType: "إلكتروني", locationScope: "بغداد", subSite: "عموم بغداد",
};
const same = match.compareBulkDuplicate({
  name: "زهراء عمار علي جارالله", phone: "7703749556", parentPhone: "7703749556",
  telegram: "lxolz", school: "ثانويه الوحدة الوطنية", gender: "أنثى",
}, existing);
const field = (key) => same.fields.find((item) => item.key === key);
assert.equal(field("name").score, 1);
assert.equal(field("phone").score, 1, "07… and 7… are the same phone");
assert.equal(field("parentPhone").score, 1);
assert.equal(field("telegram").score, 1, "the handle is compared with the username too");
assert.equal(field("school").score, 0.75, "3 of 4 school words, spelling aside");
assert.equal(field("gender").score, 1);
assert.equal(same.percent, 96);

// Another student who only shares the phone.
const other = match.compareBulkDuplicate({
  name: "علي حسين كاظم", phone: "7703749556", parentPhone: "", telegram: "", school: "", gender: "ذكر",
}, existing);
assert.equal(other.fields.find((item) => item.key === "name").score, 0);
assert.equal(other.fields.find((item) => item.key === "parentPhone").score, null, "an empty side is not compared");
assert.equal(other.percent, 33);

// The kind of transfer, with the server's rules for «تعديل الطالب».
const course = { courseId: "winter3", courseProgram: "منهج كامل", courseTerm: "", studyType: "مدمج", locationScope: "بغداد", baghdadMode: "عموم بغداد", subSite: "عموم بغداد" };
const here = { ...existing, baghdadMode: "عموم بغداد" };
assert.equal(match.bulkTransferKind(here, course), "course", "another course: a new file only");
const sameCourse = { ...course, courseId: "summer", courseProgram: "كورسات", courseTerm: "الكورس الأول", studyType: "إلكتروني" };
assert.equal(match.bulkTransferKind(here, sameCourse), "none", "nothing to move");
assert.equal(match.bulkTransferKind(here, { ...sameCourse, studyType: "مدمج" }), "context", "same course, other study data: keep or new");

// Wiring.
const route = fs.readFileSync(path.join(root, "src/app/api/students/bulk/route.ts"), "utf8");
assert(route.includes('const showMatches = previewOnly && hasPermission(principal, "students.view");'), "matches only in the preview, for those who may view students");
assert(route.includes("...(showMatches && duplicateMessage ? { matches: matchesFor(row) } : {}),"));
const bulk = fs.readFileSync(path.join(root, "src/components/teacher-pro/student-bulk-text-import.tsx"), "utf8");
assert(bulk.includes("compareBulkDuplicate(") && bulk.includes("<BulkDuplicateTransferDialog") && !bulk.includes('target="_blank"'), "the transfer happens on this page");
assert(bulk.includes("{canEditStudents ? ("), "the transfer is for those who may edit students");
assert(bulk.includes("void buildPreview(nextText);"), "a row done with leaves the text and the preview runs again");
const dialog = fs.readFileSync(path.join(root, "src/components/teacher-pro/bulk-duplicate-transfer-dialog.tsx"), "utf8");
assert(dialog.includes('const chosenPolicy: CourseTransferPolicy | "" = kind === "course" ? "reset" : policy;'), "another course is always a new file");
assert(dialog.includes("studentApi.editSnapshot(target.match.id)") && dialog.includes("expectedMutationToken: current.mutationToken"), "the save carries the latest record's token");
assert(dialog.includes("studentApi.update(current.id"), "the same request as «تعديل الطالب»");
assert(/onRemoveRow\(target\.rowNumber\);\s*setPolicy\(""\);\s*onClose\(\);/.test(dialog), "the row leaves only after a successful save");
const registry = fs.readFileSync(path.join(root, "src/components/teacher-pro/student-registry.tsx"), "utf8");
assert(!registry.includes("readBulkTransferIntent"), "no link into «سجل الطلاب» anymore");

console.log("PASS: a duplicate row shows its match field by field with a percentage, and «تحويل يدوي…» moves the student here with the edit's rules, then drops the row");
