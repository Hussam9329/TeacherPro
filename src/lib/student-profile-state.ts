/**
 * Pure state and presentation rules for the student profile.
 *
 * Keeping these rules outside React lets the profile defend against stale
 * requests and makes the behaviour executable in Node without a browser or a
 * database connection.
 */

export type StudentProfileRemoteStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export interface StudentProfileRemoteState<T> {
  studentId: string;
  requestId: number;
  status: StudentProfileRemoteStatus;
  data: T | null;
  error: string | null;
}

export function createStudentProfileRemoteState<T>(): StudentProfileRemoteState<T> {
  return {
    studentId: "",
    requestId: 0,
    status: "idle",
    data: null,
    error: null,
  };
}

export function beginStudentProfileRemoteLoad<T>(
  state: StudentProfileRemoteState<T>,
  studentId: string,
  requestId: number,
): StudentProfileRemoteState<T> {
  const normalizedStudentId = String(studentId || "").trim();
  const sameStudent = state.studentId === normalizedStudentId;
  return {
    studentId: normalizedStudentId,
    requestId,
    status: "loading",
    // A previous successful response is a safe temporary fallback only for
    // the same student. It must never cross the A -> B boundary.
    data: sameStudent ? state.data : null,
    error: null,
  };
}

export function succeedStudentProfileRemoteLoad<T>(
  state: StudentProfileRemoteState<T>,
  studentId: string,
  requestId: number,
  data: T,
): StudentProfileRemoteState<T> {
  if (state.studentId !== studentId || state.requestId !== requestId) {
    return state;
  }
  return {
    ...state,
    status: "ready",
    data,
    error: null,
  };
}

export function failStudentProfileRemoteLoad<T>(
  state: StudentProfileRemoteState<T>,
  studentId: string,
  requestId: number,
  error: string,
): StudentProfileRemoteState<T> {
  if (state.studentId !== studentId || state.requestId !== requestId) {
    return state;
  }
  return {
    ...state,
    status: "error",
    // Keep the last authoritative snapshot for this student. If none exists,
    // resolveStudentProfileRemoteData will explicitly use the local fallback.
    error: String(error || "تعذر تحميل بيانات ملف الطالب."),
  };
}

export function resolveStudentProfileRemoteData<T>(
  state: StudentProfileRemoteState<T>,
  studentId: string,
  localFallback: T,
): { data: T; source: "database" | "local"; incomplete: boolean } {
  if (state.studentId === studentId && state.data !== null) {
    return {
      data: state.data,
      source: "database",
      incomplete: state.status === "error",
    };
  }
  return {
    data: localFallback,
    source: "local",
    incomplete: state.status === "error",
  };
}

export type StudentProfileActiveChapter = {
  id?: string;
  name: string;
  opportunities?: number;
};

export function resolveStudentProfileActiveChapter(
  databaseStats: { activeChapter: StudentProfileActiveChapter | null } | null,
  studentActiveChapter: StudentProfileActiveChapter | null | undefined,
  courseActiveChapter: StudentProfileActiveChapter | null | undefined,
): StudentProfileActiveChapter | null {
  // A successful database response is authoritative. Its explicit null means
  // no unique active chapter (missing/conflicting), not "use stale cache".
  if (databaseStats) return databaseStats.activeChapter ?? null;
  return studentActiveChapter ?? courseActiveChapter ?? null;
}

export type StudentProfileGradeFilter =
  | "all"
  | "absent"
  | "grace"
  | "no-discount";

export type StudentProfileFollowupFilter =
  | "all"
  | "calls"
  | "leaves"
  | "notes";

export type StudentProfileCardKey =
  | "grades"
  | "absences"
  | "opportunities"
  | "calls"
  | "leaves"
  | "status-actions"
  | "notes"
  | "archives"
  | "timeline"
  | "exams"
  | "grace-grades"
  | "no-discount-grades";

export type StudentProfileCardTarget = {
  tab:
    | "details"
    | "grades"
    | "exams"
    | "opportunities"
    | "followup"
    | "actions"
    | "archives"
    | "timeline";
  gradeFilter: StudentProfileGradeFilter;
  followupFilter: StudentProfileFollowupFilter;
};

const CARD_TARGETS: Record<StudentProfileCardKey, StudentProfileCardTarget> = {
  grades: { tab: "grades", gradeFilter: "all", followupFilter: "all" },
  absences: { tab: "grades", gradeFilter: "absent", followupFilter: "all" },
  opportunities: {
    tab: "opportunities",
    gradeFilter: "all",
    followupFilter: "all",
  },
  calls: { tab: "followup", gradeFilter: "all", followupFilter: "calls" },
  leaves: { tab: "followup", gradeFilter: "all", followupFilter: "leaves" },
  "status-actions": {
    tab: "actions",
    gradeFilter: "all",
    followupFilter: "all",
  },
  notes: { tab: "followup", gradeFilter: "all", followupFilter: "notes" },
  archives: { tab: "archives", gradeFilter: "all", followupFilter: "all" },
  timeline: { tab: "timeline", gradeFilter: "all", followupFilter: "all" },
  exams: { tab: "exams", gradeFilter: "all", followupFilter: "all" },
  "grace-grades": {
    tab: "grades",
    gradeFilter: "grace",
    followupFilter: "all",
  },
  "no-discount-grades": {
    tab: "grades",
    gradeFilter: "no-discount",
    followupFilter: "all",
  },
};

export function getStudentProfileCardTarget(
  cardKey: StudentProfileCardKey,
): StudentProfileCardTarget {
  return CARD_TARGETS[cardKey];
}

export type StudentProfileFilterableGrade = {
  status?: string | null;
  withinGrace?: boolean;
  withoutDiscount?: boolean;
  impactKind?: string | null;
};

export function filterStudentProfileGrades<
  T extends StudentProfileFilterableGrade,
>(grades: readonly T[], filter: StudentProfileGradeFilter): T[] {
  if (filter === "all") return [...grades];
  if (filter === "absent") {
    return grades.filter(
      (grade) =>
        grade.impactKind
          ? grade.impactKind === "absent-deducted" || grade.impactKind === "absent-dismissal"
          : grade.status === "غائب" && !grade.withinGrace && !grade.withoutDiscount,
    );
  }
  if (filter === "grace") {
    return grades.filter((grade) =>
      grade.impactKind ? grade.impactKind === "grace-period" : Boolean(grade.withinGrace),
    );
  }
  return grades.filter(
    (grade) => !grade.withinGrace && Boolean(grade.withoutDiscount),
  );
}

export type StudentProfileTimelineInput = {
  grades: number;
  opportunityLogs: number;
  calls: number;
  leaves: number;
  notes: number;
  auditLogs: number;
};

export function calculateStudentProfileTimelineCount(
  input: StudentProfileTimelineInput,
): number {
  const safeCount = (value: number) =>
    Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
  return (
    1 +
    safeCount(input.grades) +
    safeCount(input.opportunityLogs) +
    safeCount(input.calls) +
    safeCount(input.leaves) +
    safeCount(input.notes) +
    safeCount(input.auditLogs)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsIdentityToken(haystack: string, token: string): boolean {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) return false;
  // Codes/IDs must not be embedded inside a longer Latin/digit identifier.
  const boundary = "A-Za-z0-9_";
  const pattern = new RegExp(
    `(^|[^${boundary}])${escapeRegExp(normalizedToken)}($|[^${boundary}])`,
    "iu",
  );
  return pattern.test(String(haystack || ""));
}

export function studentAuditLogMatchesIdentity(
  log: { details?: string | null },
  student: { id?: string | null; code?: string | null },
): boolean {
  const details = String(log.details || "");
  return [student.id, student.code].some((candidate) =>
    containsIdentityToken(details, String(candidate || "")),
  );
}
