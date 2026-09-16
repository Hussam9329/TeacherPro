import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (path) => ts.transpileModule(
  fs.readFileSync(new URL(path, import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const compiledApi = compile("../src/lib/api.ts");
const policy = { exports: {} };
vm.runInNewContext(compile("../src/lib/mutation-replay-policy.ts"), {
  exports: policy.exports,
});

const previewPayload = {
  studentId: "fixture-student",
  createdAt: "2026-07-01",
  accountingGraceDays: 6,
  gracePeriodStartMode: "now",
};
const json = (body, status = 200) => Response.json(body, { status });

function createHarness(responses) {
  const calls = [];
  const queued = [];
  const delays = [];
  let blockers = 0;
  const dependencies = new Map([
    ["./mutation-replay-policy", policy.exports],
    ["./outbox-session", {
      getOutboxOwner: () => "fixture-owner",
      ownerHeaders: () => ({}),
    }],
    ["./teacherpro-sync", {
      beginTeacherProInteractionBlocker: () => {
        blockers += 1;
        return () => { blockers -= 1; };
      },
      inferTeacherProScopesFromEndpoint: () => ["students"],
    }],
    ["./read-deadline", {}],
    ["./mutation-outbox", {
      queueOnly: (item) => {
        queued.push(item);
        return { outboxId: "unexpected-queued-preview" };
      },
    }],
  ]);
  const module = { exports: {} };
  vm.runInNewContext(compiledApi, {
    exports: module.exports,
    require: (specifier) => {
      assert.ok(dependencies.has(specifier), `Unmocked dependency: ${specifier}`);
      return dependencies.get(specifier);
    },
    fetch: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      const response = responses[calls.length - 1];
      assert.ok(response, `Unexpected request ${calls.length}: ${url}`);
      if (response instanceof Error) throw response;
      return response;
    },
    // Keep retries deterministic and immediate; no real network or sleeps.
    setTimeout: (callback, milliseconds) => {
      delays.push(milliseconds);
      callback();
    },
    console: { warn: () => {} },
    URLSearchParams,
  });
  return {
    api: module.exports.studentApi,
    calls,
    queued,
    delays,
    assertReleased: () => assert.equal(blockers, 0),
  };
}

function assertPreviewRequests(harness, count) {
  assert.equal(harness.calls.length, count);
  for (const request of harness.calls) {
    assert.equal(request.url, "/api/students/update-impact");
    assert.equal(request.method, "POST");
    assert.deepEqual(request.body, { ...previewPayload, previewOnly: true });
  }
  assert.equal(harness.queued.length, 0, "a read-only preview must never enter the outbox");
  harness.assertReleased();
}

test("academic preview retries HTTP 500 and returns the successful read", async () => {
  const data = { studentId: previewPayload.studentId, previewToken: "fresh-preview" };
  const harness = createHarness([
    json({ error: "تعذر معاينة أثر تاريخ التسجيل وفترة السماح." }, 500),
    json(data),
  ]);
  const result = await harness.api.updateImpact({ ...previewPayload, previewOnly: false });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, data);
  assert.notEqual(result.outcomeUnknown, true);
  assertPreviewRequests(harness, 2);
  assert.deepEqual(harness.delays, [250]);
});

test("offline preview stops after three tries without queueing or uncertain-write warning", async () => {
  const harness = createHarness(Array.from({ length: 3 }, () => new Error("Failed to fetch")));
  const result = await harness.api.updateImpact(previewPayload);
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.equal(result.error, "تعذر الاتصال بالنظام. تحقق من الإنترنت ثم حاول مرة أخرى.");
  assert.notEqual(result.outcomeUnknown, true);
  assert.notEqual(result.queued, true);
  assertPreviewRequests(harness, 3);
  assert.deepEqual(harness.delays, [250, 500]);
});

test("exhausted server failures retain the real preview error without a write claim", async () => {
  const error = "تعذر معاينة أثر تاريخ التسجيل وفترة السماح.";
  const harness = createHarness(Array.from({ length: 3 }, () => json({ error }, 500)));
  const result = await harness.api.updateImpact(previewPayload);
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.error, error);
  assert.notEqual(result.outcomeUnknown, true);
  assert.notEqual(result.queued, true);
  assertPreviewRequests(harness, 3);
});

test("terminal preview validation errors are not retried", async () => {
  const error = "تاريخ التسجيل الجديد غير صالح";
  const harness = createHarness([json({ error }, 400)]);
  const result = await harness.api.updateImpact(previewPayload);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, error);
  assert.notEqual(result.outcomeUnknown, true);
  assertPreviewRequests(harness, 1);
  assert.deepEqual(harness.delays, []);
});

test("actual student writes keep token replay protection and are never auto-retried", async () => {
  const harness = createHarness([new Error("Failed to fetch")]);
  const result = await harness.api.update(previewPayload.studentId, {
    accountingGraceDays: 6,
    expectedMutationToken: "student-version",
    academicImpactPreviewToken: "confirmed-preview",
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcomeUnknown, true);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].url, "/api/students");
  assert.equal(harness.calls[0].method, "PUT");
  assert.equal(harness.calls[0].body.previewOnly, undefined);
  assert.equal(harness.queued.length, 0);
  assert.deepEqual(harness.delays, []);
  harness.assertReleased();
});
