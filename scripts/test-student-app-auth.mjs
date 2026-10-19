#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-student-app";

import {
  generateDeviceToken,
  hashDeviceToken,
  readBearerToken,
  requireStudentDevice,
  signConfirmTicket,
  verifyConfirmTicket,
} from "../src/lib/student-app/auth.ts";

const req = (token) => ({ headers: { get: (name) => (name.toLowerCase() === "authorization" && token ? `Bearer ${token}` : null) } });

function client(rows) {
  const updates = [];
  return {
    updates,
    studentDevice: {
      async findUnique({ where }) {
        const row = rows.find((r) => r.tokenHash === where.tokenHash);
        return row ? { ...row, student: row.student } : null;
      },
      async update({ where, data }) { updates.push({ where, data }); return {}; },
    },
  };
}

test("token is base64url and its hash is sha256 hex", () => {
  const { token, tokenHash } = generateDeviceToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(hashDeviceToken(token), tokenHash);
  assert.notEqual(generateDeviceToken().token, token);
});

test("readBearerToken extracts the bearer value only", () => {
  assert.equal(readBearerToken(req("abc")), "abc");
  assert.equal(readBearerToken(req("")), "");
  assert.equal(readBearerToken({ headers: { get: () => "Basic xyz" } }), "");
});

test("requireStudentDevice rejects a missing header with SESSION_REVOKED", async () => {
  const result = await requireStudentDevice(req(""), client([]));
  assert.equal(result.status, 401);
  assert.equal((await result.json()).code, "SESSION_REVOKED");
});

test("requireStudentDevice rejects an unknown token", async () => {
  const result = await requireStudentDevice(req("nope"), client([]));
  assert.equal(result.status, 401);
});

test("requireStudentDevice rejects a revoked device", async () => {
  const { token, tokenHash } = generateDeviceToken();
  const c = client([{ id: "d1", tokenHash, revokedAt: new Date(), lastSeenAt: new Date(), student: { id: "s1", name: "x" } }]);
  const result = await requireStudentDevice(req(token), c);
  assert.equal(result.status, 401);
  assert.equal((await result.json()).code, "SESSION_REVOKED");
});

test("requireStudentDevice accepts a valid token and touches lastSeenAt when stale", async () => {
  const { token, tokenHash } = generateDeviceToken();
  const stale = new Date(Date.now() - 11 * 60 * 1000);
  const c = client([{ id: "d1", tokenHash, revokedAt: null, lastSeenAt: stale, student: { id: "s1", name: "x" } }]);
  const result = await requireStudentDevice(req(token), c);
  assert.equal(result.student.id, "s1");
  assert.equal(result.device.id, "d1");
  assert.equal(c.updates.length, 1);
  assert.equal(c.updates[0].where.id, "d1");
});

test("requireStudentDevice does not touch lastSeenAt when fresh", async () => {
  const { token, tokenHash } = generateDeviceToken();
  const c = client([{ id: "d1", tokenHash, revokedAt: null, lastSeenAt: new Date(), student: { id: "s1", name: "x" } }]);
  const result = await requireStudentDevice(req(token), c);
  assert.equal(result.student.id, "s1");
  assert.equal(c.updates.length, 0);
});

test("confirm ticket round-trips, expires and rejects tampering", () => {
  const ticket = signConfirmTicket({ studentId: "s1", exp: Date.now() + 60_000 });
  assert.deepEqual(verifyConfirmTicket(ticket), { studentId: "s1", rateKey: null });
  const expired = signConfirmTicket({ studentId: "s1", exp: Date.now() - 1 });
  assert.equal(verifyConfirmTicket(expired), null);
  const [payload, sig] = ticket.split(".");
  assert.equal(verifyConfirmTicket(`${payload}x.${sig}`), null);
  assert.equal(verifyConfirmTicket(`${payload}.${sig}x`), null);
  assert.equal(verifyConfirmTicket("garbage"), null);
});

test("confirm ticket carries the phone rate key so confirm can clear it", () => {
  const ticket = signConfirmTicket({ studentId: "s1", rateKey: "student-app:07701234567", exp: Date.now() + 60_000 });
  assert.deepEqual(verifyConfirmTicket(ticket), { studentId: "s1", rateKey: "student-app:07701234567" });
  assert.deepEqual(verifyConfirmTicket(signConfirmTicket({ studentId: "s2", exp: Date.now() + 60_000 })), { studentId: "s2", rateKey: null });
});

test("ticket secret follows the staff login precedence, including NEXTAUTH_SECRET and the dev fallback", () => {
  const saved = { ...process.env };
  try {
    delete process.env.AUTH_SECRET; delete process.env.TEACHERPRO_AUTH_SECRET; delete process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "next-only";
    assert.deepEqual(verifyConfirmTicket(signConfirmTicket({ studentId: "s3", exp: Date.now() + 60_000 })), { studentId: "s3", rateKey: null });
    delete process.env.NEXTAUTH_SECRET;
    assert.equal(verifyConfirmTicket(signConfirmTicket({ studentId: "s4", exp: Date.now() + 60_000 }))?.studentId, "s4");
  } finally {
    process.env.AUTH_SECRET = saved.AUTH_SECRET; process.env.TEACHERPRO_AUTH_SECRET = saved.TEACHERPRO_AUTH_SECRET;
    if (saved.NEXTAUTH_SECRET === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = saved.NEXTAUTH_SECRET;
  }
});
