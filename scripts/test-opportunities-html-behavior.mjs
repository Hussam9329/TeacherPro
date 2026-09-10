#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const ts = require("typescript");

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const exportDialogPath = path.join(
  projectRoot,
  "src/components/teacher-pro/export-dialog.tsx",
);

function inertComponent() {
  return null;
}

const inertNamespace = new Proxy(inertComponent, {
  get(_target, property) {
    if (property === "__esModule") return true;
    if (property === "default") return inertNamespace;
    return inertComponent;
  },
});

// تحميل مصدر TypeScript الفعلي للمكتبات المشتركة (نفس آلية
// test-active-chapter-report-integrity.mjs) بدل تنصيبها ككعب صامت.
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(output.outputText, filename);
};

function loadExportDialogModule() {
  const source = fs.readFileSync(exportDialogPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    fileName: exportDialogPath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });

  const syntaxErrors = (transpiled.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(
    syntaxErrors.length,
    0,
    syntaxErrors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("\n"),
  );

  const originalLoad = Module._load;
  Module._load = function loadWithSafeStubs(request, parent, isMain) {
    if (request === "@/lib/teacherpro-language") {
      return {
        humanizeTeacherProText(value) {
          return String(value ?? "");
        },
      };
    }
    // المكتبة المشتركة تُحمَّل حقيقية: فلترة سجل الفرص على الفصل النشط
    // سلوك منطق عمل يجب فحصه، لا كعب صامت يرجع true دائماً.
    if (request === "@/lib/student-report-presentation") return require(path.join(projectRoot, "src/lib/student-report-presentation.ts"));
    if (request === "@/lib/active-chapter-report") {
      return require(
        path.join(projectRoot, "src/lib/active-chapter-report.ts"),
      );
    }
    if (request === "react/jsx-runtime") {
      return {
        Fragment: Symbol("Fragment"),
        jsx: inertComponent,
        jsxs: inertComponent,
      };
    }
    if (request === "react" || request === "lucide-react" || request.startsWith("@/")) {
      return inertNamespace;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const loadedModule = new Module(exportDialogPath);
    loadedModule.filename = exportDialogPath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(exportDialogPath));
    loadedModule._compile(transpiled.outputText, exportDialogPath);
    assert.equal(
      typeof loadedModule.exports.buildHtml,
      "function",
      "export-dialog.tsx must export buildHtml",
    );
    return loadedModule.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function createClassList() {
  const values = new Set();
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    contains(name) {
      return values.has(name);
    },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
  };
}

function createDomElement(id) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    id,
    value: "",
    innerHTML: "",
    textContent: "",
    style: {},
    classList: createClassList(),
    offsetParent: {},
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
    contains() {
      return false;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    focus() {},
    querySelector() { return null; },
    querySelectorAll() {
      return [];
    },
    scrollIntoView() {},
  };
}

function createDomHarness() {
  const ids = [
    "tpStudentSearch",
    "tpSuggestions",
    "tpSearchHint",
    "tpStudentCard",
    "tpStudentOverview",
    "tpDetailsModal",
    "tpModalTitleText",
    "tpModalDismissedBadge",
    "tpGradesSectionTitle",
    "tpGradesBody",
    "tpModalClose",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, createDomElement(id)]));
  const documentListeners = new Map();
  const document = {
    body: { style: {} },
    activeElement: null,
    getElementById(id) {
      return elements[id] || null;
    },
    addEventListener(type, listener) {
      const registered = documentListeners.get(type) || [];
      registered.push(listener);
      documentListeners.set(type, registered);
    },
  };

  return {
    document,
    elements,
    dispatchDocument(type, event = {}) {
      for (const listener of documentListeners.get(type) || []) listener(event);
    },
  };
}

function extractInlineScripts(html) {
  const openingCount = (html.match(/<script\b[^>]*>/gi) || []).length;
  const closingCount = (html.match(/<\/script>/gi) || []).length;
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (match) => match[1],
  );

  assert.equal(openingCount, closingCount, "generated HTML has unbalanced script tags");
  assert.equal(
    scripts.length,
    openingCount,
    "every generated script element must have one intact body",
  );
  return scripts;
}

function compileInlineScripts(html, label) {
  const scripts = extractInlineScripts(html);
  assert.ok(scripts.length > 0, `${label} should contain its interactive scripts`);
  return scripts.map(
    (script, index) =>
      new vm.Script(script, {
        filename: `${label.replace(/\s+/g, "-")}-inline-${index + 1}.js`,
      }),
  );
}

function executeInlineScripts(html, label) {
  const dom = createDomHarness();
  const historyCalls = [];
  const sandbox = {
    console,
    document: dom.document,
    history: {
      replaceState(...args) {
        historyCalls.push(args);
      },
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const scripts = compileInlineScripts(html, label);
  scripts.forEach((script) => script.runInContext(context));
  return { dom, sandbox, historyCalls };
}

function clickFirstSuggestion(dom) {
  const suggestion = {
    getAttribute(name) {
      return name === "data-idx" ? "0" : null;
    },
  };
  dom.elements.tpSuggestions.dispatch("click", {
    target: {
      closest(selector) {
        return selector === ".tp-suggestion" ? suggestion : null;
      },
    },
  });
}

function openStudentDetails(dom, studentId, studentName) {
  const labelClone = {
    textContent: studentName,
    querySelector() {
      return null;
    },
  };
  const firstCell = {
    querySelector() {
      return null;
    },
    cloneNode() {
      return labelClone;
    },
  };
  const row = {
    querySelector() {
      return firstCell;
    },
  };
  const button = {
    getAttribute(name) {
      return name === "data-sid" ? studentId : null;
    },
    closest(selector) {
      return selector === "tr" ? row : null;
    },
  };
  const target = {
    closest(selector) {
      return selector === ".tp-details-btn" ? button : null;
    },
  };
  dom.dispatchDocument("click", { target });
}

function labelsFromRenderedCells(html) {
  return [...html.matchAll(/data-label="([^"]+)"/g)].map((match) => match[1]);
}

function assertNormalTableFallback(html, label) {
  assert.match(
    html,
    /<meta name="viewport" content="width=device-width, initial-scale=1">/,
  );
  assert.match(html, /<body class="">/);
  assert.match(html, /<main class="report">/);
  assert.match(html, /<div class="table-wrap"><table>/);
  assert.match(html, /<td>طالب اعتيادي<\/td>/);
  assert.doesNotMatch(html, /id="tpStudentSearch"/);
  assert.doesNotMatch(html, /window\.STUDENT_LIST\s*=/);
  assert.doesNotMatch(html, /report-search-mode/);
  assert.equal(
    (html.match(/<tbody>/g) || []).length,
    1,
    `${label} must render only the normal report table`,
  );
}

const {
  buildHtml,
  buildStudentDetailsFromProfileLog,
  sanitizeStudentDetailsForHtml,
  getHtmlReportExams,
  selectHtmlReportExams,
} = loadExportDialogModule();

const rows = [{ id: "s1", name: "طالب اعتيادي" }];
const columns = [
  {
    key: "name",
    label: "الطالب",
    value(row) {
      return row.name;
    },
  },
];
const studentList = [
  {
    id: "s1",
    name: "محمد علي حسن",
    courseName: "الدورة الشتوية",
    opportunities: 2,
    status: "نشط",
  },
];
const studentDetails = {
  s1: {
    activeChapterName: "الفصل الأول",
    grades: [
      {
        examName: "الامتحان اليومي الأول",
        examType: "يومي",
        examDate: "2026-08-31T09:00:00.000Z",
        score: 88,
        fullMark: 100,
        status: "درجة",
      },
    ],
    opportunityLogs: [
      {
        action: "خصم",
        amount: 4,
        reason: "غياب مسجل",
        date: "2026-08-31T09:00:00.000Z",
        examName: "الامتحان اليومي الأول",
      },
      {
        action: "إضافة",
        amount: 7,
        reason: "تصحيح حركة يدوية",
        date: "2026-09-01T09:00:00.000Z",
        examName: null,
      },
    ],
  },
};

const validHtml = buildHtml(rows, columns, "تقرير إدارة الفرص", {
  studentList,
  studentDetails,
});

let failures = 0;
function check(label, assertion) {
  try {
    assertion();
    console.log(`✅ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`❌ ${label}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

check("وضع البحث يولد البنية التفاعلية ولا يخفي التقرير في تركيبة ناقصة", () => {
  assert.match(
    validHtml,
    /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/,
  );
  assert.match(validHtml, /<body class="tp-search-report-body">/);
  assert.match(validHtml, /<main class="report report-search-mode">/);
  assert.match(validHtml, /id="tpStudentSearch"/);
  assert.match(validHtml, /id="tpStudentCard"/);
  assert.match(
    validHtml,
    /id="tpDetailsModal"[^>]*role="dialog"[^>]*aria-modal="true"/,
  );
  assert.doesNotMatch(validHtml, /<div class="table-wrap"><table>/);
});

check("كل JavaScript المضمّن في التقرير التفاعلي صالح للترجمة", () => {
  compileInlineScripts(validHtml, "opportunities-search-report");
});

check("بطاقة الطالب وجداول التفاصيل تعرض data-label لكل قيمة على الهاتف", () => {
  const { dom } = executeInlineScripts(validHtml, "opportunities-interaction");
  dom.elements.tpStudentSearch.value = "محمد علي";
  dom.elements.tpStudentSearch.dispatch("input", {});
  clickFirstSuggestion(dom);

  const studentCardHtml = dom.elements.tpStudentCard.innerHTML;
  assert.deepEqual(labelsFromRenderedCells(studentCardHtml), [
    "الطالب",
    "الدورة",
    "عدد الفرص",
    "تفاصيل الطالب",
  ]);

  openStudentDetails(dom, "s1", "محمد علي حسن");
  assert.deepEqual(labelsFromRenderedCells(dom.elements.tpGradesBody.innerHTML), [
    "الامتحان",
    "تاريخ الامتحان",
    "الدرجة",
    "الأثر على الفرص",
  ]);
  assert.ok(dom.elements.tpDetailsModal.classList.contains("open"));
});

check("التقرير المختصر يبقي كارت الفرص ويحذف السجل والنصوص الزائدة", () => {
  const { dom } = executeInlineScripts(validHtml, "opportunities-summary");
  openStudentDetails(dom, "s1", "محمد علي حسن");
  assert.doesNotMatch(validHtml, /tpLogsSection|tpLogsBody|كيف تغيّرت فرصك؟|ماذا حدث؟/);
  assert.doesNotMatch(validHtml, /الفصل الحالي|بداية حساب فرص هذا الفصل|حالتك:|تاريخ تسجيلك في النظام|بياناتك حتى:|هذا التقرير يعرض بياناتك وقت إعداده/);
  const overview = dom.elements.tpStudentOverview.innerHTML;
  assert.equal((overview.match(/class="tp-summary-item"/g) || []).length, 1);
  assert.match(overview, /فرصك المتبقية/);
  assert.match(overview, /<strong>2<\/strong>/);
  assert.equal(dom.elements.tpGradesSectionTitle.textContent, "درجاتك — الفصل الأول");
});

check("سجل الفرص مقيد بالفصل النشط: خصومات الفصل السابق مخفية والتسوية ظاهرة", () => {
  const profile = {
    currentChapter: {
      id: "ch2",
      name: "الفصل الثاني - الانسجة",
      since: "2026-08-14T17:39:56.561Z",
      examIds: ["exam-ch2-1", "exam-ch2-2"],
    },
    exams: [
      { id: "exam-ch1-old", name: "الامتحان 13 - دورة صيفية", type: "تراكمي", date: "2026-07-18T00:00:00.000Z", fullMark: 40 },
      { id: "exam-ch2-1", name: "الفصل الثاني - الامتحان الاول (ص1)", type: "يومي", date: "2026-08-13T00:00:00.000Z", fullMark: 40 },
      { id: "exam-ch2-2", name: "الفصل الثاني - الامتحان الثاني (ص1)", type: "تراكمي", date: "2026-08-15T00:00:00.000Z", fullMark: 40 },
    ],
    grades: [
      { examId: "exam-ch2-1", status: "درجة", score: 10 },
      { examId: "exam-ch1-old", status: "درجة", score: 12 },
    ],
    opportunityLogs: [
      // خصم على امتحان الفصل السابق (تموز) — يجب إخفاؤه.
      { action: "خصم تلقائي", amount: 1, examId: "exam-ch1-old", date: "2026-07-19T00:00:00.000Z", reason: "تلقائي: درجة 12 ضمن الخصم في امتحان: الامتحان 13 - دورة صيفية" },
      // خصم على امتحان الفصل النشط — يظهر.
      { action: "خصم تلقائي", amount: 1, examId: "exam-ch2-1", date: "2026-08-14T18:00:00.000Z", reason: "تلقائي: درجة 10 ضمن الخصم في امتحان: الفصل الثاني - الامتحان الاول (ص1)" },
      // تسوية الانتقال (بلا امتحان، بيوم الانتقال نفسه) — تظهر.
      { action: "إعادة تعيين", amount: 3, examId: null, date: "2026-08-14T17:39:56.561Z", reason: "تسوية تاريخية: تحويل فصل يدوي؛ تجاهل آثار امتحانات الفصل السابق وبدء رصيد جديد من الفصل النشط الجديد" },
      // حركة يدوية قبل الانتقال (بلا امتحان) — تُخفى.
      { action: "إضافة", amount: 1, examId: null, date: "2026-07-01T09:00:00.000Z", reason: "تعديل يدوي قديم" },
      // حركة يدوية بعد الانتقال (بلا امتحان) — تظهر.
      { action: "إضافة", amount: 1, examId: null, date: "2026-08-20T09:00:00.000Z", reason: "تعديل يدوي حديث" },
      // حركة أعادها المحرك لاحقاً على امتحان قديم — تُخفى مهما كان تاريخها.
      { action: "خصم تلقائي", amount: 1, examId: "exam-ch1-old", date: "2026-08-25T00:00:00.000Z", reason: "تلقائي: درجة 12 ضمن الخصم في امتحان: الامتحان 13 - دورة صيفية" },
    ],
  };

  const details = buildStudentDetailsFromProfileLog(profile);
  const reasons = details.opportunityLogs.map((log) => log.reason);
  assert.equal(details.opportunityLogs.length, 3);
  assert.ok(reasons.some((reason) => reason.includes("تسوية تاريخية")), "التسوية ظاهرة");
  assert.ok(reasons.some((reason) => reason.includes("الامتحان الاول (ص1)")), "خصم امتحان الفصل النشط ظاهر");
  assert.ok(reasons.some((reason) => reason === "تعديل يدوي حديث"), "الحركة اليدوية بعد الانتقال ظاهرة");
  assert.ok(!reasons.some((reason) => reason.includes("دورة صيفية")), "خصومات امتحانات الفصل السابق (تموز) مخفية");
  assert.ok(!reasons.some((reason) => reason === "تعديل يدوي قديم"), "الحركات اليدوية قبل الانتقال مخفية");
  assert.equal(details.activeChapterName, "الفصل الثاني - الانسجة");

  // الدرجات تبقى مفلترة على امتحانات الفصل النشط فقط.
  assert.deepEqual(
    details.grades.map((grade) => grade.examName),
    ["الفصل الثاني - الامتحان الاول (ص1)"],
  );

  // التنظيف لم يعد يحذف صفوف التسوية — هي الخط الفاصل الذي يفسر الرصيد.
  const sanitized = sanitizeStudentDetailsForHtml({ s1: details });
  const sanitizedReasons = sanitized.s1.opportunityLogs.map((log) => log.reason);
  assert.equal(sanitized.s1.opportunityLogs.length, 3);
  assert.ok(sanitizedReasons.some((reason) => reason.includes("بدأ حساب فرص هذا الفصل")), "بداية رصيد الفصل تبقى بصياغة واضحة");
});

check("غياب سياق الفصل النشط يبقي سجل الفرص كاملاً (السلوك القديم)", () => {
  const profile = {
    currentChapter: null,
    exams: [{ id: "exam-any", name: "امتحان قديم", type: "يومي", date: "2026-07-01T00:00:00.000Z", fullMark: 40 }],
    grades: [],
    opportunityLogs: [
      { action: "خصم تلقائي", amount: 1, examId: "exam-any", date: "2026-07-02T00:00:00.000Z", reason: "خصم قديم" },
      { action: "إعادة تعيين", amount: 3, examId: null, date: "2026-06-01T00:00:00.000Z", reason: "تسوية تاريخية قديمة" },
    ],
  };
  const details = buildStudentDetailsFromProfileLog(profile);
  assert.equal(details.opportunityLogs.length, 2);
});

check("فصل نشط بلا انتقال بعد (since=null): حركات الدورة كلها من الفصل النشط", () => {
  const profile = {
    currentChapter: { id: "ch1", name: "الفصل الأول", since: null, examIds: ["exam-a"] },
    exams: [
      { id: "exam-a", name: "امتحان آ", type: "يومي", date: "2026-06-16T00:00:00.000Z", fullMark: 40 },
      { id: "exam-old-other", name: "امتحان دورة أخرى", type: "يومي", date: "2026-06-10T00:00:00.000Z", fullMark: 40 },
    ],
    grades: [],
    opportunityLogs: [
      { action: "خصم تلقائي", amount: 1, examId: "exam-a", date: "2026-06-17T00:00:00.000Z", reason: "خصم آ" },
      { action: "إضافة", amount: 2, examId: null, date: "2026-06-01T00:00:00.000Z", reason: "رصيد بداية الدورة" },
      { action: "خصم تلقائي", amount: 1, examId: "exam-old-other", date: "2026-06-11T00:00:00.000Z", reason: "خصم خارج الدورة" },
    ],
  };
  const details = buildStudentDetailsFromProfileLog(profile);
  const reasons = details.opportunityLogs.map((log) => log.reason);
  assert.ok(reasons.includes("خصم آ"));
  assert.ok(reasons.includes("رصيد بداية الدورة"), "بلا انتقال: الحركات غير المرتبطة بامتحان كلها ظاهرة");
  assert.ok(!reasons.includes("خصم خارج الدورة"), "امتحان خارج قائمة امتحانات الفصل النشط يبقى مخفياً");
});

check("بيانات الطلاب لا تستطيع كسر عنصر script وتبقى قيمتها الأصلية بعد التنفيذ", () => {
  const breakoutPayload =
    "</script><script>globalThis.__teacherProBreakout = true</script>";
  const maliciousHtml = buildHtml(rows, columns, "تقرير إدارة الفرص", {
    printable: true,
    documentTitle: breakoutPayload,
    safeUrlName: `'${breakoutPayload}`,
    studentList: [
      {
        ...studentList[0],
        name: breakoutPayload,
      },
    ],
    studentDetails: {
      s1: {
        ...studentDetails.s1,
        opportunityLogs: [
          {
            ...studentDetails.s1.opportunityLogs[0],
            reason: breakoutPayload,
          },
        ],
      },
    },
  });

  assert.ok(!maliciousHtml.includes(breakoutPayload), "raw script-closing payload leaked");
  assert.doesNotMatch(
    maliciousHtml,
    /<script>\s*globalThis\.__teacherProBreakout\s*=/,
  );
  const { sandbox, historyCalls } = executeInlineScripts(
    maliciousHtml,
    "opportunities-breakout",
  );
  assert.equal(sandbox.__teacherProBreakout, undefined);
  assert.equal(sandbox.document.title, breakoutPayload);
  assert.equal(
    historyCalls[0][2],
    `/${encodeURIComponent(`'${breakoutPayload}`)}.pdf`,
  );
  assert.equal(sandbox.STUDENT_LIST[0].name, breakoutPayload);
  assert.equal(
    sandbox.STUDENT_DETAILS.s1.opportunityLogs[0].reason,
    breakoutPayload,
  );
});

check("التنقل بالأسهم يبقى ضمن أول 50 نتيجة ظاهرة فقط", () => {
  const manyStudents = Array.from({ length: 55 }, (_, index) => ({
    id: `student-${index + 1}`,
    name: `محمد علي طالب ${String(index + 1).padStart(2, "0")}`,
    courseName: "الدورة الشتوية",
    opportunities: index,
    status: "نشط",
  }));
  const manyResultsHtml = buildHtml(rows, columns, "تقرير إدارة الفرص", {
    studentList: manyStudents,
    studentDetails: { placeholder: studentDetails.s1 },
  });
  const { dom } = executeInlineScripts(manyResultsHtml, "opportunities-many-results");
  dom.elements.tpStudentSearch.value = "محمد علي";
  dom.elements.tpStudentSearch.dispatch("input", {});

  assert.equal(
    (dom.elements.tpSuggestions.innerHTML.match(/class="tp-suggestion"/g) || [])
      .length,
    50,
  );
  assert.match(dom.elements.tpSuggestions.innerHTML, /و5 طالب آخر/);

  const keyboardEvent = {
    key: "ArrowDown",
    preventDefault() {},
  };
  for (let index = 0; index < 60; index += 1) {
    dom.elements.tpStudentSearch.dispatch("keydown", keyboardEvent);
  }
  dom.elements.tpStudentSearch.dispatch("keydown", {
    key: "Enter",
    preventDefault() {},
  });

  assert.equal(dom.elements.tpStudentSearch.value, manyStudents[49].name);
});

check("البحث بلا نتائج يغلق listbox ويعلن النتيجة عبر النص الحي", () => {
  const { dom } = executeInlineScripts(validHtml, "opportunities-zero-results");
  dom.elements.tpStudentSearch.value = "اسم غيرموجود";
  dom.elements.tpStudentSearch.dispatch("input", {});

  assert.equal(dom.elements.tpStudentSearch.getAttribute("aria-expanded"), "false");
  assert.ok(!dom.elements.tpSuggestions.classList.contains("open"));
  assert.equal(dom.elements.tpSuggestions.innerHTML, "");
  assert.equal(
    dom.elements.tpSearchHint.textContent,
    "لا يوجد طلاب مطابقون لهذا البحث.",
  );
});

check("صف الخطأ الدفاعي يحتفظ بدلالات row وcell على الهاتف", () => {
  const missingDetailsHtml = buildHtml(rows, columns, "تقرير إدارة الفرص", {
    studentList,
    studentDetails: { placeholder: studentDetails.s1 },
  });
  const { dom } = executeInlineScripts(
    missingDetailsHtml,
    "opportunities-missing-details",
  );
  openStudentDetails(dom, "s1", "محمد علي حسن");

  assert.match(
    dom.elements.tpGradesBody.innerHTML,
    /<tr class="tp-empty-row tp-error-row" role="row"><td colspan="4" role="cell">/,
  );
});

check("تركيبات خيارات التفاصيل غير الصالحة تعود إلى جدول التقرير الطبيعي", () => {
  const invalidVariants = [
    {
      label: "studentList without studentDetails",
      options: { studentList },
    },
    {
      label: "studentDetails without studentList",
      options: { studentDetails },
    },
  ];

  for (const variant of invalidVariants) {
    const html = buildHtml(rows, columns, "تقرير إدارة الفرص", variant.options);
    assertNormalTableFallback(html, variant.label);
  }
});

check("الامتحان بلا درجة يظهر غياباً بلا اختراع خصم، حتى إذا ظهر الامتحان بسجل الفرص", () => {
  const exam = { id: "exam-1", name: "امتحان الفصل", date: "2026-09-01", fullMark: 20 };
  const report = buildStudentDetailsFromProfileLog({
    exams: [exam], allCourseExams: [exam], grades: [], opportunityLogs: [],
    currentChapter: { id: "ch1", name: "الفصل الأول", since: null, examIds: [exam.id] },
  });
  assert.equal(report.grades.length, 1);
  assert.equal(report.grades[0].status, "غائب");
  assert.equal(report.grades[0].outcome, "غياب");
  assert.equal(report.grades[0].opportunityEffect, "لا يوجد خصم لهذا الامتحان");
  const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: report } });
  const { dom } = executeInlineScripts(html, "missing-grade-cell");
  openStudentDetails(dom, "s1", "محمد علي حسن");
  assert.match(dom.elements.tpGradesBody.innerHTML, /data-label="الدرجة"[^]*?tp-mobile-field-value">غياب<\/span>/);
  assert.doesNotMatch(dom.elements.tpGradesBody.innerHTML, /data-label="النتيجة"/);
  assert.equal(report.activeChapterSince, null);
});

check("الرصيد من لقطة الطالب نفسها وليس قائمة قديمة، ولا تسرب حقولاً خاصة", () => {
  const details = buildStudentDetailsFromProfileLog({
    student: { name: "محمد علي جديد", code: "BIO-42", status: "نشط", opportunities: 0, opportunityLimit: 3, phone: "PRIVATE_PHONE", dismissalNotes: "PRIVATE_NOTES" },
    generatedAt: "2026-09-09T01:00:00Z",
    currentChapter: { id: "ch1", name: "الفصل الأول", since: null, examIds: [] },
  });
  const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: details } });
  const { sandbox, dom } = executeInlineScripts(html, "fresh-balance");
  assert.equal(sandbox.STUDENT_LIST[0].opportunities, 0);
  assert.equal(sandbox.STUDENT_LIST[0].name, "محمد علي جديد");
  assert.doesNotMatch(html, /PRIVATE_PHONE|PRIVATE_NOTES/);
  openStudentDetails(dom, "s1", "محمد علي جديد");
  assert.match(dom.elements.tpStudentOverview.innerHTML, /<strong>0<\/strong>/);
  assert.doesNotMatch(dom.elements.tpStudentOverview.innerHTML, /حالتك:|التاريخ غير مسجّل|بياناتك حتى/);
});

check("الحركات بلا سبب تبقى ظاهرة والصفر محفوظ وإعادة التفعيل ليست جمعاً مرتين", () => {
  const report = sanitizeStudentDetailsForHtml({ s1: {
    grades: [], opportunityLogs: [
      { action: "إضافة", amount: 5, appliedAmount: 0, balanceBefore: 3, balanceAfter: 3, reason: null, date: "2026-09-03", examName: null },
      { action: "رصيد إعادة التفعيل", amount: 2, reason: "تسوية تاريخية: تثبيت رصيد الطالب بعد التعهد [academic-reactivation-link:private-code]", date: "2026-09-02", examName: null },
      { action: "إعادة تفعيل", amount: 0, reason: "تثبيت إعادة التفعيل بعد تعهد الطالب", date: "2026-09-02", examName: null },
      { action: "خصم تلقائي", amount: 1, balanceBefore: 1, balanceAfter: 0, date: "2026-09-04", reason: "غياب [zero-balance-violation]", examName: null },
    ],
  } });
  assert.equal(report.s1.opportunityLogs.length, 4);
  assert.equal(report.s1.opportunityLogs[0].effectText, "أصبح الرصيد 2");
  assert.equal(report.s1.opportunityLogs[1].effectText, "تغيير الحالة");
  assert.equal(report.s1.opportunityLogs[2].effectText, "لم يتغيّر عدد الفرص");
  assert.equal(report.s1.opportunityLogs[3].balanceAfter, 0);
  assert.doesNotMatch(JSON.stringify(report), /تلقائي|تسوية تاريخية|academic-reactivation|zero-balance/);
  assert.deepEqual(sanitizeStudentDetailsForHtml(report), report, "التنظيف المتكرر لا يبدل معنى الحركة");
});

check("تواريخ الامتحانات تستخدم يونيو ويوليو مع يوم بغداد والجدول أربعة أعمدة", () => {
  const exams = [
    { id: "june", name: "امتحان يونيو", date: "2026-06-15T22:00:00Z", fullMark: 20 },
    { id: "july", name: "امتحان يوليو", date: "2026-07-15T22:00:00Z", fullMark: 20 },
  ];
  const report = buildStudentDetailsFromProfileLog({ exams, allCourseExams: exams, grades: [
    { examId: "june", status: "درجة", score: 0 },
  ], opportunityLogs: [] });
  const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: report } });
  const { dom } = executeInlineScripts(html, "report-months");
  openStudentDetails(dom, "s1", "محمد علي حسن");
  const grades = dom.elements.tpGradesBody.innerHTML;
  assert.match(grades, /16 يونيو 2026/);
  assert.match(grades, /16 يوليو 2026/);
  assert.doesNotMatch(grades, /حزيران|تموز/);
  assert.match(grades, /<bdi>0 \/ 20<\/bdi>/, "درجة الصفر تبقى درجة ولا تتحول إلى غياب");
  assert.match(grades, /tp-mobile-field-value">غياب<\/span>/);
  const headings = [...html.match(/<table class="tp-details-table tp-grades-table"[^]*?<\/thead>/)[0].matchAll(/role="columnheader">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(headings, ["الامتحان", "تاريخ الامتحان", "الدرجة", "الأثر على الفرص"]);
  assert.equal(labelsFromRenderedCells(grades).length, 8);
});

check("نص أثر الامتحان مبسط ويحفظ عدد الخصومات الفعلية والصفر والفصل", () => {
  const exam = { id: "exam", name: "امتحان", date: "2026-07-01", fullMark: 20 };
  function effect(logs) {
    return buildStudentDetailsFromProfileLog({ exams: [exam], allCourseExams: [exam], grades: [],
      opportunityLogs: logs.map(log => ({ examId: exam.id, date: exam.date, ...log })),
    }).grades[0].opportunityEffect;
  }
  assert.equal(effect([]), "لا يوجد خصم لهذا الامتحان");
  assert.equal(effect([{ action: "خصم تلقائي", amount: 1 }]), "تم خصم فرصة لهذا الامتحان");
  assert.equal(effect([{ action: "خصم", amount: 3, appliedAmount: 1 }]), "تم خصم فرصة لهذا الامتحان");
  assert.equal(effect([{ action: "خصم", amount: 1, appliedAmount: 0 }]), "لا يوجد خصم لهذا الامتحان");
  assert.equal(effect([{ action: "خصم", amount: 2 }]), "تم خصم فرصتين لهذا الامتحان");
  assert.equal(effect([{ action: "خصم", amount: 3 }]), "عدد الفرص المخصومة لهذا الامتحان: 3");
  assert.match(effect([{ action: "فصل", amount: 0 }]), /سُجّل فصل بسبب هذا الامتحان/);
});

check("عبارة التعهد تشمل التسوية والتعهد اليدوي وتبقى بجانب الرصيد الفعلي", () => {
  const pledgeLogs = [
    { action: "رصيد بعد تعهد", amount: 2, reason: "تسوية تاريخية: تثبيت رصيد الطالب عند 2/3 بموجب تعهده للامتحان الفاينل للفصل الأول" },
    { action: "رصيد إعادة التفعيل", amount: 2, reason: "تم تعهد الطالب: إرجاعه إلى الحالة النشطة برصيد فرصتين بسبب التعهد" },
    { action: "إعادة تعيين", amount: 2, appliedAmount: 0, balanceBefore: 2, balanceAfter: 2, reason: "تسوية تاريخية: تعهد الطالب للامتحان الفاينل الفصل الأول" },
    { action: "إضافة", amount: 2, appliedAmount: 2, balanceAfter: 3, reason: "تعهد" },
    { action: "إعادة تفعيل", amount: 0, reason: "تثبيت إعادة التفعيل بعد تعهد الطالب: الطالب نشط برصيد فرصتين" },
  ];
  const message = "تم منح الطالب فرصتين بسبب تعهده";
  for (const log of pledgeLogs) {
    const profile = {
      student: { name: studentList[0].name, status: "نشط", opportunities: 1 },
      // A pledge can precede this chapter or refer to an older final exam.
      currentChapter: { id: "ch2", name: "الفصل الثاني", since: "2026-09-01", examIds: [] },
      opportunityLogs: [{ ...log, date: "2026-08-31", examId: "old-final" }],
    };
    const before = JSON.stringify(profile);
    const details = buildStudentDetailsFromProfileLog(profile);
    assert.equal(details.hasTwoOpportunityPledge, true, log.action);
    assert.equal(details.opportunityLogs.length, 0, "حدود سجل الفصل لا تتغير بسبب العبارة");
    const sanitized = sanitizeStudentDetailsForHtml({ s1: details });
    assert.deepEqual(sanitizeStudentDetailsForHtml(sanitized), sanitized);
    const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: sanitized });
    const { dom } = executeInlineScripts(html, "pledge-grant");
    dom.elements.tpStudentSearch.value = "محمد علي";
    dom.elements.tpStudentSearch.dispatch("input", {});
    clickFirstSuggestion(dom);
    assert.ok(dom.elements.tpStudentCard.innerHTML.includes(message));
    assert.ok(dom.elements.tpStudentOverview.innerHTML.includes(message));
    assert.match(dom.elements.tpStudentOverview.innerHTML, /<strong>1<\/strong>/);
    assert.equal((dom.elements.tpStudentOverview.innerHTML.match(/tp-summary-item/g) || []).length, 1);
    assert.equal(JSON.stringify(profile), before, "الإظهار لا يغيّر الرصيد أو سجل الطالب");
  }
});

check("الرصيد الحالي أو ذكر التعهد في خصم لا يخترع منح فرصتين", () => {
  const unrelatedLogs = [
    [],
    [{ action: "إضافة", amount: 2, reason: "إضافة عادية" }],
    [{ action: "إضافة", amount: 2, reason: "إضافة بدون تعهد" }],
    [{ action: "إضافة", amount: 2, appliedAmount: 0, reason: "تعهد" }],
    [{ action: "رصيد بعد تعهد", amount: 1, reason: "تعهد قديم بفرصة واحدة" }],
    [{ action: "رصيد بعد تعهد", amount: 2, balanceAfter: 1 }],
    [{ action: "إعادة تفعيل", amount: 0, reason: "بعد تعهد الطالب" }],
    [{ action: "إعادة تفعيل", amount: 0, balanceAfter: 1, reason: "إعادة بعد تعهد بفرصتين" }],
    [{ action: "رصيد إعادة التفعيل", amount: 2, reason: "بداية الفصل الجديد" }],
    [{ action: "فصل", amount: 2, reason: "عدم الالتزام بالتعهد" }],
    [{ action: "خصم", amount: 2, reason: "عدم الالتزام بالتعهد" }],
    [{ action: "إعادة تعيين", amount: 2, reason: "حماية P2: تثبيت الرصيد بعد التعهد دون تغيير بتوجيه المالك" }],
  ];
  for (const opportunityLogs of unrelatedLogs) {
    const details = buildStudentDetailsFromProfileLog({
      student: { name: studentList[0].name, opportunities: 2, status: "نشط" }, opportunityLogs,
    });
    assert.equal(details.hasTwoOpportunityPledge, false);
    const { dom } = executeInlineScripts(buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: details } }), "no-pledge-grant");
    openStudentDetails(dom, "s1", studentList[0].name);
    assert.doesNotMatch(dom.elements.tpStudentOverview.innerHTML, /تم منح الطالب فرصتين بسبب تعهده/);
    assert.match(dom.elements.tpStudentOverview.innerHTML, /<strong>2<\/strong>/);
  }
});

function examSelectionFixture() {
  const examA = { id: "choice-a", name: "امتحان بالاسم نفسه", date: "2026-09-01", fullMark: 20 };
  const examB = { id: "choice-b", name: "امتحان بالاسم نفسه", date: "2026-09-02", fullMark: 20 };
  const hiddenExam = { id: "choice-hidden", name: "EXCLUDED_EXAM_UNIQUE_NAME", date: "2026-09-03", fullMark: 20 };
  const oldExam = { id: "choice-old", name: "OLD_CHAPTER_EXAM", date: "2026-08-01", fullMark: 20 };
  const profile = {
    student: { name: studentList[0].name, code: "BIO-choice", status: "مفصول", opportunities: 0, opportunityLimit: 3 },
    generatedAt: "2026-09-10T09:00:00Z",
    currentChapter: { id: "ch2", name: "الفصل الثاني", since: "2026-09-01", examIds: [examA.id, examB.id, hiddenExam.id] },
    exams: [examA, hiddenExam, oldExam],
    allCourseExams: [examA, hiddenExam, oldExam],
    grades: [{ examId: examA.id, status: "درجة", score: 0 }, { examId: oldExam.id, status: "درجة", score: 10 }],
    opportunityLogs: [
      { examId: examA.id, action: "خصم", amount: 1, date: examA.date, reason: "درجة دون الحد" },
      { examId: hiddenExam.id, action: "خصم", amount: 1, date: hiddenExam.date, reason: "EXCLUDED_EXAM_UNIQUE_REASON" },
      { action: "رصيد بعد تعهد", amount: 2, date: "2026-09-01", reason: "تم منح فرصتين بسبب التعهد" },
    ],
  };
  const secondProfile = {
    ...profile,
    student: { name: "طالب ثان للاختبار", status: "نشط", opportunities: 2, opportunityLimit: 3 },
    exams: [examA, examB], allCourseExams: [examA, examB], grades: [], opportunityLogs: [],
  };
  return {
    profile, secondProfile,
    details: { s1: buildStudentDetailsFromProfileLog(profile), s2: buildStudentDetailsFromProfileLog(secondProfile) },
  };
}

check("قائمة اختيار الامتحانات تجمع كل الطلاب وتميز المعرفات المتشابهة وتشمل الغياب ضمن الفصل فقط", () => {
  const { details } = examSelectionFixture();
  const choices = getHtmlReportExams(details);
  assert.deepEqual(choices.map(exam => exam.id), ["choice-hidden", "choice-b", "choice-a"]);
  assert.equal(choices.filter(exam => exam.name === "امتحان بالاسم نفسه").length, 2, "تشابه الاسم لا يدمج امتحانين مستقلين");
  assert.ok(!choices.some(exam => exam.id === "choice-old"), "امتحان الفصل السابق لا يعود إلى الاختيار");
  const missingGrade = details.s2.grades.find(grade => grade.examId === "choice-b");
  assert.equal(missingGrade.status, "غائب");
  assert.equal(missingGrade.score, null);
  assert.equal(details.s1.grades.find(grade => grade.examId === "choice-a").score, 0);
  assert.equal(details.s1.opportunityLogs.find(log => log.reason === "EXCLUDED_EXAM_UNIQUE_REASON").examId, "choice-hidden");
  assert.deepEqual(getHtmlReportExams({}), []);
});

check("إلغاء امتحان يحذفه من بيانات HTML ودرجاته وخصمه فقط مع بقاء الرصيد والتعهد دون تغيير المصدر", () => {
  const { details, profile } = examSelectionFixture();
  const originalDetails = JSON.stringify(details);
  const originalProfile = JSON.stringify(profile);
  const selected = selectHtmlReportExams(details, ["choice-a", "choice-b"]);
  assert.notEqual(selected, details);
  assert.notEqual(selected.s1, details.s1);
  assert.deepEqual(selected.s1.grades.map(grade => grade.examId), ["choice-a"]);
  assert.deepEqual(selected.s2.grades.map(grade => grade.examId).sort(), ["choice-a", "choice-b"]);
  assert.equal(selected.s1.opportunityLogs.length, 2);
  assert.ok(selected.s1.opportunityLogs.some(log => !log.examId && log.action === "رصيد بعد تعهد"));
  assert.equal(selected.s1.hasTwoOpportunityPledge, true);
  assert.deepEqual(selected.s1.studentSnapshot, details.s1.studentSnapshot);
  assert.equal(selected.s1.studentSnapshot.opportunities, 0);
  assert.equal(selected.s1.studentSnapshot.status, "مفصول");
  assert.equal(selected.s1.grades[0].opportunityEffect, details.s1.grades.find(grade => grade.examId === "choice-a").opportunityEffect);
  const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: selected });
  assert.doesNotMatch(html, /EXCLUDED_EXAM_UNIQUE_NAME|EXCLUDED_EXAM_UNIQUE_REASON|choice-hidden/);
  const { sandbox, dom } = executeInlineScripts(html, "selected-exams");
  assert.equal(sandbox.STUDENT_LIST[0].opportunities, 0);
  assert.equal(sandbox.STUDENT_LIST[0].status, "مفصول");
  openStudentDetails(dom, "s1", studentList[0].name);
  assert.match(dom.elements.tpGradesBody.innerHTML, /0 \/ 20/);
  assert.match(dom.elements.tpStudentOverview.innerHTML, /تم منح الطالب فرصتين بسبب تعهده/);
  assert.equal(labelsFromRenderedCells(dom.elements.tpGradesBody.innerHTML).length, 4);
  assert.equal(JSON.stringify(details), originalDetails);
  assert.equal(JSON.stringify(profile), originalProfile);
});

check("اختيار امتحان بالمعرف لا يظهر امتحاناً آخر يحمل الاسم نفسه", () => {
  const { details } = examSelectionFixture();
  const selected = selectHtmlReportExams(details, ["choice-b", "choice-b", "unknown-choice"]);
  assert.deepEqual(selected.s1.grades, []);
  assert.deepEqual(selected.s2.grades.map(grade => grade.examId), ["choice-b"]);
  assert.equal(selected.s2.grades[0].status, "غائب");
  assert.deepEqual(selected.s1.opportunityLogs.map(log => log.action), ["رصيد بعد تعهد"]);
});

check("مسح كل الامتحانات ينتج تقرير فرص بلا صفوف درجات مع بقاء سجلات الطالب الأصلية", () => {
  const { details } = examSelectionFixture();
  const before = JSON.stringify(details);
  const selected = selectHtmlReportExams(details, []);
  assert.deepEqual(Object.keys(selected).sort(), ["s1", "s2"]);
  for (const student of Object.values(selected)) assert.deepEqual(student.grades, []);
  assert.deepEqual(selected.s1.opportunityLogs.map(log => log.action), ["رصيد بعد تعهد"]);
  const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: selected });
  const { sandbox, dom } = executeInlineScripts(html, "no-selected-exams");
  openStudentDetails(dom, "s1", studentList[0].name);
  assert.equal(sandbox.STUDENT_LIST[0].opportunities, 0);
  assert.equal(labelsFromRenderedCells(dom.elements.tpGradesBody.innerHTML).length, 0);
  assert.match(dom.elements.tpGradesBody.innerHTML, /colspan="4"/);
  assert.doesNotMatch(dom.elements.tpGradesBody.innerHTML, /امتحان بالاسم نفسه|EXCLUDED_EXAM/);
  assert.equal(JSON.stringify(details), before);
  assert.deepEqual(selectHtmlReportExams({}, []), {});
});

export { buildHtml, buildStudentDetailsFromProfileLog, sanitizeStudentDetailsForHtml };

check("حماية الرصيد القديم لا توصف كمنح فرص جديدة ولا تعرض أسماء مراحل الصيانة", () => {
  const details = sanitizeStudentDetailsForHtml({ s1: { grades: [], opportunityLogs: [{
    action: "إعادة تعيين", amount: 1, appliedAmount: 0, balanceBefore: 1, balanceAfter: 1,
    reason: "حماية P2: تثبيت الرصيد الموجود دون تغيير بتوجيه المالك؛ حفظ السجلات والدرجات السابقة ومنع إعادة احتسابها",
    date: "2026-09-08", examName: null,
  }] } });
  assert.equal(details.s1.opportunityLogs[0].effectText, "بقي الرصيد 1");
  assert.equal(details.s1.opportunityLogs[0].action, "تأكيد الرصيد");
  assert.doesNotMatch(details.s1.opportunityLogs[0].reason, /P2|المالك|احتساب/);
});

if (failures > 0) {
  console.error(`\nفشل ${failures} من اختبارات HTML السلوكية لإدارة الفرص.`);
  process.exit(1);
}

console.log("\nكل اختبارات HTML السلوكية لإدارة الفرص نجحت.");
