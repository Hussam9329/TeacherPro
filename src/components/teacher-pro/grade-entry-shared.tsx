"use client";

// Types and small helpers shared by the grade entry page and its parts
// (grade-entry.tsx, grade-entry-filters.tsx, grade-entry-sheet.tsx, grade-entry-dialogs.tsx).
import React, { useEffect, useState } from "react";
import type { GradeStatus } from "@/lib/academic-types";
import { type OfflineGradeDesired } from "@/lib/grade-entry-offline-outbox";
import { Input } from "@/components/ui/input";
import { type ListChip } from "@/components/teacher-pro/list-toolbar";
import { toLatinDigits } from "@/lib/format";
import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { GRACE_PERIOD_EXCUSE_LABEL } from "@/lib/grace-periods";

export type DraftGrade = {
  status: GradeStatus;
  score: string;
  notes: string;
};

/** The «حالة الدرجة» buttons above the sheet; «الكل» is no filter. */
export const GRADE_STATUS_CHIPS: ListChip[] = [
  { key: "all", label: "الكل" },
  { key: "غير مسجل", label: "غير مسجل", tone: "warning" },
  { key: "درجة", label: "درجة", tone: "success" },
  { key: "غائب", label: "غائب", tone: "danger" },
  { key: "غش", label: "غش", tone: "danger" },
  { key: "ضمن السماح", label: GRACE_PERIOD_EXCUSE_LABEL, tone: "info" },
];

/** Whether a student on the sheet matches a «حالة الدرجة» filter ("" = all). */
export function matchesGradeStatusFilter(
  filter: string,
  state: { hasLeave: boolean; hasGrace: boolean; entered: boolean; status?: string },
) {
  if (!filter) return true;
  if (filter === "ضمن السماح") return state.hasGrace;
  if (filter === "غير مسجل") return !state.entered && !state.hasLeave;
  return !state.hasLeave && state.entered && !state.hasGrace && state.status === filter;
}

export type GradeEntryNotice = {
  type: "success" | "error" | "info";
  message: string;
  at: number;
};

export type GradeRowSavePhase =
  | "idle"
  | "dirty"
  | "saving"
  | "queued"
  | "saved"
  | "pending"
  | "error";

export type GradeRowSaveState = {
  phase: GradeRowSavePhase;
  message?: string;
};

export type PendingConfirm = {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

export const GradeEntrySearchInput = React.memo(function GradeEntrySearchInput({
  value,
  onCommit,
  onForwardTab,
}: {
  value: string;
  onCommit: (value: string) => void;
  onForwardTab: () => boolean;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const timer = window.setTimeout(() => onCommit(localValue), 90);
    return () => window.clearTimeout(timer);
  }, [localValue, onCommit]);

  return (
    <Input
      id="grade-entry-search"
      name="search"
      data-teacherpro-search="true"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Tab" && !event.shiftKey) {
          const focused = onForwardTab();
          if (focused) event.preventDefault();
        }
      }}
      placeholder="اسم / كود / تليگرام / محافظة"
      autoComplete="off"
      className="h-10"
    />
  );
});

export function normalizeGradeScoreInput(value: string, fullMark: number) {
  const normalized = toLatinDigits(value).trim();
  if (!normalized) return "";
  const score = Number(normalized);
  if (!Number.isFinite(score)) return normalized;
  if (score < 0) return "0";
  if (score > fullMark) return String(fullMark);
  return normalized;
}

export function offlineDesiredToDraft(desired: OfflineGradeDesired): DraftGrade {
  return {
    status: desired.status,
    score:
      desired.status === "درجة" && desired.score !== null
        ? String(desired.score)
        : "",
    notes: desired.notes || "",
  };
}

export function draftMatchesOfflineDesired(
  draft: DraftGrade | undefined,
  desired: OfflineGradeDesired,
): boolean {
  if (!draft || draft.status !== desired.status) return false;
  const score =
    draft.status === "درجة"
      ? Number(toLatinDigits(draft.score).trim())
      : null;
  return (
    (draft.status === "درجة" ? score === desired.score : desired.score === null) &&
    (draft.notes || "") === (desired.notes || "")
  );
}

export function formatGradeEntryTimestamp(value?: string | Date | null): string {
  return formatBaghdadDateTime(value, "غير معروف");
}
