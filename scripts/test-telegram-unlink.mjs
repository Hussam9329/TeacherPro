#!/usr/bin/env node
// «إلغاء ربط التليگرام»: the open-exam rule (behaviour) and the wiring of the
// button, the route and the edit window (integrity).
// Run: node --experimental-strip-types --test scripts/test-telegram-unlink.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOT_EXAM_GRACE_MS,
  botDraftExamIds,
  botSessionHasOpenExam,
} from "../src/lib/telegram-bot-session.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const NOW = Date.parse("2026-11-11T14:00:00Z");
const open = new Date(NOW + 60 * 60 * 1000);
const closed = new Date(NOW - 60 * 60 * 1000);
const hasOpen = (data, closeAt = {}) => botSessionHasOpenExam(data, closeAt, NOW);

test("a student with no bot session, or an idle one, can be unlinked", () => {
  assert.equal(hasOpen(null), false);
  assert.equal(hasOpen({ student_id_cached: "s1", accepted_receipt: { exam_id: "e1" } }), false);
});

test("a started exam that is still open blocks the unlink", () => {
  assert.equal(hasOpen({ active_exam_id: "e1" }, { e1: open }), true);
});

test("the bot's grace after closing still counts as open", () => {
  const justClosed = new Date(NOW - BOT_EXAM_GRACE_MS + 1000);
  assert.equal(hasOpen({ active_exam_id: "e1" }, { e1: justClosed }), true);
  assert.equal(hasOpen({ active_exam_id: "e1" }, { e1: new Date(NOW - BOT_EXAM_GRACE_MS) }), false);
});

test("an answer being sent blocks the unlink", () => {
  assert.equal(hasOpen({ is_submitting: true }), true);
  assert.equal(hasOpen({ pending_submission: { submission_id: "c1" } }), true);
  assert.equal(hasOpen({ pending_expired_draft: { exam_id: "e1" } }), true);
});

test("a draft set aside blocks while its exam is open", () => {
  const data = { paused_drafts: { e2: { exam_started_at: "2026-11-11T13:10:00Z" } } };
  assert.deepEqual(botDraftExamIds({ active_exam_id: "e1", ...data }), ["e1", "e2"]);
  assert.equal(hasOpen(data, { e2: open }), true);
});

test("an exam that ended with nothing saved does not block", () => {
  assert.equal(hasOpen({ active_exam_id: "e1", exam_pages: [] }, { e1: closed }), false);
  assert.equal(hasOpen({ paused_drafts: { e2: {} } }, { e2: closed }), false);
  // An exam TeacherPro no longer has cannot be answered either.
  assert.equal(hasOpen({ active_exam_id: "gone" }, {}), false);
});

test("pages saved before the exam closed block until the bot delivers them", () => {
  assert.equal(hasOpen({ active_exam_id: "e1", exam_pages: [{ order: 1 }] }, { e1: closed }), true);
  assert.equal(hasOpen({ paused_drafts: { e2: { exam_pages: [{ order: 1 }] } } }, { e2: closed }), true);
});

test("the route allows only the admin and supervisors and checks the bot first", () => {
  const route = read("src/app/api/students/unlink-telegram/route.ts");
  assert.ok(route.includes("if (!oversees(principal))"));
  assert.ok(route.indexOf("hasOpenBotExam(expectedTelegram)") < route.indexOf("withSerializableTransaction("));
  assert.ok(route.includes("currentTelegram !== expectedTelegram"));
  assert.ok(route.includes("data: { telegram: null, telegramKey: null }"), "clears the id and its key only");
  assert.ok(!/username\s*:/.test(route), "the username is never written");
  assert.ok(route.includes("ARCHIVED_STUDENT_STATUS"));
  assert.ok(route.includes("tx.auditLog.create") && route.includes("previousTelegram"));
  assert.ok(route.includes("TELEGRAM_UNLINK_NOTICE_HTML"), "the student is told in the bot");
});

test("the edit window obeys the same open-exam rule", () => {
  const route = read("src/app/api/students/route.ts");
  assert.ok(route.includes("data.telegram !== currentTelegram && !oversees(principal)"));
  assert.ok(route.includes("data.telegram !== currentTelegram && (await hasOpenBotExam(currentTelegram))"));
  assert.ok(route.includes("data.telegramKey = identityKeys.telegramKey"));
});

test("the button sits in the student profile and is never replayed", () => {
  assert.ok(read("src/components/teacher-pro/student-profile-dialog.tsx").includes("<TelegramUnlinkButton student={profileStudent} />"));
  const button = read("src/components/teacher-pro/telegram-unlink-button.tsx");
  assert.ok(button.includes("getStudentRegistryCapabilities(currentUser()).isAdmin"));
  assert.ok(button.includes("studentApi.unlinkTelegram(student.id, telegram)"));
  assert.ok(read("src/lib/api.ts").includes('apiPost("students/unlink-telegram"'));
  assert.ok(!read("src/lib/mutation-replay-policy.ts").includes("unlink-telegram"));
});
