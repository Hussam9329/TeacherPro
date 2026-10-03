/**
 * Pure state and presentation rules for the student profile.
 *
 * Keeping these rules outside React makes the behaviour executable in Node
 * without a browser or a database connection.
 */

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
