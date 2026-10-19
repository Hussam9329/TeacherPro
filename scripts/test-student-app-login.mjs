#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import { clientIp, loginRateLimits, resolveLoginStudent } from "../src/lib/student-app/login.ts";

function fakeClient(rows) {
  return {
    student: {
      async findMany({ where }) {
        const [field, cond] = Object.entries(where)[0];
        return rows
          .filter((r) => cond.in.includes(r[field]))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      },
    },
  };
}
const student = (id, code, extra) => ({ id, name: id, code, status: "نشط", phone: null, phoneKey: null, parentPhone: null, ...extra });

test("siblings on one parent phone are separated by the code", async () => {
  const client = fakeClient([
    student("ali", "HF1002", { parentPhone: "07809876543" }),
    student("sara", "HF1003", { parentPhone: "07809876543" }),
  ]);
  assert.equal((await resolveLoginStudent(client, { phone: "07809876543", code: "HF1002" }))?.id, "ali");
  assert.equal((await resolveLoginStudent(client, { phone: "07809876543", code: "HF1003" }))?.id, "sara");
  assert.equal(await resolveLoginStudent(client, { phone: "07809876543", code: "HF9999" }), null);
});

test("code alone never matches without the phone", async () => {
  const client = fakeClient([student("ali", "HF1001", { phoneKey: "07701234567" })]);
  assert.equal(await resolveLoginStudent(client, { phone: "07700000000", code: "HF1001" }), null);
});

test("arabic digits and +964 input match a 07 stored phoneKey", async () => {
  const client = fakeClient([student("ali", "HF1001", { phoneKey: "07701234567", phone: "07701234567" })]);
  assert.equal((await resolveLoginStudent(client, { phone: "+٩٦٤ ٧٧٠ ١٢٣ ٤٥٦٧", code: " hf1001 " }))?.id, "ali");
});

test("empty code or phone resolves to nothing without querying", async () => {
  const client = { student: { async findMany() { throw new Error("should not query"); } } };
  assert.equal(await resolveLoginStudent(client, { phone: "07701234567", code: "  " }), null);
  assert.equal(await resolveLoginStudent(client, { phone: "", code: "HF1001" }), null);
});

test("clientIp reads the first forwarded address or falls back", () => {
  const req = (value) => ({ headers: { get: (n) => (n === "x-forwarded-for" ? value : null) } });
  assert.equal(clientIp(req("10.0.0.5, 10.0.0.1")), "10.0.0.5");
  assert.equal(clientIp(req(null)), "local");
});

test("rate-limit buckets: normalized phone key without ip, and a roomier per-ip key", () => {
  assert.deepEqual(loginRateLimits("+٩٦٤ ٧٧٠ ١٢٣ ٤٥٦٧", "10.0.0.5"), [
    { key: "student-app:07701234567", maxAttempts: 5 },
    { key: "student-app-ip:10.0.0.5", maxAttempts: 40 },
  ]);
  assert.equal(loginRateLimits("07701234567", "x")[0].key, "student-app:07701234567");
  assert.equal(loginRateLimits("abc", "x")[0].key, "student-app:none");
});
