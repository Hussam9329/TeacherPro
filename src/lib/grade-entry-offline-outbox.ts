"use client";

import { gradeApi, type ApiResult } from "./api";
import {
  announceTeacherProSyncError,
  announceTeacherProSyncPending,
  announceTeacherProSyncSettled,
  emitTeacherProDataChanged,
} from "./teacherpro-sync";

export type OfflineGradeStatus = "درجة" | "غائب" | "غش";

export type OfflineGradeDesired = {
  status: OfflineGradeStatus;
  score: number | null;
  notes: string;
};

export type GradeEntryOfflineSave = {
  key: string;
  revision: string;
  studentId: string;
  examId: string;
  desired: OfflineGradeDesired;
  expectedUpdatedAt: string;
  expectMissing: boolean;
  attempted: OfflineGradeDesired[];
  queuedAt: number;
  updatedAt: number;
  attempts: number;
  state: "pending" | "conflict" | "rejected";
  lastError?: string;
};

export type GradeEntryOfflineAttempt = Pick<
  GradeEntryOfflineSave,
  "key" | "revision" | "studentId" | "examId" | "desired"
>;

export type GradeEntryOfflineEvent = {
  type: "queued" | "synced" | "conflict" | "rejected";
  item: GradeEntryOfflineSave;
  data?: unknown;
  message?: string;
};

const STORAGE_KEY = "teacherpro-grade-entry-offline-v2";
const EVENT_NAME = "teacherpro:grade-entry-offline";
const MAX_ITEMS = 4000;
const MAX_ATTEMPTED_SNAPSHOTS = 12;
const RETRY_DELAY_MS = 1200;

let flushInFlight = false;
let flushTimer: ReturnType<typeof window.setTimeout> | null = null;
let browserEventsInstalled = false;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function makeKey(examId: string, studentId: string): string {
  return `${examId}:${studentId}`;
}

function makeRevision(): string {
  return `grade-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDesired(value: unknown): OfflineGradeDesired | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const status = String(record.status || "") as OfflineGradeStatus;
  if (!(["درجة", "غائب", "غش"] as string[]).includes(status)) return null;
  const rawScore = record.score;
  const numericScore =
    rawScore === null || rawScore === undefined || rawScore === ""
      ? null
      : Number(rawScore);
  return {
    status,
    score:
      status === "درجة" && Number.isFinite(numericScore)
        ? numericScore
        : null,
    notes: String(record.notes || ""),
  };
}

function normalizeItem(value: unknown): GradeEntryOfflineSave | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const studentId = String(record.studentId || "").trim();
  const examId = String(record.examId || "").trim();
  const desired = normalizeDesired(record.desired);
  if (!studentId || !examId || !desired) return null;

  const attempted = Array.isArray(record.attempted)
    ? record.attempted
        .map(normalizeDesired)
        .filter((item): item is OfflineGradeDesired => Boolean(item))
        .slice(-MAX_ATTEMPTED_SNAPSHOTS)
    : [];

  const state = ["pending", "conflict", "rejected"].includes(
    String(record.state || ""),
  )
    ? (record.state as GradeEntryOfflineSave["state"])
    : "pending";

  return {
    key: makeKey(examId, studentId),
    revision: String(record.revision || makeRevision()),
    studentId,
    examId,
    desired,
    expectedUpdatedAt: String(record.expectedUpdatedAt || ""),
    expectMissing: Boolean(record.expectMissing),
    attempted,
    queuedAt: Number(record.queuedAt || Date.now()),
    updatedAt: Number(record.updatedAt || Date.now()),
    attempts: Math.max(0, Number(record.attempts || 0)),
    state,
    lastError: record.lastError ? String(record.lastError) : undefined,
  };
}

function readItems(): GradeEntryOfflineSave[] {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeItem)
      .filter((item): item is GradeEntryOfflineSave => Boolean(item));
  } catch (error) {
    console.warn("[GradeEntryOffline] failed to read queue:", error);
    return [];
  }
}

function writeItems(items: GradeEntryOfflineSave[]): boolean {
  if (!canUseStorage()) return false;
  try {
    const sorted = items
      .slice(-MAX_ITEMS)
      .sort((a, b) => a.queuedAt - b.queuedAt);
    if (sorted.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    }
    return true;
  } catch (error) {
    console.error("[GradeEntryOffline] failed to persist queue:", error);
    return false;
  }
}

function updateItem(
  key: string,
  updater: (item: GradeEntryOfflineSave) => GradeEntryOfflineSave | null,
): GradeEntryOfflineSave | null {
  const items = readItems();
  const index = items.findIndex((item) => item.key === key);
  if (index === -1) return null;
  const next = updater(items[index]);
  if (next) items[index] = next;
  else items.splice(index, 1);
  if (!writeItems(items)) return null;
  return next;
}

function sameDesired(a: OfflineGradeDesired, b: OfflineGradeDesired): boolean {
  return (
    a.status === b.status &&
    a.score === b.score &&
    (a.notes || "") === (b.notes || "")
  );
}

function recordAttempted(
  attempted: OfflineGradeDesired[],
  desired: OfflineGradeDesired,
): OfflineGradeDesired[] {
  const next = attempted.filter((item) => !sameDesired(item, desired));
  next.push(desired);
  return next.slice(-MAX_ATTEMPTED_SNAPSHOTS);
}

function serverGradeFromResult(result: ApiResult): Record<string, unknown> | null {
  const data = result.data;
  if (!data || typeof data !== "object") return null;
  const grade = (data as Record<string, unknown>).grade;
  return grade && typeof grade === "object"
    ? (grade as Record<string, unknown>)
    : null;
}

function desiredMatchesServerGrade(
  desired: OfflineGradeDesired,
  grade: Record<string, unknown> | null | undefined,
): boolean {
  if (!grade) return false;
  const status = String(grade.status || "");
  const score =
    grade.score === null || grade.score === undefined || grade.score === ""
      ? null
      : Number(grade.score);
  return (
    status === desired.status &&
    (desired.status === "درجة" ? score === desired.score : score === null) &&
    String(grade.notes || "") === String(desired.notes || "")
  );
}

function dispatch(event: GradeEntryOfflineEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<GradeEntryOfflineEvent>(EVENT_NAME, { detail: event }),
  );
}

function scheduleFlush(delayMs = RETRY_DELAY_MS): void {
  if (typeof window === "undefined") return;
  if (flushTimer) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushGradeEntryOfflineSaves();
  }, delayMs);
}

function installBrowserEvents(): void {
  if (typeof window === "undefined" || browserEventsInstalled) return;
  browserEventsInstalled = true;
  window.addEventListener("online", () => scheduleFlush(80));
  window.addEventListener("focus", () => {
    if (navigator.onLine) scheduleFlush(120);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      scheduleFlush(120);
    }
  });
}

export function subscribeGradeEntryOffline(
  listener: (event: GradeEntryOfflineEvent) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<GradeEntryOfflineEvent>).detail;
    if (detail?.item?.key) listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

export function getGradeEntryOfflineSaves(
  examId?: string,
): GradeEntryOfflineSave[] {
  installBrowserEvents();
  const items = readItems();
  return examId ? items.filter((item) => item.examId === examId) : items;
}

export function stageGradeEntryOfflineSave(input: {
  studentId: string;
  examId: string;
  status: OfflineGradeStatus;
  score: number | null;
  notes?: string;
  expectedUpdatedAt?: string;
  expectMissing?: boolean;
}): GradeEntryOfflineAttempt | null {
  installBrowserEvents();
  const studentId = String(input.studentId || "").trim();
  const examId = String(input.examId || "").trim();
  if (!studentId || !examId) return null;

  const desired: OfflineGradeDesired = {
    status: input.status,
    score: input.status === "درجة" ? input.score : null,
    notes: String(input.notes || ""),
  };
  const key = makeKey(examId, studentId);
  const items = readItems();
  const existingIndex = items.findIndex((item) => item.key === key);
  const existing = existingIndex >= 0 ? items[existingIndex] : null;
  const now = Date.now();
  const revision = makeRevision();

  const next: GradeEntryOfflineSave = existing
    ? {
        ...existing,
        revision,
        desired,
        expectedUpdatedAt:
          existing.state === "pending"
            ? existing.expectedUpdatedAt
            : String(input.expectedUpdatedAt || ""),
        expectMissing:
          existing.state === "pending"
            ? existing.expectMissing
            : Boolean(input.expectMissing),
        attempted:
          existing.state === "pending"
            ? recordAttempted(existing.attempted, existing.desired)
            : [],
        updatedAt: now,
        attempts: 0,
        state: "pending",
        lastError: undefined,
      }
    : {
        key,
        revision,
        studentId,
        examId,
        desired,
        expectedUpdatedAt: String(input.expectedUpdatedAt || ""),
        expectMissing: Boolean(input.expectMissing),
        attempted: [],
        queuedAt: now,
        updatedAt: now,
        attempts: 0,
        state: "pending",
      };

  if (existingIndex >= 0) items[existingIndex] = next;
  else items.push(next);
  if (!writeItems(items)) return null;

  const attempt = { key, revision, studentId, examId, desired };
  dispatch({ type: "queued", item: next });
  return attempt;
}

export function markGradeEntryOfflineAttempted(
  attempt: GradeEntryOfflineAttempt,
): void {
  updateItem(attempt.key, (item) => {
    if (item.revision !== attempt.revision) return item;
    return {
      ...item,
      attempted: recordAttempted(item.attempted, attempt.desired),
      updatedAt: Date.now(),
      state: "pending",
      lastError: undefined,
    };
  });
}

/**
 * Confirms a successful or reconciled attempt. If the user already created a
 * newer local revision while the request was in flight, that newer value is
 * preserved and its CAS baseline is advanced to the server grade we just
 * confirmed instead of deleting it.
 */
export function confirmGradeEntryOfflineAttempt(
  attempt: GradeEntryOfflineAttempt,
  serverGrade?: Record<string, unknown> | null,
): void {
  const current = readItems().find((item) => item.key === attempt.key);
  if (!current) return;

  if (current.revision === attempt.revision) {
    updateItem(attempt.key, () => null);
    return;
  }

  const serverUpdatedAt = String(serverGrade?.updatedAt || "").trim();
  updateItem(attempt.key, (item) => ({
    ...item,
    expectedUpdatedAt: serverUpdatedAt || item.expectedUpdatedAt,
    expectMissing: serverUpdatedAt ? false : item.expectMissing,
    attempted: item.attempted.filter(
      (snapshot) => !sameDesired(snapshot, attempt.desired),
    ),
    state: "pending",
    lastError: undefined,
    updatedAt: Date.now(),
  }));
  scheduleFlush(120);
}

export function markGradeEntryOfflineAttention(
  attempt: GradeEntryOfflineAttempt,
  state: "conflict" | "rejected",
  message: string,
): void {
  const next = updateItem(attempt.key, (item) => {
    if (item.revision !== attempt.revision) return item;
    return {
      ...item,
      state,
      lastError: message,
      updatedAt: Date.now(),
    };
  });
  if (next) dispatch({ type: state, item: next, message });
}

async function fetchCurrentGrade(
  item: GradeEntryOfflineSave,
): Promise<{ reachable: boolean; grade: Record<string, unknown> | null }> {
  try {
    const result = await gradeApi.list({
      examId: item.examId,
      studentId: item.studentId,
      page: 1,
      pageSize: 5,
    });
    if (!result) return { reachable: false, grade: null };
    const grade = (result.grades || []).find(
      (candidate) =>
        String(candidate.studentId || "") === item.studentId &&
        String(candidate.examId || "") === item.examId,
    );
    return {
      reachable: true,
      grade: grade && typeof grade === "object" ? grade : null,
    };
  } catch {
    return { reachable: false, grade: null };
  }
}

function buildPayload(item: GradeEntryOfflineSave): Record<string, unknown> {
  return {
    studentId: item.studentId,
    examId: item.examId,
    status: item.desired.status,
    score: item.desired.status === "درجة" ? item.desired.score : null,
    notes: item.desired.notes,
    expectedUpdatedAt: item.expectedUpdatedAt,
    expectMissing: item.expectMissing,
  };
}

function currentMatchesBaseline(
  item: GradeEntryOfflineSave,
  current: Record<string, unknown> | null,
): boolean {
  if (item.expectMissing) return !current;
  if (!item.expectedUpdatedAt) return false;
  return String(current?.updatedAt || "") === item.expectedUpdatedAt;
}

function currentMatchesAttempted(
  item: GradeEntryOfflineSave,
  current: Record<string, unknown> | null,
): boolean {
  if (!current) return false;
  return item.attempted.some((desired) =>
    desiredMatchesServerGrade(desired, current),
  );
}

function snapshotAttempt(item: GradeEntryOfflineSave): GradeEntryOfflineAttempt {
  return {
    key: item.key,
    revision: item.revision,
    studentId: item.studentId,
    examId: item.examId,
    desired: item.desired,
  };
}

function persistState(
  item: GradeEntryOfflineSave,
  patch: Partial<GradeEntryOfflineSave>,
): GradeEntryOfflineSave | null {
  return updateItem(item.key, (current) => {
    if (current.revision !== item.revision) return current;
    return { ...current, ...patch, updatedAt: Date.now() };
  });
}

async function flushOne(item: GradeEntryOfflineSave): Promise<
  "synced" | "pending" | "attention" | "superseded"
> {
  const latest = readItems().find((candidate) => candidate.key === item.key);
  if (!latest || latest.revision !== item.revision) return "superseded";
  if (latest.state !== "pending") return "attention";

  const currentLookup = await fetchCurrentGrade(latest);
  if (!currentLookup.reachable) return "pending";
  let currentGrade = currentLookup.grade;

  if (desiredMatchesServerGrade(latest.desired, currentGrade)) {
    updateItem(latest.key, (current) =>
      current.revision === latest.revision ? null : current,
    );
    dispatch({ type: "synced", item: latest, data: { grade: currentGrade } });
    return "synced";
  }

  let sendItem = latest;
  if (currentMatchesAttempted(latest, currentGrade)) {
    const updatedAt = String(currentGrade?.updatedAt || "").trim();
    const advanced = persistState(latest, {
      expectedUpdatedAt: updatedAt,
      expectMissing: !updatedAt,
      attempted: latest.attempted.filter(
        (snapshot) => !desiredMatchesServerGrade(snapshot, currentGrade),
      ),
      state: "pending",
      lastError: undefined,
    });
    if (!advanced || advanced.revision !== latest.revision) return "superseded";
    sendItem = advanced;
  } else if (!currentMatchesBaseline(latest, currentGrade)) {
    const message =
      "تغيرت هذه الدرجة على الخادم أثناء انقطاع الاتصال. احتفظ النظام بالنسخة المحلية ولم يكتب فوق التعديل الآخر.";
    const conflicted = persistState(latest, {
      state: "conflict",
      lastError: message,
    });
    if (conflicted) dispatch({ type: "conflict", item: conflicted, message });
    return "attention";
  }

  const attempt = snapshotAttempt(sendItem);
  markGradeEntryOfflineAttempted(attempt);
  const result = await gradeApi.add(buildPayload(sendItem));

  if (result.ok) {
    const serverGrade = serverGradeFromResult(result);
    confirmGradeEntryOfflineAttempt(attempt, serverGrade);
    dispatch({
      type: "synced",
      item: sendItem,
      data: result.data,
    });
    return "synced";
  }

  if (result.transient || result.outcomeUnknown || result.status === 0) {
    persistState(sendItem, {
      attempts: sendItem.attempts + 1,
      state: "pending",
      lastError: result.error,
    });
    return "pending";
  }

  // A 409 may simply mean the original request committed but its response was
  // lost. Re-read once before calling it a real conflict.
  if (result.status === 409) {
    const verification = await fetchCurrentGrade(sendItem);
    if (!verification.reachable) return "pending";
    currentGrade = verification.grade;
    if (desiredMatchesServerGrade(sendItem.desired, currentGrade)) {
      confirmGradeEntryOfflineAttempt(attempt, currentGrade);
      dispatch({
        type: "synced",
        item: sendItem,
        data: { grade: currentGrade },
      });
      return "synced";
    }
    const message =
      result.error ||
      "وجد النظام تعديلاً أحدث لنفس الدرجة. بقيت نسختك المحلية محفوظة للمراجعة ولم يتم استبدال بيانات الخادم.";
    const conflicted = persistState(sendItem, {
      state: "conflict",
      lastError: message,
    });
    if (conflicted) dispatch({ type: "conflict", item: conflicted, message });
    return "attention";
  }

  const message =
    result.error ||
    "رفض الخادم الدرجة المؤجلة. بقيت النسخة المحلية محفوظة حتى تتم مراجعتها.";
  const rejected = persistState(sendItem, {
    state: "rejected",
    lastError: message,
  });
  if (rejected) dispatch({ type: "rejected", item: rejected, message });
  return "attention";
}

export async function flushGradeEntryOfflineSaves(): Promise<number> {
  installBrowserEvents();
  if (!canUseStorage() || flushInFlight) return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;

  const pending = readItems().filter((item) => item.state === "pending");
  if (pending.length === 0) return 0;

  flushInFlight = true;
  announceTeacherProSyncPending(["grades"]);
  let synced = 0;
  let networkStopped = false;
  try {
    for (const item of pending) {
      const outcome = await flushOne(item);
      if (outcome === "synced") synced += 1;
      if (outcome === "pending") {
        networkStopped = true;
        break;
      }
    }
  } finally {
    flushInFlight = false;
  }

  if (synced > 0) {
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: `تمت مزامنة ${synced} درجة محفوظة محلياً`,
      scopes: ["grades", "students", "opportunities", "dashboard", "grade-entry-notes"],
    });
    announceTeacherProSyncSettled(["grades", "students", "opportunities"]);
  }

  const stillPending = readItems().some((item) => item.state === "pending");
  if (stillPending && !networkStopped) scheduleFlush(RETRY_DELAY_MS);
  if (stillPending && networkStopped && navigator.onLine) scheduleFlush(5000);
  return synced;
}

export function retryGradeEntryOfflineSave(key: string): void {
  const next = updateItem(key, (item) => ({
    ...item,
    state: "pending",
    lastError: undefined,
    attempts: 0,
    updatedAt: Date.now(),
  }));
  if (next) {
    dispatch({ type: "queued", item: next });
    scheduleFlush(80);
  }
}

export function clearGradeEntryOfflineSave(key: string): void {
  updateItem(key, () => null);
}

if (typeof window !== "undefined") {
  installBrowserEvents();
  if (navigator.onLine && readItems().some((item) => item.state === "pending")) {
    scheduleFlush(250);
  }
}
