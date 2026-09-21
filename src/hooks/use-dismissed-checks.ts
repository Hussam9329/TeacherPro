"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Student } from "@/lib/teacher-store";
import { readDismissedChecks, saveDismissedCheck, type DismissedCheckSnapshot } from "@/lib/dismissed-check-api";
import { emitTeacherProDataChanged, subscribeTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";

/** Shared flags are read from the server; browser storage never owns their values. */
export function useDismissedChecks(
  students: Student[],
  userId: string,
  canEdit: boolean,
  unavailable: boolean,
  onStatusChanged: () => void,
) {
  const [snapshots, setSnapshots] = useState<Record<string, DismissedCheckSnapshot>>({});
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Set<string>());
  const revision = useRef(0);
  const lifecycle = useRef(0);
  const readSequence = useRef(0);
  const currentUserId = useRef(userId);
  currentUserId.current = userId;
  const currentStudents = useRef(students);
  currentStudents.current = students;
  const onStatusChangedRef = useRef(onStatusChanged);
  onStatusChangedRef.current = onStatusChanged;
  const idsKey = JSON.stringify(students.filter((student) => student.status === "مفصول").map((student) => student.id).sort());
  const scopeKey = JSON.stringify([userId, students
    .filter((student) => student.status === "مفصول")
    .map((student) => [student.id, student.dismissedCheckEpoch ?? 0])
    .sort(([left], [right]) => String(left).localeCompare(String(right)))]);
  const currentScopeKey = useRef(scopeKey);
  currentScopeKey.current = scopeKey;
  const [snapshotScopeKey, setSnapshotScopeKey] = useState(scopeKey);

  useEffect(() => {
    // A flag belongs to the currently displayed dismissal, not to a permanent
    // browser cache. Leaving the page or reactivating a student retires it.
    pending.current.clear();
    setPendingIds(new Set());
    setSnapshots({});
    setSnapshotScopeKey(scopeKey);
    revision.current += 1;
    lifecycle.current += 1;
  }, [scopeKey]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const ids = JSON.parse(idsKey) as string[];
    if (!ids.length || document.visibilityState === "hidden") return;
    const request = ++readSequence.current;
    const startedRevision = revision.current;
    const rows = await readDismissedChecks(ids, signal);
    if (signal?.aborted || request !== readSequence.current || startedRevision !== revision.current || currentScopeKey.current !== scopeKey) return;
    const byId = new Map(currentStudents.current.map((student) => [student.id, student]));
    setSnapshots((previous) => {
      const next = { ...previous };
      for (const row of rows) {
        if (byId.get(row.id)?.status === "مفصول" && !pending.current.has(row.id)) next[row.id] = row;
      }
      return next;
    });
    if (rows.some((row) => byId.get(row.id)?.status !== row.status ||
      (byId.get(row.id)?.dismissedCheckEpoch ?? 0) !== row.dismissedCheckEpoch) || rows.length !== ids.length) {
      onStatusChangedRef.current();
    }
  }, [idsKey, scopeKey]);

  useEffect(() => {
    if (!userId || unavailable || idsKey === "[]") return;
    const controller = new AbortController();
    let reading = false;
    const poll = () => {
      if (reading || document.visibilityState === "hidden") return;
      reading = true;
      void refresh(controller.signal).catch(() => {
        // The main registry already exposes connection failures; don't toast every poll.
      }).finally(() => { reading = false; });
    };
    poll();
    const timer = window.setInterval(poll, 5_000);
    window.addEventListener("focus", poll);
    window.addEventListener("online", poll);
    document.addEventListener("visibilitychange", poll);
    const unsubscribe = subscribeTeacherProDataChanged((event) => {
      if (!event.scopes?.length || event.scopes.some((scope) => ["all", "students", "dismissed"].includes(scope))) poll();
    });
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", poll);
      window.removeEventListener("online", poll);
      document.removeEventListener("visibilitychange", poll);
      unsubscribe();
    };
  }, [refresh, userId, unavailable, idsKey]);

  const toggle = useCallback(async (student: Student, checked: boolean) => {
    const currentStudent = currentStudents.current.find((row) => row.id === student.id);
    if (!canEdit || unavailable || currentStudent?.status !== "مفصول" || pending.current.has(student.id)) return;
    const before = (snapshotScopeKey === scopeKey ? snapshots[student.id] : undefined) || {
      id: currentStudent.id, status: currentStudent.status, dismissedChecked: Boolean(currentStudent.dismissedChecked),
      dismissedCheckEpoch: currentStudent.dismissedCheckEpoch ?? 0,
    };
    if (before.status !== "مفصول" || before.dismissedChecked === checked) return;
    const startedUserId = userId;
    const startedLifecycle = lifecycle.current;
    const isCurrent = () => currentUserId.current === startedUserId &&
      currentScopeKey.current === scopeKey && lifecycle.current === startedLifecycle &&
      currentStudents.current.some((row) => row.id === student.id && row.status === "مفصول");
    pending.current.add(student.id);
    revision.current += 1;
    setPendingIds(new Set(pending.current));
    setSnapshots((previous) => ({ ...previous, [student.id]: { ...before, dismissedChecked: checked } }));
    try {
      const saved = await saveDismissedCheck(student.id, checked, before.dismissedChecked, before.dismissedCheckEpoch);
      if (!isCurrent()) return;
      setSnapshots((previous) => ({ ...previous, [student.id]: saved }));
      emitTeacherProDataChanged({ scopes: ["students", "logs"], reason: "تحديث اغلاق كود الطالب المفصول", dispatchLocal: false });
    } catch (error) {
      if (!isCurrent()) return;
      setSnapshots((previous) => ({ ...previous, [student.id]: before }));
      toast.error(error instanceof Error ? error.message : "تعذر حفظ اغلاق كود الطالب. يتم تحديث الحالة من النظام.");
    } finally {
      if (isCurrent()) {
        pending.current.delete(student.id);
        revision.current += 1;
        setPendingIds(new Set(pending.current));
        void refresh().catch(() => {});
      }
    }
  }, [canEdit, unavailable, snapshots, snapshotScopeKey, scopeKey, userId, refresh]);

  return {
    snapshots: snapshotScopeKey === scopeKey ? snapshots : {},
    pendingIds: snapshotScopeKey === scopeKey ? pendingIds : new Set<string>(),
    toggle,
  };
}
