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
    rows: {
      "auditLog.findMany": [rawLog],
      "student.count": (query) => {
        if (query?.where?.status === "نشط") return 21;
        if (query?.where?.status === "مفصول") return 4;
        return 27;
      },
    },
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
  assert.equal(response.body.activeStudents, 21);
  assert.equal(response.body.dismissedStudents, 4);
  assert.equal(response.body.totalStudents, 27);
  assert.equal(response.body.source, "database");
  assert.ok(Number.isFinite(Date.parse(response.body.generatedAt)));
  assert.deepEqual(response.body.recentLogs, []);
  assert.equal(Object.hasOwn(response.body, "alerts"), false);
  assert.deepEqual(
    database.calls.map((call) => call.key).sort(),
    ["$transaction", "student.count", "student.count", "student.count"].sort(),
    "the dashboard reads only student counts when logs are forbidden; retired alert queries and writes do not run",
  );
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
    throwOn: "student.count",
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

  assert.match(
    statsRoute,
    /requirePermissionPrincipal\(\s*req,\s*["']system\.dashboard["']\s*,?\s*\)/,
  );
  assert.match(statsRoute, /hasPermission\([^,]+,\s*["']logs\.view["']\)/);
  assert.doesNotMatch(statsRoute, /ensureExamSchema|ensureFollowupTables\(|ensureGradeEntryMissingNoteSchema\(/);
  assert.match(statsRoute, /routeErrorResponse\(/);
  assert.doesNotMatch(statsRoute, /courseChapter\.|studentLeave\.|countActiveExamsWithMissingGrades|\$queryRaw|allAlerts/);
  assert.match(statsRoute, /student\.count\(/);

  assert.doesNotMatch(dashboard, /تنبيهات إدارية|DashboardAlert|alertToneClass|alertBadgeClass|alertFallbackQuery|tp-dashboard__alerts/);
  assert.doesNotMatch(globalCss, /tp-dashboard__alerts|tp-dashboard__alert-card|tp-dashboard__alert-action/);
  assert.match(dashboard, /canAccess\(/);
  assert.match(dashboard, /history\.pushState\(/);
  assert.match(dashboard, /dashboardAlert/);
  assert.match(dashboard, /data-dashboard-state=/);
  assert.match(dashboard, /statsStale|stale/i);
  assert.match(dashboard, /generatedAt/);
  assert.match(dashboard, /humanizeTeacherProText/);
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
