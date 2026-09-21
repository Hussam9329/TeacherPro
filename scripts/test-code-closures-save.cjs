const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const compiled = ts.transpileModule(fs.readFileSync("src/lib/dismissed-check-api.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function harness(fetchResponse) {
  const calls = [];
  const timers = new Map();
  const cleared = [];
  const delays = [];
  let clock = 0;
  let sequence = 0;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", "fetch", "setTimeout", "clearTimeout", "AbortController", compiled)(
    loaded,
    loaded.exports,
    (name) => {
      assert.equal(name, "@/lib/outbox-session");
      return { ownerHeaders: () => ({ "X-Owner-Test": "staff-a" }) };
    },
    (...args) => { calls.push(args); return fetchResponse(...args); },
    (callback, delay) => {
      const id = ++sequence;
      delays.push(delay);
      timers.set(id, { callback, due: clock + delay });
      return id;
    },
    (id) => { cleared.push(id); timers.delete(id); },
    AbortController,
  );
  return {
    save: loaded.exports.saveDismissedCheck,
    calls,
    timers,
    cleared,
    delays,
    advance(milliseconds) {
      clock += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= clock) { timers.delete(id); timer.callback(); }
      }
    },
  };
}

const input = ["student-1", true, false, 21];
const authoritativeStudent = {
  id: "student-1", status: "مفصول", dismissedChecked: false, dismissedCheckEpoch: 22,
};
const successResponse = (student = authoritativeStudent) => ({ ok: true, json: async () => ({ student }) });

function assertSingleRequest(test) {
  assert.equal(test.calls.length, 1, "saving sends exactly one request and never retries the mutation");
  const [url, options] = test.calls[0];
  assert.equal(url, "/api/students/dismissed-check");
  assert.equal(options.method, "PUT");
  assert.equal(options.credentials, "same-origin");
  assert.deepEqual(options.headers, { "Content-Type": "application/json", "X-Owner-Test": "staff-a" });
  assert.deepEqual(JSON.parse(options.body), {
    studentId: "student-1", checked: true, expectedChecked: false, expectedEpoch: 21,
  }, "the intended choice and both compare-and-swap values are sent unchanged");
  assert(options.signal instanceof AbortSignal);
  assert.deepEqual(test.delays, [30_000], "the entire write, including JSON decoding, has one 30-second deadline");
}

(async () => {
  const successful = harness(async () => successResponse());
  assert.deepEqual(await successful.save(...input), authoritativeStudent,
    "success returns the server snapshot instead of assuming the optimistic choice was accepted");
  assertSingleRequest(successful);
  assert.equal(successful.timers.size, 0);
  assert.equal(successful.cleared.length, 1);
  successful.advance(60_000);
  assert.equal(successful.calls[0][1].signal.aborted, false, "successful completion cancels its deadline");
  assertSingleRequest(successful);

  const conflictMessage = "تغيّرت حالة الطالب. حدّث القائمة وحاول مجدداً.";
  const conflict = harness(async () => ({ ok: false, status: 409, json: async () => ({ error: conflictMessage }) }));
  await assert.rejects(conflict.save(...input), (error) => error.message === conflictMessage,
    "the server conflict message survives for the UI to display and refresh");
  conflict.advance(60_000);
  assertSingleRequest(conflict);
  assert.equal(conflict.timers.size, 0);
  assert.equal(conflict.calls[0][1].signal.aborted, false);

  for (const student of [null, {}, { ...authoritativeStudent, id: "other-student" },
    { ...authoritativeStudent, dismissedChecked: "true" },
    { ...authoritativeStudent, dismissedCheckEpoch: "22" },
    { ...authoritativeStudent, dismissedCheckEpoch: 0.5 },
    { ...authoritativeStudent, dismissedCheckEpoch: Number.MAX_SAFE_INTEGER + 1 }]) {
    const invalid = harness(async () => successResponse(student));
    await assert.rejects(invalid.save(...input), /تعذر تأكيد حالة اغلاق الكود/,
      "malformed 200 responses must never be accepted as confirmed shared state");
    assertSingleRequest(invalid);
    assert.equal(invalid.timers.size, 0);
  }

  for (const stage of ["fetch", "json"]) {
    const pending = deferred();
    let jsonReads = 0;
    const stalled = harness(stage === "fetch"
      ? () => pending.promise
      : async () => ({ ok: true, json: () => { jsonReads += 1; return pending.promise; } }));
    const outcome = stalled.save(...input);
    const settlements = [];
    outcome.then((value) => settlements.push({ value }), (error) => settlements.push({ error }));
    const deadlineRejected = assert.rejects(outcome, /تأخر تأكيد الحفظ/,
      `a stalled ${stage} must terminate even if the underlying promise ignores abort`);
    await flush();
    stalled.advance(29_999);
    await flush();
    assert.equal(settlements.length, 0, "a slow request remains pending before its deadline");
    assert.equal(stalled.calls[0][1].signal.aborted, false);
    stalled.advance(1);
    await deadlineRejected;
    await flush();
    assert.equal(settlements.length, 1);
    assert.match(settlements[0].error.message, /تأخر تأكيد الحفظ/);
    assert.equal(stalled.calls[0][1].signal.aborted, true, "the timeout aborts the fetch signal");
    assert.equal(stalled.timers.size, 0);
    assert.equal(stalled.cleared.length, 1);
    assertSingleRequest(stalled);

    if (stage === "fetch") {
      pending.resolve({ ok: true, json: async () => { jsonReads += 1; return { student: authoritativeStudent }; } });
    } else {
      pending.resolve({ student: authoritativeStudent });
    }
    await flush();
    stalled.advance(60_000);
    await flush();
    assert.equal(jsonReads, 1);
    assert.equal(settlements.length, 1, "a late network/body success cannot replace the settled timeout result");
    assert(settlements[0].error);
    assertSingleRequest(stalled);
  }

  const networkFailure = new Error("connection interrupted");
  const disconnected = harness(async () => { throw networkFailure; });
  await assert.rejects(disconnected.save(...input), (error) => error === networkFailure);
  assert.equal(disconnected.timers.size, 0);
  assertSingleRequest(disconnected);

  console.log("PASS: code-closure saves preserve CAS input and server truth, propagate conflicts, reject malformed success, bound stalled fetch/body reads, abort on deadline and never replay writes");
})().catch((error) => { console.error(error); process.exitCode = 1; });
