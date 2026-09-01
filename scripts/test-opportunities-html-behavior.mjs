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
    "tpDetailsModal",
    "tpModalTitleText",
    "tpModalDismissedBadge",
    "tpGradesSectionTitle",
    "tpGradesBody",
    "tpLogsBody",
    "tpLogsSection",
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

const { buildHtml } = loadExportDialogModule();

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
    "النوع",
    "التاريخ",
    "الدرجة",
    "الامتحان من",
    "الحالة",
  ]);
  assert.ok(dom.elements.tpDetailsModal.classList.contains("open"));
});

check("سجل الفرص يعرض الحركة والعدد المسجل بدون الادعاء بأنه فقدان فعلي", () => {
  const table = validHtml.match(
    /<table\b(?=[^>]*\btp-logs-table\b)[^>]*>([\s\S]*?)<\/table>/,
  );
  assert.ok(table, "movement table is missing");
  const headers = [...table[1].matchAll(/<th\b[^>]*>([^<]+)<\/th>/g)].map(
    (match) => match[1].trim(),
  );
  assert.deepEqual(headers, [
    "نوع الحركة",
    "السبب",
    "العدد المسجل",
    "تاريخ الحركة",
    "الامتحان",
  ]);
  assert.match(validHtml, /<h3>سجل حركات الفرص<\/h3>/);
  assert.doesNotMatch(validHtml, /سجل فقدان الفرص|عدد الفرص المفقودة|تاريخ الفقدان/);

  const { dom } = executeInlineScripts(validHtml, "opportunities-movements");
  openStudentDetails(dom, "s1", "محمد علي حسن");
  const movementHtml = dom.elements.tpLogsBody.innerHTML;
  assert.deepEqual(labelsFromRenderedCells(movementHtml), [
    "نوع الحركة",
    "السبب",
    "العدد المسجل",
    "تاريخ الحركة",
    "الامتحان",
    "نوع الحركة",
    "السبب",
    "العدد المسجل",
    "تاريخ الحركة",
    "الامتحان",
  ]);
  assert.match(
    movementHtml,
    /data-label="نوع الحركة"[\s\S]*?class="tp-mobile-field-value">خصم<\/span>/,
  );
  assert.match(
    movementHtml,
    /data-label="نوع الحركة"[\s\S]*?class="tp-mobile-field-value">إضافة<\/span>/,
  );
  assert.match(
    movementHtml,
    /data-label="العدد المسجل"[\s\S]*?class="tp-mobile-field-value">4<\/span>/,
  );
  assert.match(
    movementHtml,
    /data-label="العدد المسجل"[\s\S]*?class="tp-mobile-field-value">7<\/span>/,
  );
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

if (failures > 0) {
  console.error(`\nفشل ${failures} من اختبارات HTML السلوكية لإدارة الفرص.`);
  process.exit(1);
}

console.log("\nكل اختبارات HTML السلوكية لإدارة الفرص نجحت.");
