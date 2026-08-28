#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (relativeFile) =>
  fs.readFileSync(path.join(root, relativeFile), "utf8");

function createTypeScriptLoader(mocks = new Map()) {
  const cache = new Map();

  function resolveLocalFile(specifier, parentFile) {
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : path.resolve(path.dirname(parentFile), specifier);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
      path.join(base, "index.js"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  function load(absoluteFile) {
    const normalizedFile = path.resolve(absoluteFile);
    if (cache.has(normalizedFile)) return cache.get(normalizedFile).exports;

    const source = fs.readFileSync(normalizedFile, "utf8");
    const compiled = ts.transpileModule(source, {
      fileName: normalizedFile,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;

    const moduleRecord = { exports: {} };
    cache.set(normalizedFile, moduleRecord);
    const localRequire = (specifier) => {
      if (mocks.has(specifier)) return mocks.get(specifier);
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const resolved = resolveLocalFile(specifier, normalizedFile);
        if (resolved) return load(resolved);
      }
      return require(specifier);
    };
    const execute = new Function(
      "exports",
      "require",
      "module",
      "__filename",
      "__dirname",
      compiled,
    );
    execute(
      moduleRecord.exports,
      localRequire,
      moduleRecord,
      normalizedFile,
      path.dirname(normalizedFile),
    );
    return moduleRecord.exports;
  }

  return (relativeFile) => load(path.join(root, relativeFile));
}

class FakeNextResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = init.headers ?? {};
  }

  static json(body, init = {}) {
    return new FakeNextResponse(body, init);
  }
}

function createDatabaseMock(options = {}) {
  const calls = [];
  const rows = options.rows || {};
  const models = new Map();

  const model = (modelName) => {
    if (models.has(modelName)) return models.get(modelName);
    const value = new Proxy(
      {},
      {
        get(_target, methodName) {
          return async (...args) => {
            const key = `${modelName}.${String(methodName)}`;
            calls.push({ key, args });
            if (options.throwOn === key) throw options.error;
            if (Object.hasOwn(rows, key)) {
              const configured = rows[key];
              return typeof configured === "function"
                ? configured(...args)
                : configured;
            }
            if (String(methodName) === "count") return 0;
            if (String(methodName) === "aggregate") return { _count: 0 };
            if (String(methodName) === "groupBy") return [];
            if (String(methodName).startsWith("findUnique")) return null;
            if (String(methodName).startsWith("findFirst")) return null;
            return [];
          };
        },
      },
    );
    models.set(modelName, value);
    return value;
  };

  const db = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "$transaction") {
          return async (...args) => {
            const work = args[0];
            calls.push({ key: "$transaction", args });
            if (typeof work === "function") return work(db);
            return Promise.all(work);
          };
        }
        if (property === "$queryRaw" || property === "$queryRawUnsafe") {
          return async (...args) => {
            const key = String(property);
            calls.push({ key, args });
            if (options.throwOn === key) throw options.error;
            return Object.hasOwn(rows, key) ? rows[key] : [];
          };
        }
        return model(String(property));
      },
    },
  );

  return { db, calls };
}

function loadStatsRoute({ principalResult, database }) {
  const permissions = [];
  const loader = createTypeScriptLoader(
    new Map([
      ["next/server", { NextResponse: FakeNextResponse }],
      ["@/lib/db", { db: database.db }],
      [
        "@/lib/server-auth",
        {
          requirePermissionPrincipal: async (_request, permission) => {
            permissions.push(permission);
            return principalResult;
          },
          hasPermission: (principal, permission) =>
            Boolean(
              principal?.isAdmin ||
                principal?.permissions?.includes(permission),
            ),
        },
      ],
    ]),
  );
  return {
    route: loader("src/app/api/stats/route.ts"),
    permissions,
  };
}

test("dashboard stats rejects a principal without system.dashboard before database access", async () => {
  const forbidden = FakeNextResponse.json(
    { error: "ليست لديك صلاحية لتنفيذ هذه العملية." },
    { status: 403 },
  );
  const database = createDatabaseMock();
  const { route, permissions } = loadStatsRoute({
    principalResult: forbidden,
    database,
  });

  const response = await route.GET({});

  assert.equal(response, forbidden);
  assert.deepEqual(permissions, ["system.dashboard"]);
  assert.equal(database.calls.length, 0);
});

test("dashboard grade policy excludes protected and unavailable cases", () => {
  const loader = createTypeScriptLoader();
  const policy = loader("src/lib/dashboard-stats.ts");
  const exam = {
    id: "exam-past",
    active: true,
    date: "2026-07-01",
    fullMark: 100,
  };
  const student = {
    id: "student-1",
    createdAt: "2026-01-01",
    accountingGraceDays: 0,
  };
  const missing = (overrides = {}) =>
    policy.isDashboardGradeMissing({
      grade: null,
      exam,
      student,
      leaves: [],
      ...overrides,
    });

  assert.equal(missing(), true, "an eligible past exam without a grade is missing");
  for (const status of [
    "مجاز",
    "ضمن فترة السماح",
    "قبل تسجيل الطالب",
    "غائب",
    "غش",
  ]) {
    assert.equal(
      missing({ grade: { status, score: null } }),
      false,
      `${status} is an entered state`,
    );
  }
  assert.equal(
    missing({
      student: { ...student, createdAt: "2026-07-10" },
    }),
    false,
    "an exam before registration is not missing",
  );
  assert.equal(
    missing({
      student: {
        ...student,
        createdAt: "2026-06-29",
        accountingGraceDays: 5,
      },
    }),
    false,
    "an exam inside the grace period is not missing",
  );
  assert.equal(
    missing({
      leaves: [{
        studentId: student.id,
        examId: exam.id,
        leaveType: "exam",
        date: exam.date,
      }],
    }),
    false,
    "an excused exam is not missing",
  );
  assert.equal(
    missing({ exam: { ...exam, date: "2999-01-01" } }),
    false,
    "a future exam is not missing",
  );
  assert.equal(
    missing({
      exam: {
        ...exam,
        scheduledActivateAt: "2999-01-01T09:00:00.000Z",
      },
    }),
    false,
    "a future scheduled activation is not missing",
  );
});

test("dashboard chapter and pledge policies keep conflicts and historical pledges distinct", () => {
  const loader = createTypeScriptLoader();
  const policy = loader("src/lib/dashboard-stats.ts");

  const chapterHealth = policy.getActiveChapterHealth([
    { id: "chapter-link-a", courseId: "course-a", active: true, archived: false },
    { id: "chapter-link-b", courseId: "course-a", active: true, archived: false },
    { id: "chapter-link-c", courseId: "course-b", active: true, archived: false },
    { id: "chapter-link-d", courseId: "course-c", active: false, archived: false },
  ]);
  const conflictCourseIds =
    chapterHealth.conflictCourseIds || chapterHealth.conflicts || [];
  const activeCourseIds =
    chapterHealth.healthyCourseIds ||
    chapterHealth.activeCourseIds ||
    chapterHealth.active ||
    [];
  assert.ok(
    Array.from(conflictCourseIds).includes("course-a"),
    "two active links are reported as a conflict",
  );
  assert.ok(
    Array.from(activeCourseIds).includes("course-b"),
    "one active link is healthy",
  );

  const currentDismissal = {
    key: "dismissal-current",
    sourceType: "opportunity-log",
    sourceId: "log-current",
    type: "فصل",
    reason: "نفاد الفرص",
    date: "2026-07-01",
  };
  assert.equal(
    policy.pledgeMatchesCurrentDismissal(
      { dismissalKey: "dismissal-current" },
      currentDismissal,
    ),
    true,
  );
  assert.equal(
    policy.pledgeMatchesCurrentDismissal(
      { dismissalKey: "dismissal-old" },
      currentDismissal,
    ),
    false,
    "a pledge for an older dismissal cannot hide the current one",
  );
});

test("dashboard audit payload is human-readable and does not expose raw identifiers", () => {
  const loader = createTypeScriptLoader();
  const policy = loader("src/lib/dashboard-stats.ts");
  const safe = policy.sanitizeDashboardAuditLog({
    id: "audit-1",
    action: "student_update",
    module: "student_registry",
    details: JSON.stringify({
      studentId: "student-secret-id",
      examId: "exam-secret-id",
      code: "P2022",
    }),
    user: "admin",
    userName: "مدير النظام",
    time: new Date("2026-07-01T09:00:00.000Z"),
  });
  const serialized = JSON.stringify(safe);

  assert.doesNotMatch(serialized, /student-secret-id|exam-secret-id|P2022/);
  assert.ok(
    safe.display || safe.summary || safe.actionLabel,
    "a human-readable display value is returned",
  );
});

test("stats route uses one read snapshot, gates logs.view, and sanitizes failures", async () => {
  const rawLog = {
    id: "log-1",
    action: "student_update",
    module: "student_registry",
    details: '{"studentId":"internal-student-id"}',
    user: "admin",
    userName: "مدير النظام",
    time: new Date("2026-07-01T09:00:00.000Z"),
  };
  const database = createDatabaseMock({
    rows: { "auditLog.findMany": [rawLog] },
  });
  const { route } = loadStatsRoute({
    principalResult: {
      id: "user-1",
      isAdmin: false,
      permissions: ["system.dashboard"],
    },
    database,
  });
  const response = await route.GET({});

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.recentLogs, []);
  assert.equal(
    database.calls.filter((call) => call.key === "auditLog.findMany").length,
    0,
    "audit logs are not fetched without logs.view",
  );
  assert.ok(
    database.calls.some((call) => call.key === "$transaction"),
    "related dashboard counts use a database snapshot transaction",
  );
  const transactionCall = database.calls.find(
    (call) => call.key === "$transaction",
  );
  assert.equal(
    transactionCall?.args[1]?.isolationLevel,
    "RepeatableRead",
    "the snapshot prevents mutually inconsistent dashboard counts",
  );

  const logsDatabase = createDatabaseMock({
    rows: {
      "auditLog.findMany": [rawLog],
      "student.findMany": [
        {
          id: "internal-student-id",
          name: "علي حسن",
          code: "ST-100",
        },
      ],
    },
  });
  const withLogs = loadStatsRoute({
    principalResult: {
      id: "user-2",
      isAdmin: false,
      permissions: ["system.dashboard", "logs.view"],
    },
    database: logsDatabase,
  });
  const withLogsResponse = await withLogs.route.GET({});
  assert.equal(withLogsResponse.status, 200);
  assert.equal(withLogsResponse.body.recentLogs.length, 1);
  assert.equal(
    logsDatabase.calls.filter((call) => call.key === "auditLog.findMany")
      .length,
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(withLogsResponse.body.recentLogs),
    /internal-student-id|details/,
    "authorized activity is still sanitized before it reaches the browser",
  );
  assert.match(
    JSON.stringify(withLogsResponse.body.recentLogs),
    /علي حسن/,
    "audit identifiers are resolved to a student's readable name",
  );

  const privateMessage = "postgresql://secret-user:secret-password@private-host";
  const failingDatabase = createDatabaseMock({
    throwOn: "courseChapter.findMany",
    error: Object.assign(new Error(privateMessage), {
      code: "P2022",
      meta: { column: "private_column" },
    }),
  });
  const failing = loadStatsRoute({
    principalResult: {
      id: "user-1",
      isAdmin: false,
      permissions: ["system.dashboard"],
    },
    database: failingDatabase,
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const failedResponse = await failing.route.GET({});
    assert.equal(failedResponse.status, 503);
    const clientPayload = JSON.stringify(failedResponse.body);
    assert.doesNotMatch(
      clientPayload,
      /secret-user|secret-password|private-host|private_column|P2022/,
    );
    assert.equal(failedResponse.body.code, "DATABASE_MIGRATION_REQUIRED");
    assert.equal(failedResponse.body.retryable, false);
    assert.deepEqual(
      Object.keys(failedResponse.body).sort(),
      ["code", "error", "retryable"],
    );
  } finally {
    console.error = originalError;
  }
});

test("dashboard component integrates permissions, deep links, stale errors, humanized logs, and accessibility", () => {
  const dashboard = read("src/components/teacher-pro/dashboard.tsx");
  const statsRoute = read("src/app/api/stats/route.ts");
  const globalCss = read("src/app/globals.css");
  const gradeEntry = read("src/components/teacher-pro/grade-entry.tsx");
  const studentRegistry = read(
    "src/components/teacher-pro/student-registry.tsx",
  );
  const followUp = read("src/components/teacher-pro/follow-up.tsx");
  const opportunities = read(
    "src/components/teacher-pro/opportunities.tsx",
  );
  const layout = read("src/components/teacher-pro/layout.tsx");
  const missingGradesBlock = statsRoute.slice(
    statsRoute.indexOf("async function countActiveExamsWithMissingGrades"),
    statsRoute.indexOf(
      "async function countDismissedStudentsNeedingCurrentPledge",
    ),
  );

  assert.match(
    statsRoute,
    /requirePermissionPrincipal\(\s*req,\s*["']system\.dashboard["']\s*,?\s*\)/,
  );
  assert.match(statsRoute, /hasPermission\([^,]+,\s*["']logs\.view["']\)/);
  assert.doesNotMatch(statsRoute, /ensureExamSchema|ensureFollowupTables\(|ensureGradeEntryMissingNoteSchema\(/);
  assert.match(statsRoute, /routeErrorResponse\(/);
  assert.match(statsRoute, /TelegramExamSubmission|telegramExamSubmission/);
  assert.match(statsRoute, /normalizeExamSiteValue/);
  assert.match(statsRoute, /isAllMainSitesSelection/);
  assert.match(statsRoute, /jsonb_to_recordset/);
  assert.match(statsRoute, /parseCourseIds\(/);
  assert.match(statsRoute, /student\.groupBy\(/);
  assert.doesNotMatch(missingGradesBlock, /tx\.student\.findMany\(/);
  assert.doesNotMatch(missingGradesBlock, /tx\.grade\.findMany\(/);
  assert.doesNotMatch(missingGradesBlock, /tx\.studentLeave\.findMany\(/);

  assert.match(dashboard, /actionQuery\??:/);
  assert.match(dashboard, /canAccess\(/);
  assert.match(dashboard, /history\.pushState\(/);
  assert.match(dashboard, /dashboardAlert/);
  assert.match(dashboard, /data-dashboard-state=/);
  assert.match(dashboard, /statsStale|stale/i);
  assert.match(dashboard, /generatedAt/);
  assert.match(dashboard, /humanizeTeacherProText/);
  assert.match(dashboard, /millisecondsUntilNextBaghdadDay\(/);
  assert.match(dashboard, /visibilitychange/);
  assert.doesNotMatch(dashboard, />\s*\{log\.action\}\s*</);
  assert.doesNotMatch(dashboard, /\{log\.module\}/);
  assert.match(dashboard, /aria-live=["']polite["']/);
  assert.match(dashboard, /role=["'](?:status|alert)["']/);
  assert.match(dashboard, /<ol\b/);
  assert.match(dashboard, /<li\b/);
  assert.match(dashboard, /<time\b[^>]*dateTime=/);
  assert.match(
    dashboard,
    /initialError\s*\?\s*\([\s\S]*?تعذر تحميل آخر الفعاليات[\s\S]*?:\s*recentLogs\.length\s*===\s*0/,
  );
  assert.match(gradeEntry, /params\.get\(["']examId["']\)/);
  assert.match(gradeEntry, /params\.get\(["']filterStatus["']\)/);
  assert.match(studentRegistry, /params\.get\(["']registryIssue["']\)/);
  assert.match(followUp, /params\.get\(["']dashboardDate["']\)/);
  assert.match(followUp, /params\.get\(["']statusFilter["']\)/);
  assert.match(opportunities, /params\.get\(["']status["']\)/);
  for (const queryKey of [
    "examId",
    "filterStatus",
    "registryIssue",
    "dashboardDate",
    "status",
    "statusFilter",
  ]) {
    assert.match(
      layout,
      new RegExp(`["']${queryKey}["']`),
      `layout preserves the ${queryKey} dashboard target`,
    );
  }
  assert.ok(
    /md:max-h-\[[^\]]+\][^"']*md:overflow-y-auto/.test(dashboard) ||
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.tp-dashboard__activity-list[\s\S]*?overflow[^;]*:\s*visible/.test(globalCss),
    "the activity list does not create a nested scroll area on phones",
  );
});
