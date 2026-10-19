#!/usr/bin/env node
// Push senders of the student app: FCM HTTP v1 (Android), APNs HTTP/2 (iOS),
// the exam-window text, and the router that clears dead tokens.
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import { createFcmSender } from "../src/lib/student-app/push-fcm.ts";
import { createApnsSender } from "../src/lib/student-app/push-apns.ts";
import { buildExamWindowMessage, formatBaghdadClock } from "../src/lib/student-app/push-text.ts";
import { sendToDevices } from "../src/lib/student-app/push-send.ts";

const NOW = new Date("2026-10-17T12:00:00Z");
const b64 = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

// ── FCM ─────────────────────────────────────────────────────────────────────
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = {
  project_id: "hf-students",
  client_email: "push@hf-students.iam.gserviceaccount.com",
  private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://oauth2.googleapis.com/token",
};

function fcmFixture(responses = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url === serviceAccount.token_uri) return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    const token = JSON.parse(init.body).message.token;
    const reply = responses[token] ?? { status: 200, body: { name: `projects/hf-students/messages/${token}` } };
    return Response.json(reply.body, { status: reply.status });
  };
  return { calls, sender: createFcmSender({ serviceAccountJson: JSON.stringify(serviceAccount), fetchFn, now: () => NOW }) };
}

test("FCM: signs a service-account JWT, exchanges it once, and posts one message per token", async () => {
  const { calls, sender } = fcmFixture();
  const results = await sender.send(["fcm-a", "fcm-b"], { title: "عنوان", body: "نص", data: { kind: "manual" } });
  assert.deepEqual(results, [{ token: "fcm-a", ok: true, unregistered: false }, { token: "fcm-b", ok: true, unregistered: false }]);
  const tokenCall = calls.find((c) => c.url === serviceAccount.token_uri);
  const params = new URLSearchParams(tokenCall.init.body);
  assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [h, p, s] = params.get("assertion").split(".");
  assert.deepEqual(b64(h), { alg: "RS256", typ: "JWT" });
  const claims = b64(p);
  assert.equal(claims.iss, serviceAccount.client_email);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.equal(claims.aud, serviceAccount.token_uri);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), rsa.publicKey, Buffer.from(s, "base64url")));
  const sends = calls.filter((c) => c.url !== serviceAccount.token_uri);
  assert.equal(sends.length, 2);
  assert.equal(sends[0].url, "https://fcm.googleapis.com/v1/projects/hf-students/messages:send");
  assert.equal(sends[0].init.headers.authorization, "Bearer ya29.test");
  const message = JSON.parse(sends[0].init.body).message;
  assert.deepEqual(message.notification, { title: "عنوان", body: "نص" });
  assert.deepEqual(message.data, { kind: "manual" });
  assert.equal(message.android.priority, "high");
  assert.equal(calls.filter((c) => c.url === serviceAccount.token_uri).length, 1, "one access token for the batch");
});

test("FCM: UNREGISTERED and INVALID_ARGUMENT mark the token dead, other failures do not", async () => {
  const { sender } = fcmFixture({
    "gone": { status: 404, body: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } },
    "bad": { status: 400, body: { error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } } },
    "busy": { status: 503, body: { error: { status: "UNAVAILABLE" } } },
  });
  const results = await sender.send(["gone", "bad", "busy", "fine"], { title: "a", body: "b" });
  assert.deepEqual(results.map((r) => [r.token, r.ok, r.unregistered]), [["gone", false, true], ["bad", false, true], ["busy", false, false], ["fine", true, false]]);
});

test("FCM: a failed token exchange fails every send without throwing", async () => {
  const fetchFn = async () => Response.json({ error: "invalid_grant" }, { status: 400 });
  const sender = createFcmSender({ serviceAccountJson: JSON.stringify(serviceAccount), fetchFn, now: () => NOW });
  const results = await sender.send(["x"], { title: "a", body: "b" });
  assert.deepEqual(results, [{ token: "x", ok: false, unregistered: false }]);
});

// ── APNs ────────────────────────────────────────────────────────────────────
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const apnsKey = ec.privateKey.export({ type: "pkcs8", format: "pem" });

function apnsFixture(responses = {}, options = {}) {
  const calls = [];
  const request = async ({ host, path, headers, body }) => {
    calls.push({ host, path, headers, body });
    const token = path.split("/").pop();
    const reply = responses[token] ?? { status: 200, body: "" };
    return reply;
  };
  const sender = createApnsSender({ keyId: "KEY123", teamId: "TEAM456", privateKey: apnsKey, bundleId: "com.hassanfalah.students", sandbox: options.sandbox ?? false, request, now: () => NOW });
  return { calls, sender };
}

test("APNs: posts to /3/device/<token> with an ES256 provider token and the alert payload", async () => {
  const { calls, sender } = apnsFixture();
  const results = await sender.send(["abc123"], { title: "عنوان", body: "نص", data: { kind: "exam-window", examId: "e1" } });
  assert.deepEqual(results, [{ token: "abc123", ok: true, unregistered: false }]);
  const call = calls[0];
  assert.equal(call.host, "api.push.apple.com");
  assert.equal(call.path, "/3/device/abc123");
  assert.equal(call.headers["apns-topic"], "com.hassanfalah.students");
  assert.equal(call.headers["apns-push-type"], "alert");
  assert.equal(call.headers["apns-priority"], "10");
  const jwt = call.headers.authorization.replace(/^bearer /, "");
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(b64(h), { alg: "ES256", kid: "KEY123" });
  assert.deepEqual(b64(p), { iss: "TEAM456", iat: Math.floor(NOW.getTime() / 1000) });
  assert.ok(verify("sha256", Buffer.from(`${h}.${p}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
  const payload = JSON.parse(call.body);
  assert.deepEqual(payload.aps, { alert: { title: "عنوان", body: "نص" }, sound: "default" });
  assert.equal(payload.kind, "exam-window");
  assert.equal(payload.examId, "e1");
});

test("APNs: sandbox host for development builds", async () => {
  const { calls, sender } = apnsFixture({}, { sandbox: true });
  await sender.send(["t"], { title: "a", body: "b" });
  assert.equal(calls[0].host, "api.sandbox.push.apple.com");
});

test("APNs: 410 Unregistered and 400 BadDeviceToken mark the token dead; 403 and 5xx do not", async () => {
  const { sender } = apnsFixture({
    gone: { status: 410, body: JSON.stringify({ reason: "Unregistered" }) },
    bad: { status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) },
    wrongtopic: { status: 400, body: JSON.stringify({ reason: "DeviceTokenNotForTopic" }) },
    denied: { status: 403, body: JSON.stringify({ reason: "InvalidProviderToken" }) },
    busy: { status: 503, body: "" },
  });
  const results = await sender.send(["gone", "bad", "wrongtopic", "denied", "busy", "fine"], { title: "a", body: "b" });
  assert.deepEqual(results.map((r) => [r.token, r.ok, r.unregistered]), [
    ["gone", false, true], ["bad", false, true], ["wrongtopic", false, true], ["denied", false, false], ["busy", false, false], ["fine", true, false],
  ]);
});

test("APNs: a transport error fails the token without throwing", async () => {
  const request = async () => { throw new Error("ECONNRESET"); };
  const sender = createApnsSender({ keyId: "k", teamId: "t", privateKey: apnsKey, bundleId: "b", sandbox: false, request, now: () => NOW });
  assert.deepEqual(await sender.send(["x"], { title: "a", body: "b" }), [{ token: "x", ok: false, unregistered: false }]);
});

// ── Text ────────────────────────────────────────────────────────────────────
test("exam-window text: exam name and the close time in Baghdad", () => {
  assert.equal(formatBaghdadClock(new Date("2026-10-17T15:00:00Z")), "6:00 م");
  assert.equal(formatBaghdadClock(new Date("2026-10-17T21:05:00Z")), "12:05 ص");
  assert.equal(formatBaghdadClock(new Date("2026-10-17T06:30:00Z")), "9:30 ص");
  const message = buildExamWindowMessage({ id: "e1", name: "الامتحان الثالث", telegramOpenAt: new Date("2026-10-17T10:00:00Z"), telegramCloseAt: new Date("2026-10-17T15:00:00Z") });
  assert.equal(message.title, "فتحت نافذة امتحان «الامتحان الثالث»");
  assert.equal(message.body, "يمكنك الإرسال الآن عبر @hfexam_bot. تغلق النافذة الساعة 6:00 م اليوم.");
  assert.deepEqual(message.data, { kind: "exam-window", examId: "e1" });
  const nextDay = buildExamWindowMessage({ id: "e2", name: "امتحان", telegramOpenAt: new Date("2026-10-17T18:00:00Z"), telegramCloseAt: new Date("2026-10-18T06:00:00Z") });
  assert.equal(nextDay.body, "يمكنك الإرسال الآن عبر @hfexam_bot. تغلق النافذة الساعة 9:00 ص يوم 18/10/2026.");
});

// ── Router ──────────────────────────────────────────────────────────────────
function fakeSender(dead = []) {
  const sent = [];
  return { sent, send: async (tokens) => { sent.push(...tokens); return tokens.map((token) => ({ token, ok: !dead.includes(token), unregistered: dead.includes(token) })); } };
}

test("router: iOS tokens go to APNs, Android to FCM, dead tokens are reported for clearing", async () => {
  const apns = fakeSender(["ios-dead"]);
  const fcm = fakeSender();
  const devices = [
    { id: "d1", platform: "ios", pushToken: "ios-a" },
    { id: "d2", platform: "ios", pushToken: "ios-dead" },
    { id: "d3", platform: "android", pushToken: "fcm-a" },
    { id: "d4", platform: "web", pushToken: "nope" },
  ];
  const result = await sendToDevices(devices, { title: "a", body: "b" }, { apns, fcm });
  assert.deepEqual(apns.sent, ["ios-a", "ios-dead"]);
  assert.deepEqual(fcm.sent, ["fcm-a"]);
  assert.deepEqual(result, { sent: 2, failed: 2, unregisteredDeviceIds: ["d2"] });
});

test("router: a platform without a configured sender counts as failed, nothing throws", async () => {
  const fcm = fakeSender();
  const result = await sendToDevices([{ id: "d1", platform: "ios", pushToken: "t" }], { title: "a", body: "b" }, { apns: null, fcm });
  assert.deepEqual(result, { sent: 0, failed: 1, unregisteredDeviceIds: [] });
});
