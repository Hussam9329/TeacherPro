/**
 * «ملف الطالب»: everything that happened to one student as one story an
 * employee can read top to bottom. Pure: built from the rows the profile API
 * returns. Exam rows merge their result, its effect on the opportunities and
 * the calls made about it into one event; manual actions carry the employee's
 * name when the audit log records it.
 *
 * Voices: the screen speaks simple Iraqi; the two WhatsApp messages (parent
 * summary, student report) speak simple standard Arabic.
 */
import { BONUS_OPPORTUNITY_ACTION } from "@/lib/bonus-opportunity";
import { withoutCancelledManualPairs } from "@/lib/opportunity-log-pairs";
import { classifyGradeAcademicImpact, type GradeClassificationKind } from "@/lib/grade-classification";
import { findExamGracePeriod, type GracePeriodRange } from "@/lib/grace-periods";
import { displayOpportunityReason } from "@/lib/retired-followup-compat";
import { dismissalReasonSentence } from "@/lib/reason-display";
import { baghdadDateKey } from "@/lib/baghdad-time";
import type { StoryAuditFacts } from "@/lib/student-story-audit";
import {
  messageOpportunityCount,
  storyDay,
  storyOpportunityCount,
  storyParts,
  storyPlain,
  storyStamp,
  storyValue,
  storyWhatsApp,
  type StoryPart,
} from "@/lib/student-story-format";

type Rec = Record<string, unknown>;

export type StoryCategory = "grades" | "decisions" | "follow" | "data";
export type StoryTone = "pass" | "fail" | "loss" | "danger" | "good" | "neutral" | "wait" | "admin";

export type StorySub = { id: string; at: string; dayKey: string; time: string; parts: StoryPart[]; by: string };

export type StoryEvent = {
  id: string;
  at: string;
  dayKey: string;
  time: string;
  chapterId: string;
  cats: StoryCategory[];
  tone: StoryTone;
  parts: StoryPart[];
  by: string;
  balance: { after: number; limit: number | null; dismissed: boolean } | null;
  subs: StorySub[];
  /** Summary bookkeeping: a real dismissal, a return, or neither. */
  role?: "dismissal" | "return";
};

export type StoryStripKind = "pass" | "fail" | "loss" | "neutral" | "pending" | "missing";
export type StoryStripItem = { id: string; index: number; name: string; dayKey: string; kind: StoryStripKind; result: string };

export type StudentStory = {
  summary: StoryPart[][];
  /** The pieces of the summary a page lays out on its own: the first line,
   * the lines worth a highlight (dismissals, bonus progress) and the newest
   * event. Same words as the summary. */
  lead: StoryPart[];
  highlights: StoryPart[][];
  latest: StoryEvent | null;
  /** «انخصمت عليه … بهالفصل» on its own, for a page that shows the sum elsewhere. */
  deducted: StoryPart[] | null;
  /** The chapter's exams counted as the summary counts them. */
  counts: { total: number; pass: number; fail: number; loss: number; absent: number; neutral: number; pending: number; missing: number };
  /** The newest follow-up: a call (also one made about an exam), a leave or a grace period. */
  latestFollowUp: { at: string; dayKey: string; time: string; by: string; parts: StoryPart[] } | null;
  openItems: StoryPart[][];
  strip: StoryStripItem[];
  stripChapterName: string;
  groups: Array<{ chapterId: string; title: string; days: Array<{ dayKey: string; title: string; events: StoryEvent[] }> }>;
  parentMessage: string;
  studentMessage: string;
};

export type StudentStoryInput = {
  student: Rec & { id: string; name?: unknown; code?: unknown; status?: unknown };
  courseName: string;
  activeChapter: { id: string; name: string; opportunities?: number | null } | null;
  opportunityLimit: number | null;
  exams: Rec[];
  courseExams: Rec[];
  grades: Rec[];
  opportunityLogs: Rec[];
  leaves: Rec[];
  calls: Rec[];
  notes: Rec[];
  gracePeriods: Rec[];
  pendingGrades: Rec[];
  audit: StoryAuditFacts | null;
  todayKey: string;
};

const s = (value: unknown) => String(value ?? "").trim();
const n = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const bold = (value: unknown) => `**${storyValue(value)}**`;
/** «ب» before a name: «بالفصل الأول», «بـفصل 2». */
const bi = (value: unknown) => (/^[\u0600-\u06FF]/u.test(storyValue(value)) ? `ب${bold(value)}` : `بـ${bold(value)}`);

const DISMISSAL_NOTE = /^(?:تم )?فصل الطالب/u;
const AUTOMATIC_ACTIONS = new Set(["خصم تلقائي", "فصل تلقائي", BONUS_OPPORTUNITY_ACTION]);
function isAutomatic(log: Rec): boolean {
  return AUTOMATIC_ACTIONS.has(s(log.action)) || s(log.reason).startsWith("تلقائي:");
}
function reasonOf(log: Rec): string {
  return storyValue(displayOpportunityReason(log.reason));
}
function examChapterId(exam: Rec | undefined, courseId: string): string {
  const links = Array.isArray(exam?.examCourses) ? exam!.examCourses as Rec[] : [];
  return s(links.find((link) => s(link.courseId) === courseId)?.chapterId);
}
function examTypeName(exam: Rec | undefined): string {
  return storyValue(exam?.name) || "امتحان محذوف";
}

/** The structured facts of one exam for this student; rendered per voice. */
type ExamFacts = {
  examId: string;
  exam: Rec | undefined;
  name: string;
  examDayKey: string;
  status: string;
  score: number | null;
  kind: GradeClassificationKind | "pending";
  deducted: number;
  dismissed: boolean;
  cheating: boolean;
  bonus: boolean;
  bonusPair: string;
  balanceAfter: number | null;
  leaveReason: string;
  grace: GracePeriodRange | null;
  pendingCategory: string;
  pendingScore: number | null;
  chapterId: string;
};

function staffExamSentence(f: ExamFacts, bonusProgressHere: boolean): string {
  const name = bold(f.name);
  const score = f.score === null ? "" : `${bold(f.score)}${n(f.exam?.fullMark) ? ` من ${n(f.exam?.fullMark)}` : ""}`;
  const discountMark = n(f.exam?.discountMark);
  if (f.kind === "pending") {
    const why = f.pendingCategory === "LEAVE_PENDING" ? "وهو مجاز" : f.pendingCategory === "BEFORE_REGISTRATION_PENDING" ? "قبل ما ينسجل" : "وهو مفصول";
    return `${name}: انكتبتله ${f.pendingScore === null ? "درجة" : bold(f.pendingScore)} ${why}، فانحفظت معلّقة وما انحسبت عليه.`;
  }
  const result = f.status === "غائب" ? "غاب" : f.status === "غش" ? "غش" : f.status === "مجاز" ? "عنده إجازة" : score ? `جاب ${score}` : "انكتبتله نتيجة";
  if (f.dismissed) {
    if (f.cheating) return `${name}: غش، فانخصمت كل فرصه وانفصل تلقائياً.`;
    if (s(f.exam?.type) === "فاينل") return `${name} (فاينل): ${result}، فانفصل تلقائياً.`;
    return `${name}: ${result} وهو على صفر، فانفصل تلقائياً.`;
  }
  if (f.bonus) {
    return `${name}: نجح بـ${score || "درجة نجاح"}. نجح مرتين ورا بعض${f.bonusPair ? ` (${f.bonusPair})` : ""}، فرجعتله «${BONUS_OPPORTUNITY_ACTION}».`;
  }
  if (f.deducted > 0) {
    const lost = f.deducted === 1 ? "فرصة" : `${bold(f.deducted)} فرص`;
    const zero = f.balanceAfter === 0 ? " وصار على صفر. ما انفصل، بس أي خصم بعد يفصله." : ".";
    if (f.status === "غائب") return `${name}: غاب، فانخصمت ${lost}${zero}`;
    if (f.status === "غش") return `${name}: غش، فانخصمت ${lost}${zero}`;
    const range = discountMark !== null ? ` (0 إلى ${discountMark})` : "";
    return `${name}: جاب ${score}، وهاي ضمن درجات الخصم${range}، فانخصمت ${lost}${zero}`;
  }
  const progress = bonusProgressHere ? ` نجاح 1 من 2 نحو «${BONUS_OPPORTUNITY_ACTION}».` : "";
  switch (f.kind) {
    case "passed":
    case "full-mark":
      return `${name}: نجح بـ${score}.${progress}`;
    case "failed":
    case "academic-accounting":
      return `${name}: راسب بـ${score}، بس ما ينخصم عليها لأنها فوق درجة الخصم${discountMark !== null ? ` (${discountMark})` : ""}.`;
    case "grace-period":
      return `${name}: ${result}، بس ما انحسب عليه لأن عنده فترة سماح${f.grace ? ` (من ${bold(storyDay(f.grace.startDate))} لغاية ${bold(storyDay(f.grace.endDate))})` : ""}.`;
    case "excused":
      return `${name}: عنده إجازة${f.leaveReason ? ` (${f.leaveReason})` : ""}، فما انحسب عليه.`;
    case "before-registration":
      return f.status === "قبل تسجيل الطالب"
        ? `${name}: الامتحان قبل ما ينسجل، فما ينحسب عليه.`
        : `${name}: ${result}، بس الامتحان قبل ما ينسجل، فما ينحسب عليه.`;
    case "unavailable-exam":
      return `${name}: ${result}، بس الامتحان مو مفعّل، فما انحسب.`;
    case "no-discount-protected":
      return `${name}: ${result}، بس الامتحان «بدون خصم»، فما ينخصم.`;
    case "academic-effect-excluded":
      return `${name}: ${result}، وهاي الدرجة خارج حساب الفرص.`;
    case "missing":
      return `${name}: ما انكتبتله نتيجة.`;
    default:
      return `${name}: ${result}.`;
  }
}

/** The same exam for a message: «parent» speaks about the student, «student» to them. */
function messageExamSentence(f: ExamFacts, voice: "parent" | "student"): string {
  const you = voice === "student";
  const score = f.score === null ? "" : `${bold(f.score)}${n(f.exam?.fullMark) ? ` من ${n(f.exam?.fullMark)}` : ""}`;
  const absent = you ? "غبت" : "غاب";
  const got = you ? "حصلت على" : "حصل على";
  if (f.kind === "pending") {
    return `سُجّلت ${you ? "لك" : "له"} ${f.pendingScore === null ? "درجة" : bold(f.pendingScore)} ${f.pendingCategory === "LEAVE_PENDING" ? "أثناء الإجازة" : f.pendingCategory === "BEFORE_REGISTRATION_PENDING" ? "قبل التسجيل" : "أثناء الفصل"}، ولم تُحتسب`;
  }
  if (f.dismissed) {
    if (f.cheating) return `${you ? "ثبت عليك" : "ثبت عليه"} الغش، ف${you ? "فُصلت" : "فُصل"}`;
    return `${f.status === "غائب" ? absent : `${got} ${score}`} ${you ? "ولم تبقَ لديك فرص" : "ولم تبقَ لديه فرص"}، ف${you ? "فُصلت" : "فُصل"}`;
  }
  if (f.bonus) return `${you ? "نجحت" : "نجح"} بدرجة ${score}، وبعد نجاحين متتاليين ${you ? "استعدت" : "استعاد"} «${BONUS_OPPORTUNITY_ACTION}»`;
  if (f.deducted > 0) {
    const lost = f.deducted === 1 ? "فرصة" : `${bold(f.deducted)} فرص`;
    if (f.status === "غائب") return `${absent}، فخُصمت ${lost}`;
    if (f.status === "غش") return `${you ? "ثبت عليك" : "ثبت عليه"} الغش، فخُصمت ${lost}`;
    return `${got} ${score} وهي ضمن درجات الخصم، فخُصمت ${lost}`;
  }
  switch (f.kind) {
    case "passed":
    case "full-mark":
      return `${you ? "نجحت" : "نجح"} بدرجة ${score}`;
    case "failed":
    case "academic-accounting":
      return `${got} ${score}، دون خصم`;
    case "grace-period":
      return `${f.status === "غائب" ? absent : `${got} ${score || "نتيجة"}`}، دون خصم لأنها ضمن فترة السماح`;
    case "excused":
      return `${you ? "كنت مُجازاً" : "كان مُجازاً"}، فلم يُحتسب`;
    case "before-registration":
      return "قبل التسجيل، فلم يُحتسب";
    case "no-discount-protected":
      return `${f.status === "غائب" ? absent : `${got} ${score}`}، والامتحان بلا خصم`;
    case "academic-effect-excluded":
      return `${f.status === "غائب" ? absent : `${got} ${score}`}، دون أثر على الفرص`;
    case "unavailable-exam":
      return "لم يُحتسب لأن الامتحان غير مفعّل";
    default:
      return f.status === "غائب" ? absent : `${got} ${score}`;
  }
}

/** Who made a call: the account saved with its last contact action, or
 * the one the logs name for a note. */
function callActor(call: Rec, audit: { callNoteActors: Record<string, string> } | null | undefined): string {
  return s(call.actedByName) || audit?.callNoteActors[s(call.id)] || "";
}

function callSentence(call: Rec): string {
  const target = s(call.target);
  const who = target === "student" || target === "الطالب" ? "بالطالب" : target === "parent" || target === "ولي الأمر" ? "بولي الأمر" : "";
  const status = s(call.status);
  const outcome = status === "تم الاتصال" ? "ورد" : status === "لم يرد" ? "وما رد" : status === "الرقم خاطئ" ? "والرقم طلع غلط" : "";
  const note = storyValue(call.notes);
  if (s(call.category) === "call-student-note") {
    return `ملاحظة مكالمة: ${note}${call.noteResolved ? " (انتهت)" : ""}`;
  }
  const base = `اتصلنا${who ? ` ${who}` : ""}${outcome ? ` ${outcome}` : ""}.`;
  return note ? `${base} ملاحظة: ${note}` : base;
}

function balanceOf(logs: Rec[]): number | null {
  const withBalance = [...logs].filter((log) => n(log.balanceAfter) !== null)
    .sort((a, b) => s(a.date).localeCompare(s(b.date)) || s(a.id).localeCompare(s(b.id)));
  return withBalance.length ? n(withBalance[withBalance.length - 1].balanceAfter) : null;
}

export function buildStudentStory(rawInput: StudentStoryInput): StudentStory {
  // A mistaken command and its documented undo are not part of the story.
  const input = { ...rawInput, opportunityLogs: withoutCancelledManualPairs(rawInput.opportunityLogs) };
  const student = input.student;
  const courseId = s(student.courseId);
  const audit = input.audit;
  const examById = new Map<string, Rec>();
  for (const exam of [...input.courseExams, ...input.exams]) examById.set(s(exam.id), exam);
  const chapterNames = new Map<string, string>();
  if (input.activeChapter) chapterNames.set(input.activeChapter.id, input.activeChapter.name);
  for (const log of input.opportunityLogs) {
    const id = s(log.chapterId);
    if (id && !chapterNames.has(id) && s(log.chapterNameSnapshot)) chapterNames.set(id, s(log.chapterNameSnapshot));
  }
  const currentChapterId = input.activeChapter?.id || "";
  const limitFor = (chapterId: string) => (chapterId && chapterId === currentChapterId ? input.opportunityLimit : null);
  const studentForClassify: Rec = {
    ...student,
    gracePeriods: Array.isArray(student.gracePeriods) ? student.gracePeriods : [],
  };

  const events: StoryEvent[] = [];
  const usedLogIds = new Set<string>();
  const usedLeaveIds = new Set<string>();
  const usedCallIds = new Set<string>();
  const usedNoteIds = new Set<string>();
  const usedAuditIds = new Set<string>();
  const examFacts: ExamFacts[] = [];

  // ── Exams: result + effect + leave + pending + calls about it ──
  const examIds = new Set<string>();
  for (const grade of input.grades) examIds.add(s(grade.examId));
  for (const log of input.opportunityLogs) if (log.examId && isAutomatic(log)) examIds.add(s(log.examId));
  for (const leave of input.leaves) if (leave.examId) examIds.add(s(leave.examId));
  for (const pending of input.pendingGrades) examIds.add(s(pending.examId));
  examIds.delete("");

  const gradeByExam = new Map(input.grades.map((grade) => [s(grade.examId), grade]));
  const pendingByExam = new Map(input.pendingGrades.map((pending) => [s(pending.examId), pending]));
  const latestPassExamId = (() => {
    if (n(student.bonusProgress) !== 1) return "";
    const passes = input.grades
      .map((grade) => ({ grade, exam: examById.get(s(grade.examId)) }))
      .filter(({ grade, exam }) => exam && s(grade.status) === "درجة" && n(grade.score) !== null && n(exam.passMark) !== null && Number(grade.score) >= Number(exam.passMark))
      .sort((a, b) => s(b.exam?.date).localeCompare(s(a.exam?.date)));
    return passes.length ? s(passes[0].grade.examId) : "";
  })();

  for (const examId of examIds) {
    const exam = examById.get(examId);
    const grade = gradeByExam.get(examId);
    const pending = pendingByExam.get(examId);
    const leave = input.leaves.find((row) => s(row.examId) === examId);
    const logs = input.opportunityLogs.filter((log) => s(log.examId) === examId && isAutomatic(log));
    logs.forEach((log) => usedLogIds.add(s(log.id)));
    if (leave) usedLeaveIds.add(s(leave.id));
    const deducted = logs.filter((log) => s(log.action) === "خصم تلقائي").reduce((sum, log) => sum + Math.abs(Number(log.amount) || 0), 0);
    const dismissalLog = logs.find((log) => s(log.action) === "فصل تلقائي");
    const bonusLog = logs.find((log) => s(log.action) === BONUS_OPPORTUNITY_ACTION);
    const pairMatch = bonusLog ? /«([^»]+)»\s*\((\d+)\)\s*و«([^»]+)»\s*\((\d+)\)/u.exec(s(bonusLog.reason)) : null;
    const kind: ExamFacts["kind"] = grade && exam
      ? classifyGradeAcademicImpact(grade as never, exam as never, {
          student: studentForClassify as never,
          leaves: input.leaves as never,
          opportunityLogs: input.opportunityLogs as never,
          chapterId: currentChapterId || null,
        })
      : pending ? "pending" : leave ? "excused" : "missing";
    const chapterId = examChapterId(exam, courseId) || s(logs[0]?.chapterId);
    const facts: ExamFacts = {
      examId,
      exam,
      name: examTypeName(exam),
      examDayKey: baghdadDateKey(exam?.date as string) || "",
      status: s(grade?.status) || (leave ? "مجاز" : ""),
      score: n(grade?.score),
      kind: !grade && pending ? "pending" : kind,
      deducted,
      dismissed: Boolean(dismissalLog),
      cheating: s(grade?.status) === "غش",
      bonus: Boolean(bonusLog),
      bonusPair: pairMatch ? `${bold(pairMatch[1])} بـ${bold(pairMatch[2])} و${bold(pairMatch[3])} بـ${bold(pairMatch[4])}` : "",
      balanceAfter: balanceOf(logs),
      leaveReason: storyValue(leave?.reason),
      grace: exam ? findExamGracePeriod(studentForClassify as never, exam as never) : null,
      pendingCategory: s(pending?.category),
      pendingScore: n(pending?.score),
      chapterId,
    };
    if (!grade && !pending && !leave && logs.length === 0) continue;
    examFacts.push(facts);
    const stamp = storyStamp(grade?.createdAt || leave?.createdAt || pending?.attemptedAt || logs[0]?.date || exam?.date);
    const tone: StoryTone = facts.dismissed ? "danger" : facts.bonus ? "good" : facts.deducted > 0 ? "loss"
      : facts.kind === "pending" ? "wait"
        : facts.kind === "passed" || facts.kind === "full-mark" ? "pass"
          : facts.kind === "failed" || facts.kind === "academic-accounting" ? "fail" : "neutral";
    const subs: StorySub[] = input.calls
      .filter((call) => s(call.examId) === examId && (s(call.status) || s(call.notes)))
      .map((call) => {
        usedCallIds.add(s(call.id));
        const callStamp = storyStamp(call.completedAt || call.createdAt);
        return { id: `call-${s(call.id)}`, ...callStamp, parts: storyParts(callSentence(call)), by: callActor(call, audit) };
      })
      .sort((a, b) => a.at.localeCompare(b.at));
    const balanceAfter = facts.balanceAfter;
    events.push({
      id: `exam-${examId}`,
      ...stamp,
      chapterId,
      cats: [
        "grades",
        ...(logs.length ? ["decisions" as const] : []),
        ...(subs.length || leave ? ["follow" as const] : []),
      ],
      tone,
      parts: storyParts(staffExamSentence(facts, examId === latestPassExamId)),
      by: leave && facts.kind === "excused" ? audit?.leaveActors[s(leave.id)] || "" : "",
      balance: facts.dismissed
        ? { after: 0, limit: limitFor(chapterId), dismissed: true }
        : balanceAfter !== null ? { after: balanceAfter, limit: limitFor(chapterId), dismissed: false } : null,
      subs,
      role: facts.dismissed ? "dismissal" : undefined,
    });
  }

  // ── Manual opportunity actions, returns and manual dismissals ──
  const manualLogs = input.opportunityLogs
    .filter((log) => !usedLogIds.has(s(log.id)))
    .sort((a, b) => s(a.date).localeCompare(s(b.date)) || s(a.id).localeCompare(s(b.id)));
  const auditEvents = audit?.events || [];
  const nearestAudit = (kinds: string[], at: string, windowMs = 120_000) => {
    const time = Date.parse(at);
    let best: (typeof auditEvents)[number] | null = null;
    for (const event of auditEvents) {
      if (!kinds.includes(event.kind) || usedAuditIds.has(event.id)) continue;
      const distance = Math.abs(Date.parse(event.at) - time);
      if (distance <= windowMs && (!best || distance < Math.abs(Date.parse(best.at) - time))) best = event;
    }
    if (best) usedAuditIds.add(best.id);
    return best;
  };
  const noteNear = (matches: (note: Rec) => boolean, at: string, windowMs = 120_000) => {
    const time = Date.parse(at);
    const note = input.notes.find((row) => !usedNoteIds.has(s(row.id)) && s(row.kind) === "إجراء" && matches(row) &&
      Math.abs(Date.parse(s(row.date)) - time) <= windowMs);
    if (note) usedNoteIds.add(s(note.id));
    return note;
  };
  for (let index = 0; index < manualLogs.length; index++) {
    const log = manualLogs[index];
    if (usedLogIds.has(s(log.id))) continue;
    usedLogIds.add(s(log.id));
    const action = s(log.action);
    const amount = Math.abs(Number(log.amount) || 0);
    const reason = reasonOf(log);
    const stamp = storyStamp(log.date);
    const chapterId = s(log.chapterId);
    const after = n(log.balanceAfter);
    const balance = after !== null ? { after, limit: limitFor(chapterId), dismissed: false } : null;
    const base = { ...stamp, chapterId, subs: [] as StorySub[] };
    const iso = log.date ? new Date(s(log.date)).toISOString() : "";

    if (action === "خصم" && /^فصل الطالب/u.test(s(log.reason))) {
      noteNear((note) => DISMISSAL_NOTE.test(s(note.text)), iso);
      const actor = nearestAudit(["manual-dismissal"], iso);
      events.push({ ...base, id: `log-${s(log.id)}`, cats: ["decisions"], tone: "danger", role: "dismissal", balance: { after: 0, limit: limitFor(chapterId), dismissed: true },
        parts: storyParts(`انفصل بقرار${reason.replace(/^فصل الطالب:?\s*/u, "") ? `: ${reason.replace(/^فصل الطالب:?\s*/u, "")}` : ""}.`), by: actor?.by || "" });
      continue;
    }
    if (action === "إعادة تفعيل" || action === "رصيد بعد تعهد" || action === "رصيد إعادة التفعيل") {
      // One return: the marker row and its balance row are written together.
      const partner = manualLogs.slice(index + 1).find((other) => !usedLogIds.has(s(other.id)) &&
        ["إعادة تفعيل", "رصيد بعد تعهد", "رصيد إعادة التفعيل"].includes(s(other.action)) &&
        Math.abs(Date.parse(s(other.date)) - Date.parse(s(log.date))) <= 120_000);
      if (partner) usedLogIds.add(s(partner.id));
      const rows = [log, partner].filter(Boolean) as Rec[];
      const pledge = rows.some((row) => s(row.action) === "رصيد بعد تعهد" || /تعهد/u.test(s(row.reason)));
      const granted = rows.map((row) => n(row.balanceAfter) ?? (s(row.action) !== "إعادة تفعيل" ? Math.abs(Number(row.amount) || 0) : null)).filter((value) => value !== null).pop() ?? null;
      noteNear((note) => !DISMISSAL_NOTE.test(s(note.text)) &&
        (s(note.sourceType) === "student-status-action" || /تعهد|استعادة|إعادة تفعيل/u.test(s(note.text))), iso);
      const actor = nearestAudit(pledge ? ["pledge-return", "manual-return"] : ["manual-return", "pledge-return"], iso);
      const why = !pledge ? storyValue(actor?.text) || reason.replace(/^.*?:\s*/u, "") : "";
      events.push({ ...base, id: `log-${s(log.id)}`, cats: ["decisions"], tone: "good", role: "return",
        balance: granted !== null ? { after: granted, limit: limitFor(chapterId), dismissed: false } : null,
        parts: storyParts(`${pledge ? "رجع بتعهّد" : "رجع بقرار الإدارة"}${granted !== null ? ` وانعطى ${bold(storyOpportunityCount(granted))}` : ""}${why && !pledge ? `: ${why}` : ""}.`),
        by: actor?.by || "" });
      continue;
    }
    if (action === "إعادة تعيين" && /^تسوية/u.test(s(log.reason))) {
      const chapterName = chapterNames.get(chapterId) || "فصل جديد";
      events.push({ ...base, id: `log-${s(log.id)}`, cats: ["decisions"], tone: "neutral", balance,
        parts: storyParts(`بدا ${bold(chapterName)}${after !== null ? ` بـ${bold(storyOpportunityCount(after))}` : ""}.`), by: "" });
      continue;
    }
    const actor = audit?.opportunityLogActors[s(log.id)] || "";
    if (action === "خصم") {
      events.push({ ...base, id: `log-${s(log.id)}`, cats: ["decisions"], tone: "loss", balance,
        parts: storyParts(`انخصمت ${amount === 1 ? "فرصة" : bold(storyOpportunityCount(amount))} يدوياً${reason ? `: ${reason}` : ""}.`), by: actor });
      continue;
    }
    if (action === "إضافة") {
      events.push({ ...base, id: `log-${s(log.id)}`, cats: ["decisions"], tone: "good", balance,
        parts: storyParts(`انضافتله ${amount === 1 ? "فرصة" : bold(storyOpportunityCount(amount))} يدوياً${reason ? `: ${reason}` : ""}.`), by: actor });
      continue;
    }
    if (action === "إعادة تعيين") {
      events.push({ ...base, id: `log-${s(log.id)}`, cats: ["decisions"], tone: "neutral", balance,
        parts: storyParts(`تعدّلت فرصه${after !== null ? ` لـ${bold(after)}` : ""}${reason ? `: ${reason}` : ""}.`), by: actor });
      continue;
    }
    if (action === BONUS_OPPORTUNITY_ACTION) {
      events.push({ ...base, id: `log-${s(log.id)}`, cats: ["decisions"], tone: "good", balance,
        parts: storyParts(`رجعتله «${BONUS_OPPORTUNITY_ACTION}».`), by: "" });
      continue;
    }
    if (action === "فصل تلقائي") {
      events.push({ ...base, id: `log-${s(log.id)}`, cats: ["decisions"], tone: "danger", role: "dismissal", balance: { after: 0, limit: limitFor(chapterId), dismissed: true },
        parts: storyParts(`انفصل تلقائياً${reason ? `: ${storyDismissalReason(log.reason)}` : ""}.`), by: "" });
      continue;
    }
    events.push({ ...base, id: `log-${s(log.id)}`, cats: ["decisions"], tone: "neutral", balance,
      parts: storyParts(`${storyValue(action)}${amount ? ` ${bold(amount)}` : ""}${reason ? `: ${reason}` : ""}.`), by: actor });
  }

  // ── Notes: decisions with no ledger row, automatic returns, archive ──
  for (const note of input.notes) {
    if (usedNoteIds.has(s(note.id))) continue;
    const text = storyValue(note.text);
    if (!text) continue;
    const stamp = storyStamp(note.date);
    const iso = note.date ? new Date(s(note.date)).toISOString() : "";
    if (DISMISSAL_NOTE.test(text)) {
      const actor = nearestAudit(["manual-dismissal"], iso);
      events.push({ id: `note-${s(note.id)}`, ...stamp, chapterId: "", cats: ["decisions"], tone: "danger", role: "dismissal", balance: null,
        parts: storyParts(`انفصل بقرار: ${text.replace(/^(?:تم )?فصل الطالب:?\s*/u, "")}`), by: actor?.by || "", subs: [] });
      continue;
    }
    if (/^رجع الطالب تلقائياً|^استعادة الطالب بعد تعديل الامتحان/u.test(text)) {
      const cancelledDay = baghdadDateKey(note.dismissalDate as string);
      const cancelledReason = storyValue(note.dismissalReason);
      const struck = cancelledDay || cancelledReason
        ? `~~انفصل${cancelledDay ? ` يوم ${storyDay(cancelledDay)}` : ""}${cancelledReason ? `: ${storyPlain(storyParts(storyDismissalReason(cancelledReason)))}` : ""}~~ `
        : "";
      const why = text.replace(/^رجع الطالب تلقائياً:\s*/u, "").replace(/الرصيد (?:الحالي|المحسوب):\s*\d+\.?/u, "").trim();
      events.push({ id: `note-${s(note.id)}`, ...stamp, chapterId: "", cats: ["decisions"], tone: "good", role: "return", balance: null,
        parts: storyParts(`${struck}انلغى الفصل ورجع تلقائياً: ${why}`), by: "", subs: [] });
      continue;
    }
    events.push({ id: `note-${s(note.id)}`, ...stamp, chapterId: "", cats: s(note.kind) === "إجراء" ? ["decisions"] : ["data"], tone: "admin", balance: null,
      parts: storyParts(text), by: "", subs: [] });
  }

  // ── Leaves not tied to an exam event, grace periods, calls ──
  for (const leave of input.leaves) {
    if (usedLeaveIds.has(s(leave.id))) continue;
    const period = s(leave.leaveType) === "period";
    const from = baghdadDateKey((leave.dateFrom || leave.date) as string);
    const to = baghdadDateKey((leave.dateTo || leave.dateFrom || leave.date) as string);
    const reason = storyValue(leave.reason);
    events.push({ id: `leave-${s(leave.id)}`, ...storyStamp(leave.createdAt || leave.date), chapterId: "", cats: ["follow"], tone: "neutral", balance: null,
      parts: storyParts(period
        ? `انعطت إجازة من ${bold(storyDay(from))} لغاية ${bold(storyDay(to))}${reason ? `: ${reason}` : ""}.`
        : `انعطت إجازة${reason ? `: ${reason}` : ""}.`),
      by: audit?.leaveActors[s(leave.id)] || "", subs: [] });
  }
  for (const period of input.gracePeriods) {
    const start = s(period.startDate).slice(0, 10);
    const end = s(period.endDate).slice(0, 10);
    const note = storyValue(period.note);
    events.push({ id: `grace-${s(period.id)}`, ...storyStamp(period.createdAt), chapterId: "", cats: ["follow"], tone: "neutral", balance: null,
      parts: storyParts(`انعطت فترة سماح من ${bold(storyDay(start))} لغاية ${bold(storyDay(end))}${note ? `: ${note}` : ""}. بهالأيام ما ينحسب عليه شي.`),
      by: storyValue(period.createdByName), subs: [] });
    if (period.cancelledAt) {
      const why = storyValue(period.cancelReason);
      events.push({ id: `grace-cancel-${s(period.id)}`, ...storyStamp(period.cancelledAt), chapterId: "", cats: ["follow"], tone: "neutral", balance: null,
        parts: storyParts(`انلغت فترة السماح (${bold(storyDay(start))} – ${bold(storyDay(end))})${why ? `: ${why}` : ""}.`),
        by: storyValue(period.cancelledByName), subs: [] });
    } else if (end && end < input.todayKey) {
      events.push({ id: `grace-end-${s(period.id)}`, at: `${end}T23:59`, dayKey: end, time: "", chapterId: "", cats: ["follow"], tone: "neutral", balance: null,
        parts: storyParts("خلصت فترة السماح."), by: "", subs: [] });
    }
  }
  for (const call of input.calls) {
    if (usedCallIds.has(s(call.id)) || !(s(call.status) || s(call.notes))) continue;
    const exam = examById.get(s(call.examId));
    events.push({ id: `call-${s(call.id)}`, ...storyStamp(call.completedAt || call.createdAt), chapterId: "", cats: ["follow"], tone: "neutral", balance: null,
      parts: storyParts(`${exam ? `${bold(examTypeName(exam))}: ` : ""}${callSentence(call)}`),
      by: callActor(call, audit), subs: [] });
  }

  // ── Audit-only events ──
  let registrationShown = false;
  for (const event of auditEvents) {
    if (usedAuditIds.has(event.id)) continue;
    const stamp = storyStamp(event.at);
    const push = (text: string, cats: StoryCategory[], tone: StoryTone = "admin", role?: StoryEvent["role"]) =>
      events.push({ id: `audit-${event.id}`, ...stamp, chapterId: "", cats, tone, balance: null, parts: storyParts(text), by: event.by, subs: [], role });
    switch (event.kind) {
      case "registered":
        registrationShown = true;
        push(`انسجل بدورة ${bold(input.courseName || storyValue(event.text))} بكود ${bold(student.code)}.`, ["data"], "neutral");
        break;
      case "transferred":
        registrationShown = true;
        push(`انتقل لدورة ${bold(input.courseName)} وبدا ملف جديد.`, ["data"], "neutral");
        break;
      case "restarted":
        registrationShown = true;
        push("بدا ملف جديد بنفس الدورة.", ["data"], "neutral");
        break;
      case "edited":
        push(event.changes?.length ? `تعدّلت بياناته: ${event.changes.map((change) => storyValue(change)).join("، ")}.` : "تعدّلت بياناته.", ["data"]);
        break;
      case "code-closed": push("انقفل كوده.", ["decisions"]); break;
      case "code-reopened": push("انلغى قفل كوده.", ["decisions"]); break;
      case "telegram-notice": push("انبعث تبليغ الفصل بالتيليجرام.", ["decisions"]); break;
      case "dismissal-notes": push(event.text ? `تعدّلت ملاحظة الفصل: ${storyValue(event.text)}` : "انمسحت ملاحظة الفصل.", ["decisions"]); break;
      case "manual-dismissal": push(`انفصل بقرار${event.text ? `: ${storyValue(event.text)}` : ""}.`, ["decisions"], "danger", "dismissal"); break;
      case "pledge-return": push("رجع بتعهّد.", ["decisions"], "good", "return"); break;
      case "manual-return": push(`رجع بقرار الإدارة${event.text ? `: ${storyValue(event.text)}` : ""}.`, ["decisions"], "good", "return"); break;
      case "archived": push("انأرشف.", ["data"]); break;
      case "restored-archive": push("رجع من الأرشيف.", ["data"]); break;
    }
  }
  if (!registrationShown && student.createdAt) {
    events.push({ id: "registered", ...storyStamp(student.createdAt), chapterId: "", cats: ["data"], tone: "neutral", balance: null,
      parts: storyParts(`انسجل بدورة ${bold(input.courseName)} بكود ${bold(student.code)}.`), by: "", subs: [] });
  }

  // ── Chapters: rows that do not name one take the chapter around them ──
  events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  let running = "";
  for (const event of events) {
    if (event.chapterId) running = event.chapterId;
    else event.chapterId = running;
  }
  const firstChapter = events.find((event) => event.chapterId)?.chapterId || currentChapterId;
  for (const event of events) if (!event.chapterId) event.chapterId = firstChapter;

  // ── Groups: newest first, by chapter, then by day ──
  const newestFirst = [...events].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const groups: StudentStory["groups"] = [];
  for (const event of newestFirst) {
    let group = groups.find((item) => item.chapterId === event.chapterId);
    if (!group) {
      group = { chapterId: event.chapterId, title: chapterNames.get(event.chapterId) || (event.chapterId ? "فصل سابق" : "بدون فصل"), days: [] };
      groups.push(group);
    }
    let day = group.days.find((item) => item.dayKey === event.dayKey);
    if (!day) {
      day = { dayKey: event.dayKey, title: storyDay(event.dayKey) || "بدون تاريخ", events: [] };
      group.days.push(day);
    }
    day.events.push(event);
  }

  // ── Strip: every exam of the current chapter, by exam date ──
  const stripExams = input.courseExams
    .filter((exam) => currentChapterId && examChapterId(exam, courseId) === currentChapterId)
    .filter((exam) => !student.createdAt || (baghdadDateKey(exam.date as string) || "") >= (baghdadDateKey(student.createdAt as string) || ""))
    .sort((a, b) => s(a.date).localeCompare(s(b.date)) || s(a.id).localeCompare(s(b.id)));
  const factsByExam = new Map(examFacts.map((facts) => [facts.examId, facts]));
  const strip: StoryStripItem[] = stripExams.map((exam, index) => {
    const facts = factsByExam.get(s(exam.id));
    const kind: StoryStripKind = !facts ? "missing"
      : facts.kind === "pending" ? "pending"
        : facts.dismissed || facts.deducted > 0 ? "loss"
          : facts.kind === "passed" || facts.kind === "full-mark" ? "pass"
            : facts.kind === "failed" || facts.kind === "academic-accounting" ? "fail" : "neutral";
    const result = !facts ? "ما انكتبت" : facts.kind === "pending" ? `${facts.pendingScore ?? ""} معلّقة`
      : facts.status === "غائب" ? "غائب" : facts.status === "مجاز" ? "مجاز" : facts.status === "غش" ? "غش"
        : facts.score !== null ? String(facts.score) : facts.status || "—";
    return { id: s(exam.id), index: index + 1, name: examTypeName(exam), dayKey: baghdadDateKey(exam.date as string) || "", kind, result };
  });

  // ── Summary ──
  const status = s(student.status);
  const opportunities = Math.max(0, Number(student.opportunities) || 0);
  const limit = input.opportunityLimit;
  const name = storyValue(student.name);
  const chapterEvents = events.filter((event) => event.chapterId === currentChapterId);
  const dismissalEvents = chapterEvents.filter((event) => event.role === "dismissal");
  const lastDismissal = dismissalEvents[dismissalEvents.length - 1];
  const returnEvents = chapterEvents.filter((event) => event.role === "return");
  const lastReturn = returnEvents[returnEvents.length - 1];
  const summary: StoryPart[][] = [];
  const highlights: StoryPart[][] = [];
  if (status === "مفصول") {
    const why = storyDismissalReason(student.dismissalReason);
    summary.push(storyParts(`${bold(name)} مفصول${lastDismissal ? ` من ${bold(storyDay(lastDismissal.dayKey))}` : ""}${why ? `: ${why}` : ""}.`));
  } else if (status === "مؤرشف") {
    summary.push(storyParts(`${bold(name)} مؤرشف.`));
  } else if (!input.activeChapter) {
    summary.push(storyParts(`${bold(name)} ${status || "نشط"}، بس ما اكو فصل فعّال هسه.`));
  } else {
    summary.push(storyParts(opportunities > 0
      ? `${bold(name)} هسه ${status || "نشط"} ${bi(input.activeChapter.name)}، وعنده ${bold(storyOpportunityCount(opportunities))}${limit !== null ? ` من ${bold(limit)}` : ""}.`
      : `${bold(name)} هسه ${status || "نشط"} ${bi(input.activeChapter.name)}، وما باقي عنده فرص (${bold(0)}${limit !== null ? ` من ${bold(limit)}` : ""}). أي خصم ثاني يفصله.`));
  }
  if (lastDismissal && status !== "مفصول") {
    const dismissalCount = dismissalEvents.length;
    summary.push(storyParts(`انفصل ${dismissalCount === 1 ? "مرة وحدة" : `${bold(dismissalCount)} مرات`} بهالفصل، آخرها يوم ${bold(storyDay(lastDismissal.dayKey))}${lastReturn && lastReturn.at > lastDismissal.at ? `، ورجع يوم ${bold(storyDay(lastReturn.dayKey))}` : ""}.`));
    highlights.push(summary[summary.length - 1]);
  }
  const chapterDeducted = input.opportunityLogs
    .filter((log) => s(log.chapterId) === currentChapterId && (s(log.action) === "خصم تلقائي" || (s(log.action) === "خصم" && !/^فصل الطالب/u.test(s(log.reason)))))
    .reduce((sum, log) => sum + Math.abs(Number(log.amount) || 0), 0);
  const chapterBonuses = input.opportunityLogs.filter((log) => s(log.chapterId) === currentChapterId && s(log.action) === BONUS_OPPORTUNITY_ACTION).length;
  let deducted: StoryPart[] | null = null;
  if (chapterDeducted > 0) {
    summary.push(storyParts(`انخصمت عليه ${bold(storyOpportunityCount(chapterDeducted))} بهالفصل${chapterBonuses ? `، ورجعتله ${chapterBonuses === 1 ? "«فرصة مكافأة»" : `${bold(chapterBonuses)} «فرص مكافأة»`}` : ""}.`));
    deducted = summary[summary.length - 1];
  }
  const counted = { pass: 0, fail: 0, loss: 0, absent: 0, neutral: 0, pending: 0, missing: 0 };
  for (const item of strip) {
    if (item.kind === "loss" && item.result === "غائب") counted.absent++;
    else counted[item.kind]++;
  }
  if (strip.length) {
    const bits = [
      counted.pass ? `${counted.pass} نجاح` : "",
      counted.fail ? `${counted.fail} راسب بدون خصم` : "",
      counted.loss ? `${counted.loss} درجة خصم` : "",
      counted.absent ? `${counted.absent} غياب` : "",
      counted.neutral ? `${counted.neutral} ما انحسب (إجازة أو سماح أو بدون خصم)` : "",
      counted.pending ? `${counted.pending} معلّقة` : "",
      counted.missing ? `${counted.missing} ما انكتبت` : "",
    ].filter(Boolean);
    summary.push(storyParts(`${bold(strip.length)} امتحان بهالفصل: ${bits.join("، ")}.`));
  }
  const bonusProgress = n(student.bonusProgress);
  if (bonusProgress === 1) {
    summary.push(storyParts(`باقي نجاح واحد ويرجعله «${BONUS_OPPORTUNITY_ACTION}».`));
    highlights.push(summary[summary.length - 1]);
  }
  const newest = newestFirst[0];
  // A call about an exam sits under the exam's event, at its own time.
  let latestFollowUp: StudentStory["latestFollowUp"] = null;
  for (const event of events) {
    const candidates = event.subs.length
      ? event.subs.map((sub) => {
        const exam = event.id.startsWith("exam-") ? examById.get(event.id.slice(5)) : undefined;
        return { ...sub, parts: exam ? [...storyParts(`${bold(examTypeName(exam))}: `), ...sub.parts] : sub.parts };
      })
      : event.cats.includes("follow") ? [event] : [];
    for (const item of candidates) {
      if (!latestFollowUp || item.at > latestFollowUp.at) {
        latestFollowUp = { at: item.at, dayKey: item.dayKey, time: item.time, by: item.by, parts: item.parts };
      }
    }
  }
  if (newest) summary.push([...storyParts(`آخر شي صار (${bold(storyDay(newest.dayKey))}): `), ...newest.parts]);

  // ── Open items ──
  const openItems: StoryPart[][] = [];
  if (status === "مفصول" && student.dismissedChecked === false) openItems.push(storyParts("مفصول وكوده ما انقفل لهسه."));
  for (const pending of input.pendingGrades) {
    const exam = examById.get(s(pending.examId));
    openItems.push(storyParts(`درجة ${bold(examTypeName(exam))}${n(pending.score) !== null ? ` (${bold(n(pending.score))})` : ""} معلّقة تنتظر قرار.`));
  }
  for (const call of input.calls) {
    if (s(call.category) === "call-student-note" && s(call.notes) && !call.noteResolved) {
      openItems.push(storyParts(`ملاحظة مكالمة ${bold(storyDay(storyStamp(call.createdAt).dayKey))} ما انتهت: ${storyValue(call.notes)}`));
    }
  }
  if (bonusProgress === 2) {
    openItems.push(storyParts(`«${BONUS_OPPORTUNITY_ACTION}» مستحقة، تنتظر درجة ${bold(student.bonusWaitingExamName || "امتحان ناقص")}.`));
  }

  // ── Messages ──
  const chapterFacts = examFacts
    .filter((facts) => facts.chapterId === currentChapterId)
    .sort((a, b) => a.examDayKey.localeCompare(b.examDayKey) || a.examId.localeCompare(b.examId));
  const decisions = chapterEvents
    .filter((event) => event.cats.includes("decisions") && !event.id.startsWith("exam-") && !event.id.startsWith("audit-"))
    .map((event) => ({ dayKey: event.dayKey, text: storyPlain(event.parts) }));
  const messageLimit = limit !== null ? ` من ${bold(limit)}` : "";
  const parentLines = [
    `السلام عليكم، ولي أمر الطالب ${bold(name)} المحترم.`,
    `نودّ إعلامكم بوضع الطالب في دورة ${bold(input.courseName)}${input.activeChapter ? ` (${bold(input.activeChapter.name)})` : ""}:`,
    status === "مفصول"
      ? `- الطالب مفصول${lastDismissal ? ` منذ ${bold(storyDay(lastDismissal.dayKey))}` : ""}.`
      : opportunities > 0
        ? `- الطالب ${status === "مؤرشف" ? "مؤرشف" : "مستمر"}، ولديه ${bold(messageOpportunityCount(opportunities))}${messageLimit}.`
        : `- الطالب ${status === "مؤرشف" ? "مؤرشف" : "مستمر"}، ولم يبقَ لديه أي فرصة (${bold(0)}${messageLimit}).`,
  ];
  if (chapterDeducted > 0) parentLines.push(`- خُصمت ${bold(messageOpportunityCount(chapterDeducted))} في هذا الفصل${chapterBonuses ? `، واستعاد ${chapterBonuses === 1 ? "«فرصة مكافأة»" : `${bold(chapterBonuses)} «فرص مكافأة»`}` : ""}.`);
  const lastFacts = chapterFacts.slice(-3);
  if (lastFacts.length) {
    parentLines.push("- آخر الامتحانات:");
    for (const facts of lastFacts) parentLines.push(`  • ${bold(facts.name)} (${bold(storyDay(facts.examDayKey))}): ${messageExamSentence(facts, "parent")}.`);
  }
  if (bonusProgress === 1) parentLines.push("- يحتاج نجاحاً واحداً آخر ليستعيد «فرصة مكافأة».");
  parentLines.push("مع التقدير.");

  const studentLines = [
    `مرحباً ${bold(name)}،`,
    `هذا تقريرك في دورة ${bold(input.courseName)}${input.activeChapter ? ` — ${bold(input.activeChapter.name)}` : ""}:`,
    status === "مفصول"
      ? "أنت مفصول حالياً."
      : opportunities > 0
        ? `لديك الآن ${bold(messageOpportunityCount(opportunities))}${messageLimit}.`
        : `لم يبقَ لديك أي فرصة (${bold(0)}${messageLimit}). أي خصم آخر يؤدي إلى الفصل.`,
    "",
  ];
  const timeline = [
    ...chapterFacts.map((facts) => ({ dayKey: facts.examDayKey, line: `${bold(facts.name)}: ${messageExamSentence(facts, "student")}${facts.balanceAfter !== null && !facts.dismissed && (facts.deducted || facts.bonus) ? ` (بقي لك ${bold(facts.balanceAfter)})` : ""}.` })),
    ...decisions.map((decision) => ({ dayKey: decision.dayKey, line: studentDecisionLine(decision.text) })).filter((item) => item.line),
  ].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  for (const item of timeline) studentLines.push(`${bold(storyDay(item.dayKey))} — ${item.line}`);
  if (bonusProgress === 1) studentLines.push("", "تحتاج نجاحاً واحداً آخر لتستعيد «فرصة مكافأة».");
  studentLines.push("", "بالتوفيق.");

  return {
    summary,
    lead: summary[0] || [],
    highlights,
    latest: newest || null,
    deducted,
    counts: { total: strip.length, ...counted },
    latestFollowUp,
    openItems,
    strip,
    stripChapterName: input.activeChapter?.name || "",
    groups,
    parentMessage: storyWhatsApp(storyParts(parentLines.join("\n"))),
    studentMessage: storyWhatsApp(storyParts(studentLines.join("\n"))),
  };
}

/**
 * A stored dismissal reason as one plain sentence: «مخالفة بعد انتهاء الفرص -
 * غياب في امتحان يومي: X» → «غاب بـ**X** وهو بدون فرص». Unknown reasons are
 * returned cleaned, as typed.
 */
export function storyDismissalReason(raw: unknown): string {
  const reason = storyValue(displayOpportunityReason(raw)).replace(/^فصل الطالب:?\s*/u, "");
  return dismissalReasonSentence(reason, (value) => bold(value));
}

/** Staff wording of a decision → the student's own (second person, standard Arabic). */
function studentDecisionLine(text: string): string {
  const plain = text.replace(/\s+/g, " ").trim();
  let match: RegExpExecArray | null;
  if ((match = /^انخصمت (.+?) يدوياً(?::\s*(.+?))?\.?$/u.exec(plain))) return `خُصمت ${match[1].replace("فرصة وحدة", "فرصة")} بقرار الإدارة${match[2] ? `: ${match[2]}` : ""}.`;
  if ((match = /^انضافتله (.+?) يدوياً(?::\s*(.+?))?\.?$/u.exec(plain))) return `أُضيفت لك ${match[1].replace("فرصة وحدة", "فرصة")}${match[2] ? `: ${match[2]}` : ""}.`;
  if ((match = /^رجع بتعهّد(?: وانعطى (.+?))?\.?$/u.exec(plain))) return `أُعيد تفعيلك بتعهّد${match[1] ? ` برصيد ${match[1].replace("فرصتين", "فرصتين").replace("فرصة وحدة", "فرصة واحدة")}` : ""}.`;
  if ((match = /^رجع بقرار الإدارة(?: وانعطى (.+?))?(?::.*)?\.?$/u.exec(plain))) return `أُعيد تفعيلك بقرار الإدارة${match[1] ? ` برصيد ${match[1].replace("فرصة وحدة", "فرصة واحدة")}` : ""}.`;
  if (/^انفصل بقرار/u.test(plain)) return `فُصلت بقرار الإدارة${plain.includes(":") ? `: ${plain.split(":").slice(1).join(":").trim().replace(/\.$/, "")}` : ""}.`;
  if (/^بدا /u.test(plain)) return plain.replace(/^بدا (.+?) بـ(.+?)\.?$/u, "بدأ $1 برصيد $2.").replace("فرصة وحدة", "فرصة واحدة");
  return "";
}

/** The parts of a story event as plain text, for tests and copy. */
export function storyEventText(event: Pick<StoryEvent, "parts">): string {
  return storyPlain(event.parts);
}

