import {
  isExamAvailableForEntry,
  isGradeEntered,
  isExamOnOrAfterStudentRegistration,
} from "./exam-utils";
export { isExamWithinStudentGraceWindow } from "./student-grace";
import { isExamWithinStudentGraceWindow } from "./student-grace";
import { baghdadDateKey, baghdadTodayKey } from "./baghdad-time";
import type {
  AcademicChapter,
  AcademicCourseChapter,
  AcademicExam,
  AcademicGrade,
  AcademicOpportunityLog,
  AcademicReactivationLink,
  AcademicRecalculationResult,
  AcademicStateInput,
  AcademicStudent,
  AcademicStudentLeave,
  AcademicStudentNote,
  GradeImpact,
  StudentLeaveType,
} from "./academic-types";

const ACADEMIC_REACTIVATION_LINK_PREFIX = "[academic-reactivation-link:";
const ACADEMIC_REACTIVATION_LINK_SUFFIX = "]";

function todayISO(): string {
  return baghdadTodayKey();
}

function dayKey(value: string | Date | null | undefined): string {
  return baghdadDateKey(value);
}

export function isRuleManagedDismissal(
  student: Pick<AcademicStudent, "dismissalReason">,
): boolean {
  const reason = student.dismissalReason || "";
  return [
    "غياب امتحان",
    "غياب ضمن درجة الفصل",
    "أول حالة غش",
    "غش متكرر",
    "درجة فصل",
    "درجة صفر",
    "انتهاء الفرص",
    "غياب امتحان",
    "فصل امتحان",
  ].some((part) => reason.includes(part));
}

export function examPenaltyValue(exam: Pick<AcademicExam, "noDiscount" | "opportunitiesPenalty">): number {
  if (exam.noDiscount) return 0;
  const numeric = Number(exam.opportunitiesPenalty);
  // Old or partially migrated rows may contain 0/invalid values even though
  // current exam validation requires a positive integer. A discountable exam
  // must never turn into a silent zero-penalty exam because of that legacy
  // value; use the documented default of one opportunity.
  return Number.isFinite(numeric) && numeric > 0
    ? Math.max(1, Math.trunc(numeric))
    : 1;
}

export function isAutomaticOpportunityLog(log: AcademicOpportunityLog): boolean {
  return (
    log.action === "خصم تلقائي" ||
    log.action === "فصل تلقائي" ||
    String(log.reason || "").startsWith("تلقائي:")
  );
}

function automaticOpportunityLogId(
  studentId: string,
  examId: string,
  sourceId: string,
  action: string,
  reason: string,
): string {
  const slug = `${action}-${reason}`
    .replace(/[^A-Za-z0-9\u0600-\u06FF]+/g, "-")
    .slice(0, 32);
  return `auto_${studentId}_${examId}_${sourceId || "exam"}_${slug}`;
}

export function encodeAcademicReactivationLink(
  link: Partial<AcademicReactivationLink>,
): string {
  const params = new URLSearchParams();
  if (link.sourceGradeId) params.set("sourceGradeId", link.sourceGradeId);
  if (link.sourceExamId) params.set("sourceExamId", link.sourceExamId);
  if (link.sourceAutomaticLogId)
    params.set("sourceAutomaticLogId", link.sourceAutomaticLogId);
  params.set("reactivationMode", link.reactivationMode || "بسبب إجراء تلقائي");
  return `${ACADEMIC_REACTIVATION_LINK_PREFIX}${params.toString()}${ACADEMIC_REACTIVATION_LINK_SUFFIX}`;
}

export function parseAcademicReactivationLink(
  reason: string | null | undefined,
): AcademicReactivationLink | null {
  const text = String(reason || "");
  const start = text.indexOf(ACADEMIC_REACTIVATION_LINK_PREFIX);
  if (start < 0) return null;
  const valueStart = start + ACADEMIC_REACTIVATION_LINK_PREFIX.length;
  const end = text.indexOf(ACADEMIC_REACTIVATION_LINK_SUFFIX, valueStart);
  if (end < 0) return null;
  const params = new URLSearchParams(text.slice(valueStart, end));
  return {
    sourceGradeId: params.get("sourceGradeId") || "",
    sourceExamId: params.get("sourceExamId") || "",
    sourceAutomaticLogId: params.get("sourceAutomaticLogId") || "",
    reactivationMode: params.get("reactivationMode") || "بسبب إجراء تلقائي",
  };
}

export function isLinkedAcademicReactivationLog(log: AcademicOpportunityLog): boolean {
  return Boolean(parseAcademicReactivationLink(log.reason));
}

export function isReactivationOpportunityLog(log: AcademicOpportunityLog): boolean {
  return (
    log.action === "إعادة تفعيل" ||
    String(log.reason || "").includes("تثبيت إعادة التفعيل")
  );
}

export function isFinalChanceOpportunityLog(log: AcademicOpportunityLog): boolean {
  return (
    log.action === "فرصة أخيرة بعد تعهد" ||
    String(log.reason || "").includes("فرصة أخيرة")
  );
}

export function isSystemAcademicReactivationLog(log: AcademicOpportunityLog): boolean {
  const reason = String(log.reason || "");
  return (
    (isReactivationOpportunityLog(log) || isFinalChanceOpportunityLog(log)) &&
    (reason.includes("تثبيت إعادة التفعيل") ||
      reason.includes("إرجاع الطالب بعد إعادة التفعيل") ||
      reason.includes("بفرصة واحدة"))
  );
}

function academicReactivationLinkMatchesExam(
  link: AcademicReactivationLink | null,
  examId: string,
): boolean {
  return Boolean(link && link.sourceExamId && link.sourceExamId === examId);
}

export function opportunityLogBelongsToExam(
  log: AcademicOpportunityLog,
  examId: string,
): boolean {
  if (log.examId === examId) return true;
  return academicReactivationLinkMatchesExam(
    parseAcademicReactivationLink(log.reason),
    examId,
  );
}

function academicReactivationSourceKey(
  link: AcademicReactivationLink | null,
): string {
  if (!link) return "";
  if (link.sourceGradeId) return `grade:${link.sourceGradeId}`;
  if (link.sourceExamId) return `exam:${link.sourceExamId}`;
  if (link.sourceAutomaticLogId) return `log:${link.sourceAutomaticLogId}`;
  return "";
}

function gradeMatchesAcademicReactivationLink(
  grade: AcademicGrade,
  link: AcademicReactivationLink | null,
): boolean {
  if (!link) return false;
  if (link.sourceGradeId && grade.id === link.sourceGradeId) return true;
  if (link.sourceExamId && grade.examId === link.sourceExamId) return true;
  return false;
}

function automaticLogMatchesAcademicReactivationLink(
  log: AcademicOpportunityLog,
  link: AcademicReactivationLink | null,
  grades: AcademicGrade[],
): boolean {
  if (!link) return false;
  if (link.sourceAutomaticLogId && log.id === link.sourceAutomaticLogId)
    return true;
  if (link.sourceExamId && log.examId === link.sourceExamId) {
    if (!link.sourceGradeId) return true;
    return grades.some(
      (grade) =>
        grade.id === link.sourceGradeId &&
        grade.studentId === log.studentId &&
        grade.examId === log.examId,
    );
  }
  return false;
}

function normalizeLeaveType(value: unknown): StudentLeaveType {
  return value === "period" ? "period" : "exam";
}

export function normalizeStudentLeave(
  leaveInput: Partial<AcademicStudentLeave> | Record<string, unknown>,
): AcademicStudentLeave {
  const leave = leaveInput as Partial<AcademicStudentLeave> & Record<string, unknown>;
  const leaveType = normalizeLeaveType(leave.leaveType);
  const date = dayKey(leave.date) || todayISO();
  const dateFrom = dayKey(leave.dateFrom) || date;
  const dateTo = dayKey(leave.dateTo) || dateFrom;
  const relatedStudent =
    leave.student && typeof leave.student === "object"
      ? (leave.student as Partial<AcademicStudent>)
      : null;
  const relatedExam =
    leave.exam && typeof leave.exam === "object"
      ? (leave.exam as Partial<AcademicExam>)
      : null;
  return {
    id: String(leave.id || ""),
    studentId: String(leave.studentId || relatedStudent?.id || ""),
    examId: String(leave.examId || relatedExam?.id || ""),
    leaveType,
    reason: String(leave.reason || ""),
    studyType: String(leave.studyType || ""),
    date,
    dateFrom: dateFrom <= dateTo ? dateFrom : dateTo,
    dateTo: dateFrom <= dateTo ? dateTo : dateFrom,
    notes: String(leave.notes || ""),
    student: relatedStudent,
    exam: relatedExam,
  };
}

export function studentLeaveAppliesToExam(
  leave: AcademicStudentLeave,
  studentId: string,
  exam: AcademicExam | undefined,
): boolean {
  if (!exam || leave.studentId !== studentId) return false;
  const normalized = normalizeStudentLeave(leave);
  if (normalized.leaveType === "period") {
    const examDate = dayKey(exam.date);
    return Boolean(
      examDate &&
      examDate >= normalized.dateFrom &&
      examDate <= normalized.dateTo,
    );
  }
  return normalized.examId === exam.id;
}

export function isStudentExcusedForExam(
  state: Pick<AcademicStateInput, "studentLeaves" | "exams">,
  studentId: string,
  examId: string,
): boolean {
  const exam = state.exams.find((item) => item.id === examId);
  return state.studentLeaves.some((leave) =>
    studentLeaveAppliesToExam(leave, studentId, exam),
  );
}

export function affectedExamIdsForLeave(
  leave: AcademicStudentLeave,
  state: Pick<AcademicStateInput, "exams">,
): string[] {
  const normalized = normalizeStudentLeave(leave);
  if (normalized.leaveType === "exam")
    return normalized.examId ? [normalized.examId] : [];
  return state.exams
    .filter((exam) =>
      studentLeaveAppliesToExam(normalized, normalized.studentId, exam),
    )
    .map((exam) => exam.id);
}

export function gradeHasAcademicEffect(grade: AcademicGrade, exam: AcademicExam): boolean {
  if (!isExamAvailableForEntry(exam)) return false;
  if (!isGradeEntered(grade, exam)) return false;
  if (grade.status === "غش") return true;
  if (exam.noDiscount) return false;
  if (grade.status === "غائب") return true;
  if (grade.status !== "درجة" || grade.score === null) return false;
  const score = Number(grade.score);
  if (exam.type === "فاينل") {
    return (
      score === 0 ||
      (exam.dismissalGrade !== null && score <= exam.dismissalGrade)
    );
  }
  return score <= exam.discountMark;
}

export function gradeCausesDismissalGradeEffect(
  grade: AcademicGrade,
  exam: AcademicExam,
): boolean {
  if (!gradeHasAcademicEffect(grade, exam)) return false;
  if (grade.status === "غش") return true;
  if (grade.status === "غائب") return exam.type === "فاينل";
  if (grade.status !== "درجة" || grade.score === null) return false;
  const score = Number(grade.score);
  if (exam.type === "فاينل") {
    return (
      score === 0 ||
      (exam.dismissalGrade !== null && score <= exam.dismissalGrade)
    );
  }
  return false;
}

export function classifyGradeImpact(
  grade: AcademicGrade,
  exam: AcademicExam,
  opportunitiesBefore: number,
  hasPriorDismissalEvent = false,
): GradeImpact {
  if (!gradeHasAcademicEffect(grade, exam)) {
    return { type: "none", reason: "", penalty: 0, priority: -1 };
  }

  if (grade.status === "غش") {
    return {
      type: hasPriorDismissalEvent ? "final_dismissal" : "temporary_dismissal",
      reason: hasPriorDismissalEvent
        ? `غش متكرر في امتحان: ${exam.name}`
        : `أول حالة غش في امتحان: ${exam.name}`,
      penalty: Math.max(0, opportunitiesBefore),
      priority: hasPriorDismissalEvent ? 100 : 80,
    };
  }

  if (exam.noDiscount) {
    return { type: "none", reason: "", penalty: 0, priority: -1 };
  }

  if (grade.status === "غائب") {
    if (exam.type === "فاينل") {
      return {
        type: "temporary_dismissal",
        reason: `غياب ضمن درجة الفصل في امتحان ${exam.type}: ${exam.name}`,
        penalty: Math.max(0, opportunitiesBefore),
        priority: 75,
      };
    }
    const penalty = examPenaltyValue(exam);
    if (hasPriorDismissalEvent) {
      return {
        type: "temporary_dismissal",
        reason: `غياب في امتحان ${exam.type} بعد فصل سابق: ${exam.name}`,
        penalty,
        priority: 85,
      };
    }
    if (opportunitiesBefore - penalty <= 0) {
      return {
        type: "temporary_dismissal",
        reason: `انتهاء الفرص بعد غياب في امتحان ${exam.type}: ${exam.name}`,
        penalty,
        priority: 60,
      };
    }
    return {
      type: "discount",
      reason: `غياب في امتحان ${exam.type}: ${exam.name}`,
      penalty,
      priority: 10,
    };
  }

  if (grade.status === "درجة" && grade.score !== null) {
    const score = Number(grade.score);
    if (exam.type === "فاينل") {
      if (score === 0) {
        return {
          type: "temporary_dismissal",
          reason: `درجة صفر في امتحان ${exam.type}: ${exam.name}`,
          penalty: Math.max(0, opportunitiesBefore),
          priority: 76,
        };
      }
      if (exam.dismissalGrade !== null && score <= exam.dismissalGrade) {
        return {
          type: "temporary_dismissal",
          reason: `درجة فصل (${score}): ${exam.name}`,
          penalty: Math.max(0, opportunitiesBefore),
          priority: 75,
        };
      }
      return { type: "none", reason: "", penalty: 0, priority: -1 };
    }

    if (score <= exam.discountMark) {
      const penalty = examPenaltyValue(exam);
      if (hasPriorDismissalEvent) {
        return {
          type: "temporary_dismissal",
          reason: `درجة خصم (${score}) بعد فصل سابق في امتحان ${exam.type}: ${exam.name}`,
          penalty,
          priority: 85,
        };
      }
      if (opportunitiesBefore - penalty <= 0) {
        return {
          type: "temporary_dismissal",
          reason: `انتهاء الفرص بعد درجة خصم (${score}) في امتحان: ${exam.name}`,
          penalty,
          priority: 60,
        };
      }
      return {
        type: "discount",
        reason: `درجة ${score} ضمن الخصم في امتحان: ${exam.name}`,
        penalty,
        priority: 10,
      };
    }
  }

  return { type: "none", reason: "", penalty: 0, priority: -1 };
}

function latestStudentLogDate(
  logs: AcademicOpportunityLog[],
  predicate: (log: AcademicOpportunityLog) => boolean,
): string {
  const dates = logs
    .filter(predicate)
    .map((log) => dayKey(log.date))
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : "";
}

function latestManualDismissalDateForStudent(
  state: Pick<AcademicStateInput, "opportunityLogs" | "studentNotes">,
  studentId: string,
): string {
  const logDates = state.opportunityLogs
    .filter(
      (log) =>
        log.studentId === studentId &&
        log.action === "خصم" &&
        String(log.reason || "").startsWith("فصل الطالب"),
    )
    .map((log) => dayKey(log.date))
    .filter(Boolean);
  const noteDates = (state.studentNotes || [])
    .filter(
      (note) =>
        note.studentId === studentId &&
        note.kind === "إجراء" &&
        String(note.text || "").startsWith("فصل الطالب"),
    )
    .map((note) => dayKey(note.date))
    .filter(Boolean);
  const dates = [...logDates, ...noteDates].sort();
  return dates.length ? dates[dates.length - 1] : "";
}

function findLatestAcademicReactivationSourceForStudent(
  state: Pick<
    AcademicStateInput,
    "grades" | "exams" | "opportunityLogs" | "studentLeaves"
  >,
  student: AcademicStudent,
): Partial<AcademicReactivationLink> | null {
  const examsById = new Map(state.exams.map((exam) => [exam.id, exam]));
  const normalizedLeaves = (state.studentLeaves || []).map((leave) =>
    normalizeStudentLeave(leave),
  );

  const studentAutomaticLogs = state.opportunityLogs
    .filter(
      (log) => log.studentId === student.id && isAutomaticOpportunityLog(log),
    )
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const dismissalLog =
    studentAutomaticLogs.find((log) => log.action === "فصل تلقائي") ||
    studentAutomaticLogs[0];
  if (dismissalLog) {
    const sourceGrade = state.grades.find(
      (grade) =>
        grade.studentId === student.id && grade.examId === dismissalLog.examId,
    );
    return {
      sourceGradeId: sourceGrade?.id || "",
      sourceExamId: dismissalLog.examId || sourceGrade?.examId || "",
      sourceAutomaticLogId: dismissalLog.id,
      reactivationMode: "بسبب إجراء تلقائي",
    };
  }

  const fallbackGrade = state.grades
    .filter((grade) => grade.studentId === student.id)
    .sort((a, b) =>
      String(b.updatedAt || b.createdAt || "").localeCompare(
        String(a.updatedAt || a.createdAt || ""),
      ),
    )
    .find((grade) => {
      const exam = examsById.get(grade.examId);
      if (!exam) return false;
      if (!isExamAvailableForEntry(exam)) return false;
      if (!isGradeEntered(grade, exam)) return false;
      if (!isExamOnOrAfterStudentRegistration(student, exam)) return false;
      if (
        normalizedLeaves.some((leave) =>
          studentLeaveAppliesToExam(leave, student.id, exam),
        )
      )
        return false;
      if (isExamWithinStudentGraceWindow(student, exam)) return false;
      return gradeCausesDismissalGradeEffect(grade, exam);
    });

  if (!fallbackGrade) return null;
  return {
    sourceGradeId: fallbackGrade.id,
    sourceExamId: fallbackGrade.examId,
    sourceAutomaticLogId: "",
    reactivationMode: "بسبب إجراء تلقائي",
  };
}

function resolveAcademicReactivationLinkForLog(
  log: AcademicOpportunityLog,
  state: Pick<
    AcademicStateInput,
    "grades" | "exams" | "opportunityLogs" | "studentLeaves"
  >,
  student: AcademicStudent,
): AcademicReactivationLink | null {
  const parsed = parseAcademicReactivationLink(log.reason);
  if (parsed) return parsed;
  if (!isSystemAcademicReactivationLog(log)) return null;
  const inferred = findLatestAcademicReactivationSourceForStudent(
    state,
    student,
  );
  if (!inferred) return null;
  return {
    sourceGradeId: inferred.sourceGradeId || "",
    sourceExamId: inferred.sourceExamId || "",
    sourceAutomaticLogId: inferred.sourceAutomaticLogId || "",
    reactivationMode: inferred.reactivationMode || "بسبب إجراء تلقائي",
  };
}

export function isAcademicallyManagedOpportunityLog(log: AcademicOpportunityLog): boolean {
  return (
    isAutomaticOpportunityLog(log) ||
    isLinkedAcademicReactivationLog(log) ||
    isSystemAcademicReactivationLog(log)
  );
}

export function findAcademicReactivationSourceForStudent(
  state: Pick<
    AcademicStateInput,
    "grades" | "exams" | "opportunityLogs" | "studentLeaves"
  >,
  student: AcademicStudent,
): Partial<AcademicReactivationLink> | null {
  if (!isRuleManagedDismissal(student)) return null;
  return findLatestAcademicReactivationSourceForStudent(state, student);
}

export function recalculateAcademicState(
  state: AcademicStateInput,
  targetStudentIds?: Set<string>,
): AcademicRecalculationResult {
  const examsById = new Map(state.exams.map((exam) => [exam.id, exam]));
  const activeCourseChapterGroups = new Map<string, AcademicCourseChapter[]>();
  for (const link of state.courseChapters.filter(
    (item) => item.active && !item.archived,
  )) {
    const links = activeCourseChapterGroups.get(link.courseId) || [];
    links.push(link);
    activeCourseChapterGroups.set(link.courseId, links);
  }
  const activeCourseChapterByCourse = new Map(
    Array.from(activeCourseChapterGroups.entries())
      .filter(([, links]) => links.length === 1)
      .map(([courseId, links]) => [courseId, links[0]]),
  );
  const manualLogs = state.opportunityLogs.filter(
    (log) => !isAutomaticOpportunityLog(log),
  );
  const previousAutomaticLogs = state.opportunityLogs.filter(
    isAutomaticOpportunityLog,
  );
  const hasScopedRecalculation = Boolean(targetStudentIds?.size);
  const automaticLogs: AcademicOpportunityLog[] = [];
  const normalizedLeaves = (state.studentLeaves || []).map((leave) =>
    normalizeStudentLeave(leave),
  );
  const activeLinkedSourcesByStudent = new Map<
    string,
    AcademicReactivationLink[]
  >();
  const resolvedAcademicLinksByOpportunityLogId = new Map<
    string,
    AcademicReactivationLink
  >();

  const students = state.students.map((student) => {
    const isTargetStudent =
      !hasScopedRecalculation || targetStudentIds?.has(student.id);
    if (!isTargetStudent) return student;

    const manualDismissal =
      student.status === "مفصول" && !isRuleManagedDismissal(student);
    const manualDismissalDate = manualDismissal
      ? latestManualDismissalDateForStudent(state, student.id)
      : "";
    let hasAcademicEventAfterManualDismissal = false;

    const allStudentManualLogs = manualLogs
      .filter((log) => log.studentId === student.id)
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    const historicalSettlementDate = latestStudentLogDate(
      allStudentManualLogs,
      (log) => String(log.reason || "").startsWith("تسوية تاريخية:"),
    );

    const hasIndependentManualReactivation =
      student.status === "نشط" &&
      allStudentManualLogs.some((log) => {
        return (
          isReactivationOpportunityLog(log) &&
          !isLinkedAcademicReactivationLog(log) &&
          !isSystemAcademicReactivationLog(log)
        );
      });
    if (!hasScopedRecalculation && hasIndependentManualReactivation)
      return student;

    const activeCourseChapter = activeCourseChapterByCourse.get(
      student.courseId,
    );
    const activeChapter = activeCourseChapter
      ? state.chapters.find(
          (chapter) => chapter.id === activeCourseChapter.chapterId,
        )
      : null;
    const studentGrades = state.grades
      .filter((grade) => grade.studentId === student.id)
      .filter((grade) => {
        // اعتبر بس درجات الامتحانات اللي تنتمي لدورة الطالب الحالية.
        // هذا يمنع درجات دورة قديمة من التأثير على فرص الطالب بعد نقله
        // لدورة جديدة (خصوصاً عند اختيار "اعتباره طالب جديد").
        const exam = examsById.get(grade.examId);
        if (!exam) return false;
        const examCourseIds = exam.courseIds || [];
        return examCourseIds.includes(student.courseId);
      })
      .sort((a, b) =>
        String(a.createdAt || "").localeCompare(String(b.createdAt || "")),
      );

    const resolvedAcademicLinksByLogId = new Map<
      string,
      AcademicReactivationLink
    >();
    const linkedSourceLinks = allStudentManualLogs
      .map((log) => {
        const link = resolveAcademicReactivationLinkForLog(log, state, student);
        if (link && academicReactivationSourceKey(link))
          resolvedAcademicLinksByLogId.set(log.id, link);
        return link;
      })
      .filter((link): link is AcademicReactivationLink =>
        Boolean(link && academicReactivationSourceKey(link)),
      );
    resolvedAcademicLinksByLogId.forEach((link, logId) =>
      resolvedAcademicLinksByOpportunityLogId.set(logId, link),
    );
    const activeLinkedSources = linkedSourceLinks.filter(
      (link, index, links) => {
        const key = academicReactivationSourceKey(link);
        if (
          links.findIndex(
            (item) => academicReactivationSourceKey(item) === key,
          ) !== index
        )
          return false;
        return studentGrades.some((grade) => {
          if (!gradeMatchesAcademicReactivationLink(grade, link)) return false;
          const exam = examsById.get(grade.examId);
          if (!exam) return false;
          if (!isExamOnOrAfterStudentRegistration(student, exam)) return false;
          if (
            normalizedLeaves.some((leave) =>
              studentLeaveAppliesToExam(leave, student.id, exam),
            )
          )
            return false;
          if (isExamWithinStudentGraceWindow(student, exam)) return false;
          return gradeHasAcademicEffect(grade, exam);
        });
      },
    );
    if (activeLinkedSources.length > 0)
      activeLinkedSourcesByStudent.set(student.id, activeLinkedSources);

    const studentManualLogs = allStudentManualLogs.filter((log) => {
      const link =
        parseAcademicReactivationLink(log.reason) ||
        resolvedAcademicLinksByLogId.get(log.id) ||
        null;
      if (!link) return !isSystemAcademicReactivationLog(log);
      const key = academicReactivationSourceKey(link);
      return Boolean(
        key &&
        activeLinkedSources.some(
          (activeLink) => academicReactivationSourceKey(activeLink) === key,
        ),
      );
    });

    let opportunities = Number(
      activeChapter?.opportunities ?? student.baseOpportunities ?? 0,
    );
    let dismissalType = "";
    let dismissalReason = "";
    let dismissalPriority = -1;
    let cheatCount = 0;

    const hasFinalChancePledge = studentManualLogs.some(
      isFinalChanceOpportunityLog,
    );
    let hasPriorDismissalEvent = manualDismissal || hasFinalChancePledge;
    const finalChanceStartDate = latestStudentLogDate(
      studentManualLogs,
      isFinalChanceOpportunityLog,
    );
    studentManualLogs.forEach((log) => {
      if (
        finalChanceStartDate &&
        !isFinalChanceOpportunityLog(log) &&
        dayKey(log.date) < finalChanceStartDate
      )
        return;
      const amount = Math.abs(Number(log.amount || 0));
      if (!amount && !isFinalChanceOpportunityLog(log)) return;
      if (isFinalChanceOpportunityLog(log)) opportunities = amount || 1;
      else if (log.action === "إضافة") opportunities += amount;
      if (log.action === "خصم") opportunities -= amount;
      if (log.action === "إعادة تعيين")
        opportunities = Number(
          activeChapter?.opportunities ?? student.baseOpportunities ?? 0,
        );
    });

    const addAutomaticLog = (
      exam: AcademicExam,
      sourceId: string,
      action: string,
      amount: number,
      reason: string,
    ) => {
      if (amount <= 0 && action === "خصم تلقائي") return;
      automaticLogs.push({
        id: automaticOpportunityLogId(
          student.id,
          exam.id,
          sourceId,
          action,
          reason,
        ),
        studentId: student.id,
        examId: exam.id,
        action,
        amount: Math.max(0, Math.trunc(amount)),
        reason: `تلقائي: ${reason}`,
        date: exam.date || todayISO(),
        chapterId: activeChapter?.id || activeCourseChapter?.chapterId || "",
        chapterNameSnapshot: activeChapter?.name || "",
      });
    };

    const consumeAllRemainingOpportunities = (
      exam: AcademicExam,
      sourceId: string,
      reason: string,
    ) => {
      const deducted = Math.max(0, Math.trunc(opportunities));
      if (deducted > 0) {
        addAutomaticLog(
          exam,
          sourceId || exam.id,
          "خصم تلقائي",
          deducted,
          `${reason} - خصم جميع الفرص بسبب الفصل`,
        );
      }
      opportunities = 0;
    };

    const setDismissal = (
      type: string,
      reason: string,
      priority: number,
      exam?: AcademicExam,
      sourceId?: string,
    ) => {
      const finalChanceViolation = hasFinalChancePledge && type === "فصل مؤقت";
      const secondDismissalViolation =
        hasPriorDismissalEvent && type === "فصل مؤقت";
      const shouldBeFinal = finalChanceViolation || secondDismissalViolation;
      const effectiveType = shouldBeFinal ? "فصل نهائي" : type;
      const effectiveReason = finalChanceViolation
        ? `عدم الالتزام بالتعهد السابق - ${reason}`
        : secondDismissalViolation
          ? `الفصل الثاني للطالب - ${reason}`
          : reason;
      const effectivePriority = shouldBeFinal
        ? Math.max(priority, 90)
        : priority;
      if (effectivePriority >= dismissalPriority) {
        dismissalType = effectiveType;
        dismissalReason = effectiveReason;
        dismissalPriority = effectivePriority;
      }
      if (exam) {
        consumeAllRemainingOpportunities(
          exam,
          sourceId || exam.id,
          effectiveReason,
        );
        addAutomaticLog(
          exam,
          sourceId || exam.id,
          "فصل تلقائي",
          0,
          effectiveReason,
        );
      }
      hasPriorDismissalEvent = true;
    };

    const isProtectedLinkedSourceGrade = (grade: AcademicGrade): boolean => {
      return activeLinkedSources.some((link) =>
        gradeMatchesAcademicReactivationLink(grade, link),
      );
    };

    for (const grade of studentGrades) {
      const exam = examsById.get(grade.examId);
      if (!exam) continue;
      if (
        grade.status === "مجاز" ||
        String(grade.notes || "").startsWith("تسوية تاريخية بلا أثر:")
      )
        continue;
      if (!isExamAvailableForEntry(exam)) continue;
      if (!isGradeEntered(grade, exam)) continue;
      const examEventDate = dayKey(exam.date || grade.createdAt || "");
      if (
        historicalSettlementDate &&
        examEventDate &&
        examEventDate <= historicalSettlementDate &&
        !String(grade.notes || "").startsWith(
          "أثر أكاديمي فعّال بعد التسوية:",
        )
      )
        continue;
      const gradeEventDate = dayKey(
        grade.updatedAt || grade.createdAt || exam.date || "",
      );
      if (finalChanceStartDate && gradeEventDate < finalChanceStartDate)
        continue;
      if (
        manualDismissal &&
        manualDismissalDate &&
        gradeEventDate &&
        gradeEventDate < manualDismissalDate
      )
        continue;
      if (!isExamOnOrAfterStudentRegistration(student, exam)) continue;
      if (
        normalizedLeaves.some((leave) =>
          studentLeaveAppliesToExam(leave, student.id, exam),
        )
      )
        continue;
      if (isExamWithinStudentGraceWindow(student, exam)) continue;
      const gradeHasEffect = gradeHasAcademicEffect(grade, exam);
      if (isProtectedLinkedSourceGrade(grade) && gradeHasEffect) continue;
      if (manualDismissal && gradeHasEffect)
        hasAcademicEventAfterManualDismissal = true;

      if (grade.status === "غش") {
        cheatCount += 1;
        if (cheatCount === 1) {
          const deducted = Math.max(0, opportunities);
          if (deducted > 0)
            addAutomaticLog(
              exam,
              grade.id,
              "خصم تلقائي",
              deducted,
              `غش أول في امتحان: ${exam.name} - خصم جميع الفرص`,
            );
          opportunities = 0;
          setDismissal(
            "فصل مؤقت",
            `أول حالة غش في امتحان: ${exam.name}`,
            80,
            exam,
            grade.id,
          );
        } else {
          setDismissal(
            "فصل نهائي",
            `غش متكرر في امتحان: ${exam.name}`,
            100,
            exam,
            grade.id,
          );
        }
        continue;
      }

      if (exam.noDiscount) {
        continue;
      }

      if (grade.status === "غائب") {
        if (exam.type === "فاينل") {
          setDismissal(
            "فصل مؤقت",
            `غياب ضمن درجة الفصل في امتحان ${exam.type}: ${exam.name}`,
            75,
            exam,
            grade.id,
          );
        } else {
          const penalty = examPenaltyValue(exam);
          opportunities -= penalty;
          addAutomaticLog(
            exam,
            grade.id,
            "خصم تلقائي",
            penalty,
            `غياب في امتحان ${exam.type}: ${exam.name}`,
          );
          if (hasPriorDismissalEvent) {
            setDismissal(
              "فصل مؤقت",
              `غياب في امتحان ${exam.type} بعد فصل سابق: ${exam.name}`,
              85,
              exam,
              grade.id,
            );
          } else if (opportunities <= 0) {
            setDismissal(
              "فصل مؤقت",
              `انتهاء الفرص بعد غياب في امتحان ${exam.type}: ${exam.name}`,
              60,
              exam,
              grade.id,
            );
          }
        }
        continue;
      }

      if (grade.status === "درجة" && grade.score !== null) {
        const score = Number(grade.score);
        if (exam.type === "فاينل") {
          if (score === 0) {
            setDismissal(
              "فصل مؤقت",
              `درجة صفر في امتحان ${exam.type}: ${exam.name}`,
              76,
              exam,
              grade.id,
            );
          } else if (
            exam.dismissalGrade !== null &&
            score <= exam.dismissalGrade
          ) {
            setDismissal(
              "فصل مؤقت",
              `درجة فصل (${score}): ${exam.name}`,
              75,
              exam,
              grade.id,
            );
          }
          continue;
        }
        if (score <= exam.discountMark) {
          const penalty = examPenaltyValue(exam);
          opportunities -= penalty;
          addAutomaticLog(
            exam,
            grade.id,
            "خصم تلقائي",
            penalty,
            `درجة ${score} ضمن الخصم في امتحان: ${exam.name}`,
          );
          if (hasPriorDismissalEvent) {
            setDismissal(
              "فصل مؤقت",
              `درجة خصم (${score}) بعد فصل سابق في امتحان ${exam.type}: ${exam.name}`,
              85,
              exam,
              grade.id,
            );
          } else if (opportunities <= 0) {
            setDismissal(
              "فصل مؤقت",
              `انتهاء الفرص بعد درجة خصم (${score}) في امتحان: ${exam.name}`,
              60,
              exam,
              grade.id,
            );
          }
        }
      }
    }

    if (manualDismissal && !hasAcademicEventAfterManualDismissal)
      return student;

    const opportunityCap = Number(
      activeChapter?.opportunities ?? student.baseOpportunities ?? 0,
    );
    opportunities = Math.max(0, opportunities);
    if (opportunityCap > 0) {
      opportunities = Math.min(opportunities, opportunityCap);
    }
    if (opportunities === 0 && opportunityCap > 0 && !dismissalType) {
      setDismissal(
        hasFinalChancePledge ? "فصل نهائي" : "فصل مؤقت",
        hasFinalChancePledge
          ? "عدم الالتزام بالتعهد السابق - انتهاء الفرصة الأخيرة"
          : "انتهاء الفرص",
        hasFinalChancePledge ? 90 : 60,
      );
    }

    return {
      ...student,
      opportunities,
      status: (dismissalType ? "مفصول" : "نشط") as AcademicStudent["status"],
      dismissalType,
      dismissalReason,
    };
  });

  const keptAutomaticLogs = previousAutomaticLogs.filter((log) => {
    if (hasScopedRecalculation && !targetStudentIds?.has(log.studentId))
      return true;
    const activeLinks = activeLinkedSourcesByStudent.get(log.studentId) || [];
    return activeLinks.some((link) =>
      automaticLogMatchesAcademicReactivationLink(log, link, state.grades),
    );
  });

  const keptManualLogs = manualLogs.filter((log) => {
    if (hasScopedRecalculation && !targetStudentIds?.has(log.studentId))
      return true;
    const link =
      parseAcademicReactivationLink(log.reason) ||
      resolvedAcademicLinksByOpportunityLogId.get(log.id) ||
      null;
    if (!link) return !isSystemAcademicReactivationLog(log);
    const key = academicReactivationSourceKey(link);
    const activeLinks = activeLinkedSourcesByStudent.get(log.studentId) || [];
    return Boolean(
      key &&
      activeLinks.some(
        (activeLink) => academicReactivationSourceKey(activeLink) === key,
      ),
    );
  });

  return {
    students,
    opportunityLogs: [
      ...automaticLogs,
      ...keptAutomaticLogs,
      ...keptManualLogs,
    ],
  };
}

export function getActiveChapterForStudent(
  student: Pick<AcademicStudent, "courseId">,
  courseChapters: AcademicCourseChapter[],
  chapters: AcademicChapter[],
): AcademicChapter | null {
  const activeLinks = courseChapters.filter(
    (link) => link.courseId === student.courseId && link.active && !link.archived,
  );
  if (activeLinks.length !== 1) return null;
  return (
    chapters.find((chapter) => chapter.id === activeLinks[0].chapterId) || null
  );
}

export type {
  AcademicChapter,
  AcademicCourseChapter,
  AcademicExam,
  AcademicGrade,
  AcademicOpportunityLog,
  AcademicReactivationLink,
  AcademicRecalculationResult,
  AcademicStateInput,
  AcademicStudent,
  AcademicStudentLeave,
  AcademicStudentNote,
};
