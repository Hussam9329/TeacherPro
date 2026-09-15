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

test("stats route reads only student counts from one snapshot for every dashboard principal", async () => {
  const principals = [
    { id: "user-1", isAdmin: false, permissions: ["system.dashboard"] },
    { id: "user-2", isAdmin: false, permissions: ["system.dashboard", "logs.view"] },
    { id: "admin-1", isAdmin: true, permissions: [] },
  ];

  for (const principal of principals) {
    const database = createDatabaseMock({
      rows: {
        "student.count": (query) => {
          if (query?.where?.status === "نشط") return 21;
          if (query?.where?.status === "مفصول") return 4;
          return 27;
        },
      },
    });
    const { route, permissions } = loadStatsRoute({
      principalResult: principal,
      database,
    });
    const response = await route.GET({});

    assert.equal(response.status, 200);
    assert.equal(response.body.activeStudents, 21);
    assert.equal(response.body.dismissedStudents, 4);
    assert.equal(response.body.totalStudents, 27);
    assert.equal(response.body.source, "database");
    assert.ok(Number.isFinite(Date.parse(response.body.generatedAt)));
    assert.deepEqual(Object.keys(response.body).sort(), [
      "activeStudents", "dismissedStudents", "generatedAt", "source", "totalStudents",
    ]);
    assert.deepEqual(permissions, ["system.dashboard"]);
    assert.equal(response.headers["Cache-Control"], "private, no-store, max-age=0");
    assert.deepEqual(
      database.calls.map((call) => call.key).sort(),
      ["$transaction", "student.count", "student.count", "student.count"].sort(),
      "no retired alert queries, audit-log reads, entity lookups, or writes run, including for admins",
    );
    const transactionCall = database.calls.find(
      (call) => call.key === "$transaction",
    );
    assert.equal(
      transactionCall?.args[1]?.isolationLevel,
      "RepeatableRead",
      "the snapshot prevents mutually inconsistent dashboard counts",
    );
  }
});

test("stats route sanitizes schema failures without returning misleading zero counts", async () => {
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

test("dashboard keeps KPI loading, stale errors, and accessibility after retired sections are removed", () => {
  const dashboard = read("src/components/teacher-pro/dashboard.tsx");
  const statsRoute = read("src/app/api/stats/route.ts");
  const globalCss = read("src/app/globals.css");

  assert.match(
    statsRoute,
    /requirePermissionPrincipal\(\s*req,\s*["']system\.dashboard["']\s*,?\s*\)/,
  );
  assert.doesNotMatch(statsRoute, /ensureExamSchema|ensureFollowupTables\(|ensureGradeEntryMissingNoteSchema\(/);
  assert.match(statsRoute, /routeErrorResponse\(/);
  assert.doesNotMatch(statsRoute, /courseChapter\.|studentLeave\.|countActiveExamsWithMissingGrades|\$queryRaw|allAlerts|auditLog|recentLogs|logs\.view|extractAuditEntityIds/);
  assert.match(statsRoute, /student\.count\(/);

  assert.doesNotMatch(dashboard, /تنبيهات إدارية|آخر الفعاليات|DashboardAlert|alertToneClass|alertBadgeClass|alertFallbackQuery|tp-dashboard__alerts|tp-dashboard__activity|recentLogs|humanizeAudit|navigateFromDashboard/);
  assert.doesNotMatch(globalCss, /tp-dashboard__alerts|tp-dashboard__alert-card|tp-dashboard__alert-action|tp-dashboard__activity/);
  assert.equal(fs.existsSync(path.join(root, "src/lib/dashboard-stats.ts")), false);
  assert.match(dashboard, /data-dashboard-state=/);
  assert.match(dashboard, /statsStale|stale/i);
  assert.match(dashboard, /generatedAt/);
  assert.match(dashboard, /aria-live=["']polite["']/);
  assert.match(dashboard, /role=["'](?:status|alert)["']/);
  assert.match(dashboard, /initialError &&/);
  assert.match(dashboard, /تعذر تحميل لوحة النظام/);
  assert.match(dashboard, /إعادة المحاولة/);
  assert.match(dashboard, /tp-dashboard__kpis/);
  for (const label of ["طلاب نشطون", "طلاب مفصولون", "إجمالي الطلاب"]) {
    assert.ok(dashboard.includes(label), `the ${label} KPI is retained`);
  }
  assert.match(globalCss, /container: dashboard \/ inline-size/);
  assert.match(globalCss, /@container dashboard \(min-width: 40rem\)/);
});
