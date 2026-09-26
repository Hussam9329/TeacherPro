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
    if (request === "@/lib/grace-periods") return require(path.join(projectRoot, "src/lib/grace-periods.ts"));
    if (request === "@/lib/grade-classification") return require(path.join(projectRoot, "src/lib/grade-classification.ts"));
    if (request === "@/lib/grade-score") return require(path.join(projectRoot, "src/lib/grade-score.ts"));
    if (request === "@/lib/baghdad-time") return require(path.join(projectRoot, "src/lib/baghdad-time.ts"));
    if (request === "@/lib/academic-types") return require(path.join(projectRoot, "src/lib/academic-types.ts"));
    if (request === "@/lib/exam-utils") return require(path.join(projectRoot, "src/lib/exam-utils.ts"));
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

function clickFirstSuggestion(dom, index = 0) {
  const suggestion = {
    getAttribute(name) {
      return name === "data-idx" ? String(index) : null;
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

function openStudentDetails(dom, studentId) {
  const button = {
    getAttribute(name) {
      return name === "data-sid" ? studentId : null;
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

check("اختيار الطالب يفتح التفاصيل ويترك سطراً مختصراً لإعادة فتحها بدون جدول مكرر", () => {
  const { dom } = executeInlineScripts(validHtml, "opportunities-interaction");
  dom.elements.tpStudentSearch.value = "محمد علي";
  dom.elements.tpStudentSearch.dispatch("input", {});
  clickFirstSuggestion(dom);

  const studentCardHtml = dom.elements.tpStudentCard.innerHTML;
  assert.match(studentCardHtml, /محمد علي حسن/);
  assert.match(studentCardHtml, /فرصك: <strong>2<\/strong>/);
  assert.match(studentCardHtml, /data-sid="s1">افتح التفاصيل<\/button>/);
  assert.doesNotMatch(studentCardHtml, /<table|الدورة الشتوية|tp-pledge-note|tp-balance-note/);
  assert.ok(dom.elements.tpDetailsModal.classList.contains("open"));
  const originalGrades = dom.elements.tpGradesBody.innerHTML;
  const originalOverview = dom.elements.tpStudentOverview.innerHTML;

  dom.elements.tpModalClose.dispatch("click", {});
  assert.ok(!dom.elements.tpDetailsModal.classList.contains("open"));
  assert.ok(dom.elements.tpStudentCard.classList.contains("visible"));

  openStudentDetails(dom, "s1");
  assert.equal(dom.elements.tpModalTitleText.textContent, "محمد علي حسن");
  assert.equal(dom.elements.tpGradesBody.innerHTML, originalGrades);
  assert.equal(dom.elements.tpStudentOverview.innerHTML, originalOverview);
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
        grades: [
          {
            ...studentDetails.s1.grades[0],
            examName: breakoutPayload,
          },
        ],
        timelineEvents: [{ text: breakoutPayload, date: "2026-09-01", kind: "add", balanceAfter: 3 }],
      },
    },
  });

  assert.ok(!maliciousHtml.includes(breakoutPayload), "raw script-closing payload leaked");
  assert.doesNotMatch(
    maliciousHtml,
    /<script>\s*globalThis\.__teacherProBreakout\s*=/,
  );
  const { sandbox, historyCalls, dom } = executeInlineScripts(
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
    sandbox.STUDENT_DETAILS.s1.grades[0].examName,
    breakoutPayload,
  );
  assert.equal(sandbox.STUDENT_DETAILS.s1.timelineEvents[0].text, breakoutPayload);
  openStudentDetails(dom, "s1", breakoutPayload);
  assert.match(dom.elements.tpGradesBody.innerHTML, /&lt;\/script&gt;&lt;script&gt;/);
  assert.doesNotMatch(dom.elements.tpStudentOverview.innerHTML, /script/);
  assert.doesNotMatch(dom.elements.tpGradesBody.innerHTML, /<script>/);
  assert.equal(sandbox.__teacherProBreakout, undefined);
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

check("الامتحان بلا نتيجة مسجلة يبقى بانتظار الدرجة ولا يتحول إلى غياب", () => {
  const exam = { id: "exam-1", name: "امتحان الفصل", date: "2026-09-01", fullMark: 20 };
  const report = buildStudentDetailsFromProfileLog({
    exams: [exam], allCourseExams: [exam], grades: [], opportunityLogs: [],
    currentChapter: { id: "ch1", name: "الفصل الأول", since: null, examIds: [exam.id] },
  });
  assert.equal(report.grades.length, 1);
  assert.notEqual(report.grades[0].status, "غائب");
  assert.equal(report.grades[0].outcome, "بانتظار الدرجة");
  assert.equal(report.grades[0].opportunityEffect, "—");
  const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: report } });
  const { dom } = executeInlineScripts(html, "missing-grade-cell");
  openStudentDetails(dom, "s1", "محمد علي حسن");
  assert.match(dom.elements.tpGradesBody.innerHTML, /data-label="الدرجة"[^]*?tp-mobile-field-value">بانتظار الدرجة<\/span>/);
  assert.doesNotMatch(dom.elements.tpGradesBody.innerHTML, /data-label="النتيجة"/);
  assert.equal(report.activeChapterSince, null);
});

check("HTML يميز الإجازة والغياب المثبت والدرجات المعلقة دون اختراع غياب أو إخفاء خصم", () => {
  const cases = [
    { label: "formal-leave", grade: { status: "مجاز", score: null }, cell: "إجازة", effect: "لا خصم" },
    { label: "formal-leave-during-grace", grade: { status: "مجاز", score: null }, grace: true, cell: "إجازة", effect: "لا خصم" },
    { label: "recorded-absence", grade: { status: "غائب", score: null }, cell: "غياب", effect: "لا خصم" },
    { label: "recorded-absence-with-deduction", grade: { status: "غائب", score: null }, logs: [{ action: "خصم", amount: 1 }], cell: "غياب", effect: "خُصمت فرصة" },
    { label: "pending-status", grade: { status: "درجة معلّقة", score: null }, cell: "بانتظار الدرجة", effect: "—" },
    { label: "missing-status", grade: { score: null }, cell: "بانتظار الدرجة", effect: "—" },
    { label: "unknown-status", grade: { status: "حالة قديمة غير معروفة", score: null }, cell: "بانتظار الدرجة", effect: "—" },
    { label: "null-numeric-score", grade: { status: "درجة", score: null }, cell: "بانتظار الدرجة", effect: "—" },
    { label: "missing-numeric-score", grade: { status: "درجة" }, cell: "بانتظار الدرجة", effect: "—" },
    { label: "pending-with-deduction", grade: { status: "درجة معلّقة", score: null }, logs: [{ action: "خصم", amount: 1 }], cell: "بانتظار الدرجة", effect: "خُصمت فرصة" },
    { label: "missing-with-deduction", logs: [{ action: "خصم تلقائي", amount: 2 }], cell: "بانتظار الدرجة", effect: "خُصمت فرصتان" },
    { label: "formal-leave-with-recorded-deduction", grade: { status: "مجاز", score: null }, logs: [{ action: "خصم", amount: 1 }], cell: "إجازة", effect: "خُصمت فرصة" },
    { label: "stored-zero", grade: { status: "درجة", score: 0 }, cell: "<bdi>0 / 20</bdi>", effect: "لا خصم" },
    { label: "exam-without-deduction", grade: { status: "درجة", score: 12 }, noDiscount: true, cell: "<bdi>12 / 20</bdi>", effect: "امتحان بدون خصم" },
  ];
  for (const scenario of cases) {
    const exam = { id: "status-exam", name: "امتحان الحالة الفعلية", date: "2026-09-05", fullMark: 20, noDiscount: scenario.noDiscount };
    const profile = {
      student: { opportunities: 2, gracePeriods: scenario.grace ? [{ startDate: "2026-09-01", endDate: "2026-09-10" }] : [] },
      exams: [exam], allCourseExams: [exam],
      grades: scenario.grade ? [{ id: "status-grade", examId: exam.id, ...scenario.grade }] : [],
      opportunityLogs: (scenario.logs || []).map(log => ({ ...log, examId: exam.id, date: exam.date })),
    };
    const original = JSON.stringify(profile);
    const details = buildStudentDetailsFromProfileLog(profile);
    const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: details } });
    const { dom } = executeInlineScripts(html, scenario.label);
    openStudentDetails(dom, "s1", "محمد علي حسن");
    const rendered = dom.elements.tpGradesBody.innerHTML;
    assert.equal(rendered.match(/data-label="الدرجة"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1], scenario.cell, scenario.label);
    assert.equal(rendered.match(/data-label="الأثر على الفرص"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1], scenario.effect, scenario.label);
    if (scenario.logs) assert.match(rendered, /tp-grade-deduction/, scenario.label);
    if (scenario.effect === "لا خصم") assert.match(rendered, /tp-grade-no-deduction/, scenario.label);
    assert.equal(details.studentSnapshot.opportunities, 2);
    assert.equal(JSON.stringify(profile), original, "presentation never mutates grades, leave, balances or logs");
  }
});

check("الإجازات الفعلية تغطي الامتحان المحدد وحدود الفترة بتوقيت بغداد حتى بلا سجل درجة", () => {
  const period = { leaveType: "period", dateFrom: "2026-09-01", dateTo: "2026-09-10" };
  const cases = [
    { label: "exam-leave-without-grade", date: "2026-09-04", leaves: [{ examId: "leave-exam" }], cell: "إجازة", effect: "لا خصم" },
    { label: "unrelated-exam-leave", date: "2026-09-04", leaves: [{ examId: "other-exam" }], cell: "بانتظار الدرجة", effect: "—" },
    { label: "period-start-baghdad", date: "2026-08-31T21:00:00Z", leaves: [period], cell: "إجازة", effect: "لا خصم" },
    { label: "period-end-baghdad", date: "2026-09-10T20:59:59Z", leaves: [period], grade: { status: "غائب", score: null }, cell: "إجازة", effect: "لا خصم" },
    { label: "before-period", date: "2026-08-31T20:59:59Z", leaves: [period], cell: "بانتظار الدرجة", effect: "—" },
    { label: "after-period-recorded-absence", date: "2026-09-10T21:00:00Z", leaves: [period], grade: { status: "غائب", score: null }, cell: "غياب", effect: "لا خصم" },
    { label: "period-zero-score-preserved", date: "2026-09-05", leaves: [period], grade: { status: "درجة", score: 0 }, cell: "<bdi>0 / 20</bdi>", effect: "لا خصم" },
    { label: "period-cheating-remains-incident", date: "2026-09-05", leaves: [period], grade: { status: "غش", score: null }, cell: "غش", effect: "لا خصم" },
  ];
  for (const scenario of cases) {
    const exam = { id: "leave-exam", name: "امتحان الإجازة", date: scenario.date, fullMark: 20 };
    const profile = {
      student: { opportunities: 3 }, studentLeaves: scenario.leaves,
      exams: [exam], allCourseExams: [exam],
      grades: scenario.grade ? [{ id: "leave-grade", examId: exam.id, ...scenario.grade }] : [],
      opportunityLogs: [],
    };
    const original = JSON.stringify(profile);
    const details = buildStudentDetailsFromProfileLog(profile);
    const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: details } });
    const { dom } = executeInlineScripts(html, scenario.label);
    openStudentDetails(dom, "s1", "محمد علي حسن");
    const rendered = dom.elements.tpGradesBody.innerHTML;
    assert.equal(rendered.match(/data-label="الدرجة"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1], scenario.cell, scenario.label);
    assert.equal(rendered.match(/data-label="الأثر على الفرص"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1], scenario.effect, scenario.label);
    assert.equal(JSON.stringify(profile), original, "leave presentation cannot overwrite the stored result");
  }
});

check("HTML يعرض غير الحاضر ضمن السماح مجازاً بتواريخ بغداد ويحفظ الدرجات والخصومات المسجلة", () => {
  const period = { startDate: "2026-09-01", endDate: "2026-09-10" };
  const graceEffect = "بدون خصم (فترة سماح لغاية 10-9-2026)";
  const cases = [
    { label: "missing-grade", date: "2026-09-04", cell: "مجاز", effect: graceEffect },
    { label: "recorded-absence", date: "2026-09-05", grade: { status: "غائب", score: null }, cell: "مجاز", effect: graceEffect },
    { label: "baghdad-first-instant", date: "2026-08-31T21:00:00Z", cell: "مجاز", effect: graceEffect },
    { label: "baghdad-last-instant", date: "2026-09-10T20:59:59Z", cell: "مجاز", effect: graceEffect },
    { label: "before-start", date: "2026-08-31T20:59:59Z", cell: "بانتظار الدرجة", effect: "—" },
    { label: "after-end", date: "2026-09-10T21:00:00Z", cell: "بانتظار الدرجة", effect: "—" },
    { label: "cancelled-period", date: "2026-09-04", cancelledAt: "2026-09-02T10:00:00Z", cell: "بانتظار الدرجة", effect: "—" },
    { label: "zero-score", date: "2026-09-04", grade: { status: "درجة", score: 0 }, cell: "<bdi>0 / 20</bdi>", effect: graceEffect },
    { label: "recorded-score", date: "2026-09-04", grade: { status: "درجة", score: 18 }, cell: "<bdi>18 / 20</bdi>", effect: graceEffect },
    { label: "legacy-placeholder", date: "2026-09-04", grade: { status: "ضمن فترة السماح", score: null }, cell: "مجاز", effect: graceEffect },
    { label: "legacy-without-period", date: "2026-09-11", grade: { status: "ضمن فترة السماح", score: null }, cell: "بانتظار الدرجة", effect: "—" },
    { label: "stored-deduction", date: "2026-09-04", logs: [{ action: "خصم", amount: 1 }], cell: "مجاز", effect: "خُصمت فرصة" },
  ];
  for (const scenario of cases) {
    const exam = { id: "grace-exam", name: "الأسبوعي 2", date: scenario.date, fullMark: 20 };
    const profile = {
      student: { gracePeriods: [{ ...period, cancelledAt: scenario.cancelledAt }], opportunities: 3 },
      generatedAt: "2026-09-26T00:00:00Z",
      exams: [exam], allCourseExams: [exam],
      grades: scenario.grade ? [{ id: "grace-grade", examId: exam.id, ...scenario.grade }] : [],
      opportunityLogs: (scenario.logs || []).map(log => ({ ...log, examId: exam.id, date: exam.date })),
    };
    const original = JSON.stringify(profile);
    const details = buildStudentDetailsFromProfileLog(profile);
    const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: details } });
    const { dom } = executeInlineScripts(html, scenario.label);
    openStudentDetails(dom, "s1", "محمد علي حسن");
    const rendered = dom.elements.tpGradesBody.innerHTML;
    const gradeCell = rendered.match(/data-label="الدرجة"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1];
    assert.equal(gradeCell, scenario.cell, scenario.label);
    assert.ok(rendered.includes(scenario.effect), scenario.label);
    if (scenario.effect === graceEffect) assert.match(rendered, /tp-grade-no-deduction/);
    if (scenario.logs) assert.match(rendered, /tp-grade-deduction/);
    assert.equal(JSON.stringify(profile), original, "report cannot mutate stored grades, periods or balance");
    assert.equal(details.studentSnapshot.opportunities, 3);
  }
});

check("HTML يحذف امتحانات ما قبل التسجيل ويحافظ على امتحانات يوم التسجيل بتوقيت بغداد", () => {
  const cases = [
    { label: "missing-before-registration", removed: true },
    { label: "absence-before-registration", grade: { status: "غائب", score: null }, removed: true },
    { label: "stored-marker", registeredAt: null, grade: { status: "قبل تسجيل الطالب", score: null }, removed: true },
    { label: "missing-exam-date-marker", date: null, grade: { status: "قبل تسجيل الطالب", score: null }, removed: true },
    { label: "invalid-exam-date-marker", date: "invalid", grade: { status: "قبل تسجيل الطالب", score: null }, removed: true },
    { label: "same-baghdad-day", date: "2026-09-09T21:00:00Z", cell: "بانتظار الدرجة", effect: "—" },
    { label: "later-exam", date: "2026-09-11", cell: "بانتظار الدرجة", effect: "—" },
    { label: "missing-registration", registeredAt: null, cell: "بانتظار الدرجة", effect: "—" },
    { label: "invalid-registration", registeredAt: "invalid", cell: "بانتظار الدرجة", effect: "—" },
    { label: "zero-before-registration", grade: { status: "درجة", score: 0, academicEffectExcluded: true }, removed: true },
    { label: "numeric-before-registration", grade: { status: "درجة", score: 18, academicEffectExcluded: true }, removed: true },
    { label: "cheating-before-registration", grade: { status: "غش", score: null }, removed: true },
    { label: "also-within-grace", gracePeriods: [{ startDate: "2026-09-01", endDate: "2026-09-15" }], removed: true },
    { label: "actual-deduction", logs: [{ action: "خصم", amount: 1 }], removed: true },
  ];
  for (const scenario of cases) {
    const exam = { id: "pre-registration-exam", name: "امتحان قبل التسجيل", date: "date" in scenario ? scenario.date : "2026-09-09T20:59:59Z", fullMark: 20 };
    const profile = {
      student: {
        createdAt: "registeredAt" in scenario ? scenario.registeredAt : "2026-09-10T12:00:00Z",
        gracePeriods: scenario.gracePeriods || [], opportunities: 3,
      },
      exams: [exam], allCourseExams: [exam],
      grades: scenario.grade ? [{ id: "pre-registration-grade", examId: exam.id, ...scenario.grade }] : [],
      opportunityLogs: (scenario.logs || []).map(log => ({ ...log, examId: exam.id, date: exam.date })),
    };
    const original = JSON.stringify(profile);
    const details = buildStudentDetailsFromProfileLog(profile);
    const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: details } });
    const { dom } = executeInlineScripts(html, scenario.label);
    openStudentDetails(dom, "s1", "محمد علي حسن");
    const rendered = dom.elements.tpGradesBody.innerHTML;
    if (scenario.removed) {
      assert.equal(details.grades.length, 0, scenario.label);
      assert.doesNotMatch(rendered, /امتحان قبل التسجيل|data-label="الدرجة"/, scenario.label);
      assert.equal(getHtmlReportExams({ s1: details }).length, 0, "hidden pre-registration rows do not enter exam selection");
    } else {
      assert.equal(details.grades.length, 1, scenario.label);
      assert.equal(rendered.match(/data-label="الدرجة"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1], scenario.cell, scenario.label);
      assert.equal(rendered.match(/data-label="الأثر على الفرص"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1], scenario.effect, scenario.label);
    }
    assert.equal(JSON.stringify(profile), original);
    assert.equal(details.studentSnapshot.opportunities, 3);
  }
});

check("HTML يعرض الغش بحالته الصحيحة وأثره من الخصم المسجل دون اختراع فرص مخصومة", () => {
  const exam = { id: "cheating-exam", name: "الشهري الأول", date: "2026-09-05", fullMark: 20 };
  const deduction = { action: "خصم تلقائي", amount: 2 };
  const cases = [
    { label: "cheating-two", logs: [deduction], effect: "خُصمت فرصتان", deduction: true },
    { label: "cheating-one-applied", logs: [{ ...deduction, appliedAmount: 1 }], effect: "خُصمت فرصة", deduction: true },
    { label: "cheating-three", logs: [{ ...deduction, amount: 3 }], effect: "خُصمت 3 فرص", deduction: true },
    { label: "cheating-zero-applied", logs: [{ ...deduction, appliedAmount: 0 }], effect: "لا خصم" },
    { label: "cheating-without-log", effect: "لا خصم" },
    { label: "cheating-dismissal", logs: [deduction, { action: "فصل تلقائي", amount: 0 }], effect: "خُصمت فرصتان. سُجّل فصل بسبب هذا الامتحان", deduction: true },
    { label: "cheating-settled-history-retained", logs: [deduction, { action: "إعادة تعيين", amount: 3, balanceAfter: 3, ledgerVersion: 2, date: "2026-09-06", settledGradeIds: '["cheating-grade"]' }], effect: "خُصمت فرصتان", deduction: true },
    { label: "cheating-during-grace", student: { gracePeriods: [{ startDate: "2026-09-01", endDate: "2026-09-10" }] }, effect: "بدون خصم (فترة سماح لغاية 10-9-2026)" },
  ];
  for (const scenario of cases) {
    const profile = {
      student: { opportunities: 1, ...scenario.student },
      exams: [exam], allCourseExams: [exam],
      currentChapter: { id: "ch1", name: "الفصل الأول", examIds: [exam.id] },
      grades: [{ id: "cheating-grade", examId: exam.id, status: "غش", score: null }],
      opportunityLogs: (scenario.logs || []).map(log => ({ examId: exam.id, chapterId: "ch1", date: exam.date, ...log })),
    };
    const original = JSON.stringify(profile);
    const details = buildStudentDetailsFromProfileLog(profile);
    const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: details } });
    const { dom } = executeInlineScripts(html, scenario.label);
    openStudentDetails(dom, "s1", "محمد علي حسن");
    const rendered = dom.elements.tpGradesBody.innerHTML;
    assert.equal(rendered.match(/data-label="الدرجة"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1], "غش", scenario.label);
    assert.equal(rendered.match(/data-label="الأثر على الفرص"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1], scenario.effect, scenario.label);
    assert.match(rendered, scenario.deduction ? /tp-grade-deduction/ : /tp-grade-no-deduction/);
    assert.equal(JSON.stringify(profile), original);
    assert.equal(details.studentSnapshot.opportunities, 1);
  }
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
  assert.match(grades, /tp-mobile-field-value">بانتظار الدرجة<\/span>/);
  const headings = [...html.match(/<table class="tp-details-table tp-grades-table"[^]*?<\/thead>/)[0].matchAll(/role="columnheader">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(headings, ["الامتحان", "تاريخ الامتحان", "الدرجة", "الأثر على الفرص"]);
  assert.equal(labelsFromRenderedCells(grades).length, 8);
});

check("نص أثر الامتحان مبسط ويحفظ عدد الخصومات الفعلية والصفر والفصل", () => {
  const exam = { id: "exam", name: "امتحان", date: "2026-07-01", fullMark: 20 };
  function effect(logs) {
    return buildStudentDetailsFromProfileLog({ exams: [exam], allCourseExams: [exam], grades: [{ examId: exam.id, status: "غائب", score: null }],
      opportunityLogs: logs.map(log => ({ examId: exam.id, date: exam.date, ...log })),
    }).grades[0].opportunityEffect;
  }
  assert.equal(effect([]), "لا خصم");
  assert.equal(effect([{ action: "خصم تلقائي", amount: 1 }]), "خُصمت فرصة");
  assert.equal(effect([{ action: "خصم", amount: 3, appliedAmount: 1 }]), "خُصمت فرصة");
  assert.equal(effect([{ action: "خصم", amount: 1, appliedAmount: 0 }]), "لا خصم");
  assert.equal(effect([{ action: "خصم", amount: 2 }]), "خُصمت فرصتان");
  assert.equal(effect([{ action: "خصم", amount: 3 }]), "خُصمت 3 فرص");
  assert.match(effect([{ action: "فصل", amount: 0 }]), /سُجّل فصل بسبب هذا الامتحان/);
});

check("ألوان صفوف التقرير تعتمد على أثر الامتحان الفعلي وتبقى دلالته مكتوبة بجانب اللون", () => {
  const exam = { id: "tone-exam", name: "امتحان لون الحالة", date: "2026-09-12", fullMark: 20 };
  const debit = { action: "خصم تلقائي", amount: 2 };
  const dismissal = { action: "فصل تلقائي", amount: 0 };
  const settlement = {
    action: "رصيد إعادة التفعيل", amount: 3, balanceAfter: 3, ledgerVersion: 2,
    settledGradeIds: '["tone-grade"]', date: "2026-09-16T09:00:00Z",
  };
  const cases = [
    { label: "ordinary-score", grade: { status: "درجة", score: 18 }, tone: "ordinary", effect: "لا خصم" },
    { label: "ordinary-pending", tone: "ordinary", effect: "—" },
    { label: "ordinary-no-discount", grade: { status: "درجة", score: 18 }, noDiscount: true, tone: "ordinary", effect: "امتحان بدون خصم" },
    { label: "ordinary-recorded-absence", grade: { status: "غائب", score: null }, tone: "ordinary", effect: "لا خصم" },
    { label: "formal-leave-green", grade: { status: "مجاز", score: null }, tone: "excused", effect: "لا خصم" },
    { label: "effective-exam-leave-green", leaves: [{ examId: exam.id }], tone: "excused", effect: "لا خصم" },
    { label: "grace-green", grace: true, tone: "excused", effect: "بدون خصم (فترة سماح لغاية 15-9-2026)" },
    { label: "scored-grace-green", grade: { status: "درجة", score: 18 }, grace: true, tone: "excused", effect: "بدون خصم (فترة سماح لغاية 15-9-2026)" },
    { label: "deduction-pink", grade: { status: "غائب" }, logs: [debit], tone: "deducted", effect: "خُصمت فرصتان" },
    { label: "zero-applied-no-pink", grade: { status: "غائب" }, logs: [{ ...debit, appliedAmount: 0 }], tone: "ordinary", effect: "لا خصم" },
    { label: "deduction-precedes-grace", grace: true, logs: [debit], tone: "deducted", effect: "خُصمت فرصتان" },
    { label: "deduction-precedes-leave", grade: { status: "مجاز" }, logs: [debit], tone: "deducted", effect: "خُصمت فرصتان" },
    { label: "dismissal-strongest", grade: { status: "غش" }, grace: true, logs: [debit, dismissal], tone: "dismissed", effect: "خُصمت فرصتان. سُجّل فصل بسبب هذا الامتحان" },
    { label: "dismissal-with-zero-deduction", grade: { status: "غائب" }, logs: [{ ...debit, appliedAmount: 0 }, dismissal], tone: "dismissed", effect: "سُجّل فصل بسبب هذا الامتحان" },
    { label: "settled-old-dismissal-retained", grade: { status: "غائب" }, logs: [debit, dismissal, settlement], tone: "dismissed", effect: "خُصمت فرصتان. سُجّل فصل بسبب هذا الامتحان" },
    { label: "later-manual-deduction-keeps-complete-history", grade: { status: "غائب" }, logs: [debit, dismissal, settlement, { action: "خصم", amount: 1, date: "2026-09-17" }], tone: "dismissed", effect: "خُصمت 3 فرص. سُجّل فصل بسبب هذا الامتحان" },
    { label: "later-manual-dismissal-keeps-earlier-deduction", grade: { status: "غائب" }, logs: [debit, dismissal, settlement, { action: "فصل", amount: 0, date: "2026-09-17" }], tone: "dismissed", effect: "خُصمت فرصتان. سُجّل فصل بسبب هذا الامتحان" },
    { label: "student-status-alone-does-not-color-exam", studentStatus: "مفصول", grade: { status: "درجة", score: 18 }, tone: "ordinary", effect: "لا خصم" },
  ];
  for (const scenario of cases) {
    const currentExam = { ...exam, noDiscount: Boolean(scenario.noDiscount) };
    const profile = {
      student: {
        opportunities: 3, status: scenario.studentStatus || "نشط",
        gracePeriods: scenario.grace ? [{ startDate: "2026-09-01", endDate: "2026-09-15" }] : [],
      },
      studentLeaves: scenario.leaves || [],
      currentChapter: { id: "tone-chapter", name: "الفصل الحالي", since: null, examIds: [exam.id] },
      exams: [currentExam], allCourseExams: [currentExam],
      grades: scenario.grade ? [{ id: "tone-grade", examId: exam.id, ...scenario.grade }] : [],
      opportunityLogs: (scenario.logs || []).map(log => ({ examId: exam.id, chapterId: "tone-chapter", date: exam.date, ...log })),
    };
    const before = JSON.stringify(profile);
    const details = buildStudentDetailsFromProfileLog(profile);
    assert.equal(details.grades[0].opportunityTone, scenario.tone, scenario.label);
    assert.equal(details.grades[0].opportunityEffect, scenario.effect, scenario.label);
    const sanitized = sanitizeStudentDetailsForHtml({ s1: details });
    assert.equal(sanitized.s1.grades[0].opportunityTone, scenario.tone, `${scenario.label}: sanitizing preserves the evidence-based tone`);
    const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: sanitized });
    const { dom } = executeInlineScripts(html, scenario.label);
    openStudentDetails(dom, "s1", studentList[0].name);
    const rendered = dom.elements.tpGradesBody.innerHTML;
    assert.match(rendered, new RegExp('<tr[^>]*class="[^"]*\\btp-grade-row-' + scenario.tone + '\\b'), scenario.label);
    assert.equal((rendered.match(/tp-grade-row-(?:ordinary|excused|deducted|dismissed)/g) || []).length, 1, "one exam has one semantic row tone");
    assert.equal(rendered.match(/data-label="الأثر على الفرص"[^]*?tp-mobile-field-value">([^]*?)<\/span>/)?.[1], scenario.effect, "color never replaces the factual effect text");
    if (scenario.tone === "dismissed") assert.match(rendered, /سُجّل فصل بسبب هذا الامتحان/, scenario.label);
    assert.equal(JSON.stringify(profile), before, "row styling never mutates balances, grades, excuses or ledger records");
    assert.equal(details.studentSnapshot.opportunities, 3);
  }
});

check("التعهد خارج الفصل الحالي لا يعود كشعار ثابت أو كحدث في تفاصيل الفصل", () => {
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
    assert.ok(!dom.elements.tpStudentCard.innerHTML.includes(message), "توضيح التعهد يظهر داخل التفاصيل فقط");
    assert.ok(!dom.elements.tpStudentOverview.innerHTML.includes(message));
    assert.doesNotMatch(dom.elements.tpGradesBody.innerHTML, /tp-timeline-event|تم قبول التعهّد/);
    assert.equal(details.timelineEvents.length, 0);
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

check("قائمة اختيار الامتحانات تجمع كل الطلاب وتميز المعرفات المتشابهة وتشمل الامتحانات بانتظار الدرجة ضمن الفصل فقط", () => {
  const { details } = examSelectionFixture();
  const choices = getHtmlReportExams(details);
  assert.deepEqual(choices.map(exam => exam.id), ["choice-hidden", "choice-b", "choice-a"]);
  assert.equal(choices.filter(exam => exam.name === "امتحان بالاسم نفسه").length, 2, "تشابه الاسم لا يدمج امتحانين مستقلين");
  assert.ok(!choices.some(exam => exam.id === "choice-old"), "امتحان الفصل السابق لا يعود إلى الاختيار");
  const missingGrade = details.s2.grades.find(grade => grade.examId === "choice-b");
  assert.equal(missingGrade.outcome, "بانتظار الدرجة");
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
  assert.doesNotMatch(dom.elements.tpStudentOverview.innerHTML, /تم منح الطالب فرصتين بسبب تعهده/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /tp-timeline-event-return/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /تم قبول التعهّد/);
  assert.equal(labelsFromRenderedCells(dom.elements.tpGradesBody.innerHTML).length, 4);
  assert.equal(JSON.stringify(details), originalDetails);
  assert.equal(JSON.stringify(profile), originalProfile);
});

check("اختيار امتحان بالمعرف لا يظهر امتحاناً آخر يحمل الاسم نفسه", () => {
  const { details } = examSelectionFixture();
  const selected = selectHtmlReportExams(details, ["choice-b", "choice-b", "unknown-choice"]);
  assert.deepEqual(selected.s1.grades, []);
  assert.deepEqual(selected.s2.grades.map(grade => grade.examId), ["choice-b"]);
  assert.equal(selected.s2.grades[0].outcome, "بانتظار الدرجة");
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

check("استعادة برصيد جديد تظهر بعد الخصم التاريخي دون محوه أو تغييره", () => {
  const exam = { id: "restored-exam", name: "امتحان قبل الاستعادة", date: "2026-09-12", type: "تراكمي", fullMark: 100 };
  const profile = {
    student: { name: studentList[0].name, code: "BIO-TEST", status: "نشط", opportunities: 3, opportunityLimit: 3 },
    currentChapter: { id: "current", name: "الفصل الحالي", since: "2026-09-01", examIds: [exam.id] },
    grades: [{ id: "settled-grade", examId: exam.id, status: "غائب", score: null }],
    exams: [exam],
    opportunityLogs: [
      { action: "خصم تلقائي", amount: 2, examId: exam.id, chapterId: "current", date: exam.date },
      { action: "رصيد إعادة التفعيل", amount: 3, balanceAfter: 3, ledgerVersion: 2, chapterId: "current", settledGradeIds: '["settled-grade"]', date: "2026-09-16T09:44:47.457Z", reason: "PRIVATE_ADMIN_REASON" },
    ],
  };
  const before = JSON.stringify(profile);
  const details = buildStudentDetailsFromProfileLog(profile);
  assert.equal(details.grades[0].opportunityEffect, "خُصمت فرصتان");
  assert.equal(details.studentSnapshot.opportunities, 3);
  assert.equal(details.opportunityLogs.length, 2, "التقرير لا يحذف سجل التدقيق التاريخي");
  const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: details } });
  const { dom } = executeInlineScripts(html, "settled-opportunity-report");
  openStudentDetails(dom, "s1", studentList[0].name);
  assert.match(dom.elements.tpStudentOverview.innerHTML, /<strong>3<\/strong>/);
  assert.doesNotMatch(dom.elements.tpStudentOverview.innerHTML, /أُعيد تفعيلك|16 سبتمبر 2026/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /أُعيد تفعيلك برصيد 3 فرص/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /16 سبتمبر 2026/);
  assert.doesNotMatch(dom.elements.tpStudentOverview.innerHTML, /PRIVATE_ADMIN_REASON/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /tp-grade-deduction/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /خُصمت فرصتان/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /غياب/);
  const withoutExams = selectHtmlReportExams({ s1: details }, []);
  assert.deepEqual(withoutExams.s1.timelineEvents, details.timelineEvents);
  assert.equal(JSON.stringify(profile), before, "الرصيد والدرجات والسجل لا تتغير أثناء العرض");
});

check("إضافة الإدارة تظهر كسطر مؤرخ بعد الامتحان دون إخفاء خصمه الصحيح", () => {
  const exam = { id: "deducted-exam", name: "امتحان", date: "2026-09-12", fullMark: 50 };
  const profile = {
    student: { name: studentList[0].name, status: "نشط", opportunities: 3, opportunityLimit: 3 },
    currentChapter: { id: "current", name: "الفصل الحالي", since: "2026-09-01", examIds: [exam.id] },
    grades: [{ id: "unsettled-grade", examId: exam.id, status: "درجة", score: 2 }],
    exams: [exam],
    opportunityLogs: [
      { action: "خصم تلقائي", amount: 1, examId: exam.id, chapterId: "current", date: exam.date },
      { action: "إضافة", amount: 2, appliedAmount: 2, ledgerVersion: 2, chapterId: "current", date: "2026-09-13T13:10:31.636Z", reason: "تسوية" },
    ],
  };
  const details = buildStudentDetailsFromProfileLog(profile);
  assert.equal(details.grades[0].opportunityEffect, "خُصمت فرصة");
  const sanitized = sanitizeStudentDetailsForHtml({ s1: details });
  assert.deepEqual(sanitizeStudentDetailsForHtml(sanitized), sanitized);
  const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: sanitized });
  const { dom } = executeInlineScripts(html, "manual-grant-report");
  openStudentDetails(dom, "s1", studentList[0].name);
  assert.doesNotMatch(dom.elements.tpStudentOverview.innerHTML, /أضافت الإدارة|13 سبتمبر 2026/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /أضافت الإدارة فرصتين/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /13 سبتمبر 2026/);
  assert.match(dom.elements.tpGradesBody.innerHTML, /tp-grade-deduction/);
  assert.match(dom.elements.tpStudentOverview.innerHTML, /<strong>3<\/strong>/);
});

function renderedTimeline(profile, label) {
  const details = buildStudentDetailsFromProfileLog(profile);
  const html = buildHtml(rows, columns, "تقرير", { studentList, studentDetails: { s1: details } });
  const run = executeInlineScripts(html, label);
  openStudentDetails(run.dom, "s1");
  const rendered = run.dom.elements.tpGradesBody.innerHTML;
  const sequence = [...rendered.matchAll(/<tr\b[^]*?<\/tr>/g)].map(([row]) => {
    const eventDate = row.match(/<time datetime="([^"]+)"/)?.[1];
    return eventDate ? `event:${eventDate}` : row.match(/class="tp-event-title">([^<]+)/)?.[1];
  }).filter(Boolean);
  return { details, html, ...run, rendered, sequence };
}

check("الحركات تظهر قبل الامتحان وبين الامتحانات وبعدها بوقت دقيق والتعهد المزدوج صف واحد", () => {
  const exams = [
    { id: "first", name: "الامتحان الأول", date: "2026-09-01T08:00:00.000Z", fullMark: 20 },
    { id: "second", name: "الامتحان الثاني", date: "2026-09-01T12:00:00.000Z", fullMark: 20 },
    { id: "third", name: "الامتحان الثالث", date: "2026-09-02T08:00:00.000Z", fullMark: 20 },
  ];
  const profile = {
    student: { status: "نشط", opportunities: 1 },
    currentChapter: { id: "timeline", name: "الفصل الحالي", since: "2026-09-01", examIds: exams.map(exam => exam.id) },
    exams, allCourseExams: exams,
    grades: exams.map(exam => ({ id: `grade-${exam.id}`, examId: exam.id, status: "درجة", score: 18, createdAt: exam.date })),
    // Deliberately reverse several commands: presentation must order their
    // exact timestamps and must not throw away credits before the latest reset.
    opportunityLogs: [
      { action: "رصيد إعادة التفعيل", amount: 1, balanceAfter: 1, ledgerVersion: 2, settledGradeIds: JSON.stringify(exams.map(exam => `grade-${exam.id}`)), date: "2026-09-03T07:00:00.000Z", reason: "PRIVATE_LATEST_RESTORE" },
      { action: "إضافة", amount: 1, appliedAmount: 1, balanceAfter: 1, date: "2026-09-01T07:00:00.000Z", reason: "PRIVATE_FIRST_CREDIT" },
      { action: "إعادة تفعيل", amount: 0, balanceAfter: 2, date: "2026-09-01T10:00:00.000Z", reason: "تم تعهد الطالب" },
      { action: "رصيد إعادة التفعيل", amount: 2, balanceAfter: 2, ledgerVersion: 2, date: "2026-09-01T10:00:00.001Z", reason: "تم تعهد الطالب PRIVATE_PLEDGE" },
      { action: "إضافة", amount: 2, appliedAmount: 1, balanceAfter: 3, date: "2026-09-01T14:00:00.000Z", reason: "PRIVATE_LATER_CREDIT" },
      { action: "إضافة", amount: 3, appliedAmount: 0, balanceAfter: 3, date: "2026-09-01T15:00:00.000Z", reason: "PRIVATE_ZERO_CREDIT" },
    ].map(log => ({ chapterId: "timeline", ...log })),
  };
  const before = JSON.stringify(profile);
  const { details, sequence, rendered, html, dom } = renderedTimeline(profile, "all-credit-positions");
  assert.deepEqual(sequence, [
    "event:2026-09-01T07:00:00.000Z", "الامتحان الأول",
    "event:2026-09-01T10:00:00.001Z", "الامتحان الثاني",
    "event:2026-09-01T14:00:00.000Z", "الامتحان الثالث",
    "event:2026-09-03T07:00:00.000Z",
  ]);
  assert.equal(details.timelineEvents.length, 4, "one row per actual grant; paired status and zero-applied credits add none");
  assert.match(details.timelineEvents[1].text, /التعهّد.*برصيد فرصتين/);
  assert.match(details.timelineEvents[2].text, /أضافت الإدارة فرصة واحدة.*أصبح الرصيد 3/);
  assert.match(details.timelineEvents[3].text, /أُعيد تفعيلك برصيد فرصة واحدة/);
  assert.equal((rendered.match(/class="tp-timeline-event /g) || []).length, 4);
  assert.equal((rendered.match(/<td colspan="4" role="cell">/g) || []).length, 4);
  assert.match(html, /\.tp-details-table tr\.tp-timeline-event > td \{ display: block;/, "event notice remains one full-width accessible row on mobile");
  assert.doesNotMatch(dom.elements.tpStudentOverview.innerHTML, /تعهد|التعهّد|أضافت|أُعيد|tp-balance-note|tp-pledge-note/);
  assert.doesNotMatch(html, /PRIVATE_/);
  assert.equal(JSON.stringify(profile), before, "export is a read-only history projection");

  const noExams = selectHtmlReportExams({ s1: details }, []);
  assert.deepEqual(noExams.s1.timelineEvents, details.timelineEvents, "hiding exams cannot remove any credit or restore");
  const selectedRun = executeInlineScripts(buildHtml(rows, columns, "تقرير", { studentList, studentDetails: noExams }), "credits-without-exams");
  openStudentDetails(selectedRun.dom, "s1");
  assert.equal((selectedRun.dom.elements.tpGradesBody.innerHTML.match(/class="tp-timeline-event /g) || []).length, 4);
  assert.equal(labelsFromRenderedCells(selectedRun.dom.elements.tpGradesBody.innerHTML).length, 0);
});

check("الإدخال المتأخر بعد الإضافة يظهر بعدها مع بقاء تاريخ الامتحان والتعديل اللاحق لا يغيّر التسلسل", () => {
  const exams = [
    { id: "late", name: "غياب أُدخل بعد المنح", date: "2026-09-01T08:00:00.000Z", fullMark: 20 },
    { id: "edited", name: "درجة عُدّلت لاحقاً", date: "2026-09-01T09:00:00.000Z", fullMark: 20 },
    { id: "same", name: "نتيجة بوقت المنح", date: "2026-09-01T09:30:00.000Z", fullMark: 20 },
  ];
  const profile = {
    student: { opportunities: 2, status: "نشط" },
    currentChapter: { id: "timeline", name: "الفصل الحالي", since: null, examIds: exams.map(exam => exam.id) },
    exams, allCourseExams: exams,
    grades: [
      { id: "late-grade", examId: "late", status: "غائب", createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-02T16:00:00Z" },
      { id: "edited-grade", examId: "edited", status: "درجة", score: 18, createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-02T17:00:00Z" },
      { id: "same-grade", examId: "same", status: "درجة", score: 18, createdAt: "2026-09-01T10:00:00.000Z" },
    ],
    opportunityLogs: [
      { action: "إضافة", amount: 3, appliedAmount: 3, balanceBefore: 0, balanceAfter: 3, chapterId: "timeline", ledgerVersion: 2, date: "2026-09-01T10:00:00.000Z" },
      { action: "خصم تلقائي", amount: 1, appliedAmount: 1, examId: "late", chapterId: "timeline", date: exams[0].date },
    ],
  };
  const { details, sequence, rendered } = renderedTimeline(profile, "late-entry-credit-order");
  assert.deepEqual(sequence, ["درجة عُدّلت لاحقاً", "event:2026-09-01T10:00:00.000Z", "نتيجة بوقت المنح", "غياب أُدخل بعد المنح"]);
  const late = details.grades.find(grade => grade.examId === "late");
  const edited = details.grades.find(grade => grade.examId === "edited");
  assert.equal(late.examDate, exams[0].date);
  assert.equal(late.timelineDate, profile.grades[0].createdAt);
  assert.equal(edited.timelineDate, exams[1].date, "updatedAt is never a financial ordering timestamp");
  assert.doesNotMatch(rendered, /سُجّلت النتيجة|tp-recorded-date/);
  const examDateCells = [...rendered.matchAll(/data-label="تاريخ الامتحان"[^]*?tp-mobile-field-value">([^]*?)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(examDateCells, ["1 سبتمبر 2026", "1 سبتمبر 2026", "1 سبتمبر 2026"], "exam rows display only the original exam date while timeline ordering remains intact");
  assert.match(rendered, /خُصمت فرصة/);
  assert.doesNotMatch(rendered, /2 سبتمبر/);
});

check("حالة خصم فرصتين ثم غياب ثم فصل تبقى بتاريخها بعد الاستعادة بفرصة واحدة", () => {
  const exams = [
    { id: "old-final", name: "امتحان تراكمي مسجل في الفصل الحالي", type: "تراكمي", date: "2026-09-12T00:00:00Z", fullMark: 100, passMark: 50 },
    { id: "absence-1", name: "الامتحان الأول", type: "يومي", date: "2026-09-16T00:00:00Z", fullMark: 20 },
    { id: "passing", name: "الامتحان الثاني", type: "تراكمي", date: "2026-09-19T00:00:00Z", fullMark: 50, passMark: 25 },
    { id: "absence-2", name: "الامتحان الثالث", type: "يومي", date: "2026-09-23T00:00:00Z", fullMark: 20 },
  ];
  const grades = [
    { id: "g-final", examId: "old-final", status: "درجة", score: 28, createdAt: "2026-09-15T13:22:00Z" },
    { id: "g-a1", examId: "absence-1", status: "غائب", score: null, createdAt: "2026-09-19T05:51:00Z" },
    { id: "g-pass", examId: "passing", status: "درجة", score: 45, createdAt: "2026-09-20T14:45:00Z" },
    { id: "g-a2", examId: "absence-2", status: "غائب", score: null, createdAt: "2026-09-25T18:35:00Z" },
  ];
  const profile = {
    student: { opportunities: 1, status: "نشط" },
    currentChapter: { id: "third", name: "الفصل الثالث", since: "2026-09-13T13:22:00Z", examIds: exams.map(exam => exam.id) },
    exams, allCourseExams: exams, grades,
    opportunityLogs: [
      { action: "إعادة تعيين", amount: 3, balanceAfter: 3, ledgerVersion: 2, settledGradeIds: "[]", date: "2026-09-13T13:22:00Z", reason: "انتقال فصل" },
      { action: "خصم تلقائي", amount: 2, appliedAmount: 2, examId: "old-final", date: exams[0].date },
      { action: "خصم تلقائي", amount: 1, appliedAmount: 1, examId: "absence-1", date: exams[1].date },
      { action: "فصل تلقائي", amount: 0, examId: "absence-2", date: exams[3].date },
      { action: "إعادة تفعيل", amount: 0, balanceAfter: 1, date: "2026-09-26T12:41:00Z", reason: "PRIVATE_CORRECTION" },
      { action: "رصيد إعادة التفعيل", amount: 1, balanceAfter: 1, ledgerVersion: 2, settledGradeIds: JSON.stringify(grades.map(grade => grade.id)), date: "2026-09-26T12:41:00Z", reason: "PRIVATE_CORRECTION" },
    ].map(log => ({ chapterId: "third", ...log })),
  };
  const { details, dom, rendered, sequence, html } = renderedTimeline(profile, "restore-one-complete-history");
  assert.deepEqual(details.grades.map(grade => grade.opportunityEffect), ["خُصمت فرصتان", "خُصمت فرصة", "لا خصم", "سُجّل فصل بسبب هذا الامتحان"]);
  assert.deepEqual(sequence, [
    "event:2026-09-13T13:22:00Z", exams[0].name, exams[1].name, exams[2].name, exams[3].name,
    "event:2026-09-26T12:41:00Z",
  ]);
  assert.equal(details.timelineEvents.length, 2);
  assert.match(dom.elements.tpStudentOverview.innerHTML, /<strong>1<\/strong>/);
  assert.equal(dom.elements.tpModalDismissedBadge.style.display, "none", "historical dismissal never marks the currently active student dismissed");
  assert.match(rendered, /أُعيد تفعيلك برصيد فرصة واحدة/);
  assert.match(rendered, /tp-grade-row-dismissed/);
  assert.doesNotMatch(html, /لا خصم \(قبل رصيدك الجديد\)|PRIVATE_CORRECTION|تم منح الطالب فرصتين بسبب تعهده/);
});

// Recreate the previous wire payload and its snapshot-based balance read. All
// other rendering is unchanged, isolating the impact of the public data boundary.
function legacyReportPayload(list, details) {
  const reportDetails = sanitizeStudentDetailsForHtml(details);
  return {
    details: reportDetails,
    students: list.map(student => {
      const snapshot = reportDetails[student.id]?.studentSnapshot;
      return snapshot ? {
        id: student.id, name: snapshot.name || student.name, code: snapshot.code,
        courseName: snapshot.courseName || student.courseName,
        opportunities: snapshot.opportunities, status: snapshot.status,
      } : student;
    }),
  };
}

function injectReportPayload(html, { details, students }) {
  const safeJson = value => JSON.stringify(value)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  let result = html;
  for (const [key, data] of [["STUDENT_DETAILS", details], ["STUDENT_LIST", students]]) {
    const pattern = new RegExp(`<script>window\\.${key}=[\\s\\S]*?;</script>`);
    assert.ok(pattern.test(result), `missing ${key} payload assignment`);
    result = result.replace(pattern, () => `<script>window.${key}=${safeJson(data)};</script>`);
  }
  const currentBalanceRead = "    var balance = student.opportunities;\n    var status = student.status;";
  const legacyBalanceRead = "    var snapshot = data && data.studentSnapshot;\n    var balance = snapshot ? snapshot.opportunities : student.opportunities;\n    var status = snapshot ? snapshot.status : student.status;";
  assert.ok(result.includes(currentBalanceRead), "renderer balance read changed; update the legacy equivalence fixture explicitly");
  result = result.replace(currentBalanceRead, legacyBalanceRead);
  return result;
}

function privatePayloadFixture() {
  const grades = [
    { status: "درجة", score: 0, opportunityTone: "ordinary", opportunityEffect: "لا خصم" },
    { status: "مجاز", score: null, opportunityTone: "excused", opportunityEffect: "لا خصم" },
    { status: "مجاز — فترة سماح", score: null, opportunityTone: "excused", opportunityEffect: "بدون خصم (فترة سماح لغاية 10-9-2026)" },
    { status: "غائب", score: null, opportunityTone: "deducted", opportunityEffect: "خُصمت فرصة" },
    { status: "غش", score: null, opportunityTone: "dismissed", opportunityEffect: "خُصمت فرصتان. سُجّل فصل بسبب هذا الامتحان" },
    { status: "درجة معلّقة", score: null, opportunityTone: "ordinary", opportunityEffect: "—" },
  ].map((grade, index) => ({
    ...grade,
    examName: `امتحان ظاهر ${index + 1}`, examType: "تراكمي", examDate: `2026-09-0${index + 1}`,
    fullMark: 20, examId: `PRIVATE_EXAM_ID_${index}`, passMark: 11,
    outcome: "PRIVATE_HIDDEN_OUTCOME", notes: "PRIVATE_GRADE_NOTE", futurePrivateGradeField: "PRIVATE_FUTURE_GRADE_FIELD",
  }));
  const details = {
    activeChapterName: "الفصل الظاهر", activeChapterSince: "1999-01-01T01:23:45Z",
    generatedAt: "1999-02-02T02:34:56Z", hasTwoOpportunityPledge: true,
    balanceNotes: [{ text: "PRIVATE_OLD_BALANCE_NOTE", date: "2026-09-11" }],
    timelineEvents: [{ text: "أضافت الإدارة فرصتين", date: "2026-09-11", kind: "add", balanceAfter: 2, id: "PRIVATE_EVENT_ID", reason: "PRIVATE_BALANCE_REASON", futurePrivateNoteField: "PRIVATE_FUTURE_NOTE_FIELD" }],
    studentSnapshot: {
      name: "محمد علي جديد", code: "BIO-NEW", courseName: "الدورة الجديدة", status: "مفصول", opportunities: 0,
      opportunityLimit: 3, registeredAt: "1999-03-03T03:45:56Z", phone: "PRIVATE_SNAPSHOT_PHONE", futurePrivateSnapshotField: "PRIVATE_FUTURE_SNAPSHOT_FIELD",
    },
    grades,
    opportunityLogs: [
      { action: "خصم", amount: 2, reason: "PRIVATE_ADMIN_REASON", date: "2026-09-05", examName: grades[4].examName, balanceBefore: 2, balanceAfter: 0 },
      { action: "فصل", amount: 0, reason: "PRIVATE_DISMISSAL_REASON", date: "2026-09-05", examName: grades[4].examName },
    ],
    futurePrivateDetailsField: "PRIVATE_FUTURE_DETAILS_FIELD",
  };
  const first = { id: "s1", name: "محمد علي قديم", code: "BIO-OLD", courseName: "الدورة القديمة", status: "نشط", opportunities: 3, phone: "PRIVATE_LIST_PHONE", futurePrivateListField: "PRIVATE_FUTURE_LIST_FIELD" };
  const fallback = { ...first, id: "s2", name: "محمد علي جديد", code: "BIO-FALLBACK", opportunities: 2 };
  const nullBalance = { ...first, id: "s3", name: "محمد علي فارغ", code: "BIO-EMPTY" };
  const missing = { ...first, id: "s4", name: "محمد علي ناقص", code: "BIO-MISSING" };
  const fallbackDetails = { ...details, studentSnapshot: undefined, hasTwoOpportunityPledge: false, balanceNotes: [], timelineEvents: [], grades: [] };
  return {
    list: [first, fallback, nullBalance, missing],
    details: {
      s1: details,
      s2: fallbackDetails,
      s3: { ...fallbackDetails, studentSnapshot: { ...details.studentSnapshot, name: "", courseName: "", opportunities: null, status: "نشط" } },
      "PRIVATE_ORPHAN_ID": { ...details, activeChapterName: "PRIVATE_ORPHAN_CHAPTER" },
    },
  };
}

check("ملف HTML ينقل حقول العرض حصراً ويحذف السجل والحقول الخاصة والطلاب خارج قائمة التصدير", () => {
  const fixture = privatePayloadFixture();
  const original = JSON.stringify(fixture);
  const html = buildHtml(rows, columns, "تقرير", { studentList: fixture.list, studentDetails: fixture.details });
  const { sandbox } = executeInlineScripts(html, "public-payload-whitelist");
  const publicDetails = JSON.parse(JSON.stringify(sandbox.STUDENT_DETAILS));
  const publicStudents = JSON.parse(JSON.stringify(sandbox.STUDENT_LIST));
  const detailKeys = ["activeChapterName", "timelineEvents", "grades"].sort();
  const gradeKeys = ["examName", "examType", "examDate", "timelineDate", "score", "fullMark", "status", "opportunityEffect", "opportunityTone"].sort();
  const studentKeys = ["id", "name", "code", "courseName", "opportunities", "status"].sort();
  assert.deepEqual(Object.keys(publicDetails).sort(), ["s1", "s2", "s3"]);
  for (const detail of Object.values(publicDetails)) {
    assert.deepEqual(Object.keys(detail).sort(), detailKeys);
    for (const grade of detail.grades) assert.deepEqual(Object.keys(grade).sort(), gradeKeys);
    for (const event of detail.timelineEvents) assert.deepEqual(Object.keys(event).sort(), ["balanceAfter", "date", "kind", "text"]);
  }
  for (const student of publicStudents) assert.deepEqual(Object.keys(student).sort(), studentKeys);
  assert.equal(publicStudents[0].opportunities, 0);
  assert.equal(publicStudents[0].status, "مفصول");
  assert.equal(publicStudents[0].name, "محمد علي جديد");
  assert.equal(publicStudents[0].courseName, "الدورة الجديدة");
  assert.equal(publicStudents[1].opportunities, 2, "no snapshot keeps the list balance without leaking its private fields");
  assert.equal(publicStudents[2].opportunities, null, "null snapshot balance must not fall back to a stale balance");
  assert.equal(publicStudents[2].name, fixture.list[2].name, "empty snapshot names retain existing fallback semantics");
  assert.equal(publicStudents[2].courseName, fixture.list[2].courseName);
  assert.doesNotMatch(html, /PRIVATE_|1999-01-01T01:23:45Z|1999-02-02T02:34:56Z|1999-03-03T03:45:56Z/);
  const wireData = JSON.stringify({ details: publicDetails, students: publicStudents });
  assert.doesNotMatch(wireData, /"(?:opportunityLogs|studentSnapshot|passMark|registeredAt|generatedAt|activeChapterSince|examId|outcome|notes|reason)"/);
  assert.equal(JSON.stringify(fixture), original, "preparing a public file must not mutate the full internal snapshot");
});

function renderedReportState(dom) {
  return Object.fromEntries(Object.entries(dom.elements).map(([id, element]) => [id, {
    html: element.innerHTML, text: element.textContent, value: element.value,
    display: element.style.display ?? null,
    ariaExpanded: element.getAttribute("aria-expanded"), ariaHidden: element.getAttribute("aria-hidden"),
    open: element.classList.contains("open"), visible: element.classList.contains("visible"),
  }]));
}

check("حذف البيانات غير المعروضة لا يغيّر البحث أو البطاقات أو الحالات أو الألوان أو التفاصيل", () => {
  const fixture = privatePayloadFixture();
  const compact = buildHtml(rows, columns, "تقرير", { studentList: fixture.list, studentDetails: fixture.details });
  const legacy = injectReportPayload(compact, legacyReportPayload(fixture.list, fixture.details));
  const currentRun = executeInlineScripts(compact, "compact-render-equivalence");
  const legacyRun = executeInlineScripts(legacy, "legacy-render-equivalence");
  const compare = label => assert.deepEqual(renderedReportState(currentRun.dom), renderedReportState(legacyRun.dom), label);
  compare("initial UI");
  for (const query of ["محمد", "مُحَمَّد علي", "اسم غير موجود", ""]) {
    for (const run of [currentRun, legacyRun]) {
      run.dom.elements.tpStudentSearch.value = query;
      run.dom.elements.tpStudentSearch.dispatch("input", {});
    }
    compare(`search: ${query}`);
  }
  for (let index = 0; index < fixture.list.length; index += 1) {
    for (const run of [currentRun, legacyRun]) {
      run.dom.elements.tpStudentSearch.value = "محمد علي";
      run.dom.elements.tpStudentSearch.dispatch("input", {});
    }
    compare(`suggestions including duplicate names before choice ${index}`);
    for (const run of [currentRun, legacyRun]) clickFirstSuggestion(run.dom, index);
    compare(`student ${index}: card, overview, title, dismissal badge, grades and tones`);
  }
  for (const selection of [["PRIVATE_EXAM_ID_0", "PRIVATE_EXAM_ID_4"], []]) {
    const details = selectHtmlReportExams(fixture.details, selection);
    const compactSelected = buildHtml(rows, columns, "تقرير", { studentList: fixture.list, studentDetails: details });
    const legacySelected = injectReportPayload(compactSelected, legacyReportPayload(fixture.list, details));
    const compactRun = executeInlineScripts(compactSelected, "compact-selected");
    const originalRun = executeInlineScripts(legacySelected, "legacy-selected");
    for (const run of [compactRun, originalRun]) openStudentDetails(run.dom, "s1", "محمد علي جديد");
    assert.deepEqual(renderedReportState(compactRun.dom), renderedReportState(originalRun.dom), `selected exams: ${selection}`);
  }
  // No fetch/network API exists in this harness: all displayed details above are
  // resolved entirely from the public payload, including after exam selection.
});

check("قياس تقرير اصطناعي من 400 طالب يثبت انخفاض حجم البيانات والملف الكامل", () => {
  const fixture = privatePayloadFixture();
  const list = [];
  const details = {};
  for (let index = 0; index < 400; index += 1) {
    const id = `synthetic-${index}`;
    list.push({ ...fixture.list[0], id });
    details[id] = {
      ...fixture.details.s1,
      opportunityLogs: Array.from({ length: 24 }, (_, logIndex) => ({
        action: "خصم", amount: 1, appliedAmount: 1, balanceBefore: 3, balanceAfter: 2,
        reason: `PRIVATE_ADMIN_HISTORY_${index}_${logIndex} — سبب إداري محفوظ للمراجعة والتدقيق في سجل النظام فقط`,
        date: "2026-09-05", examName: "امتحان التدقيق", examId: `history-exam-${logIndex}`,
      })),
    };
  }
  const html = buildHtml(rows, columns, "تقرير", { studentList: list, studentDetails: details });
  const legacyPayload = legacyReportPayload(list, details);
  const legacyHtml = injectReportPayload(html, legacyPayload);
  const { sandbox } = executeInlineScripts(html, "synthetic-400-students");
  const compactPayload = { details: sandbox.STUDENT_DETAILS, students: sandbox.STUDENT_LIST };
  const metrics = {
    students: 400, syntheticFixture: true,
    payloadBeforeBytes: Buffer.byteLength(JSON.stringify(legacyPayload), "utf8"),
    payloadAfterBytes: Buffer.byteLength(JSON.stringify(compactPayload), "utf8"),
    fileBeforeBytes: Buffer.byteLength(legacyHtml, "utf8"),
    fileAfterBytes: Buffer.byteLength(html, "utf8"),
  };
  assert.equal(sandbox.STUDENT_LIST.length, 400);
  assert.equal(Object.keys(sandbox.STUDENT_DETAILS).length, 400);
  assert.ok(metrics.payloadAfterBytes < metrics.payloadBeforeBytes);
  assert.ok(metrics.fileAfterBytes < metrics.fileBeforeBytes);
  assert.doesNotMatch(html, /PRIVATE_ADMIN_HISTORY/);
  console.log(`   Synthetic payload size comparison: ${JSON.stringify(metrics)}`);
});

if (failures > 0) {
  console.error(`\nفشل ${failures} من اختبارات HTML السلوكية لإدارة الفرص.`);
  process.exit(1);
}

console.log("\nكل اختبارات HTML السلوكية لإدارة الفرص نجحت.");
