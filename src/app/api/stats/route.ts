export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { withFollowupTables } from '@/lib/followup-schema';
import { withGradeEntryMissingNoteSchema } from '@/lib/grade-entry-missing-note-schema';

const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
const PLEDGE_NOTE_KIND = 'تعهد ولي الأمر';

type DashboardAlertTone = 'danger' | 'warning' | 'info' | 'success';

type DashboardAlert = {
  id: string;
  title: string;
  description: string;
  count: number;
  tone: DashboardAlertTone;
  actionSection:
    | 'grade-entry'
    | 'student-registry'
    | 'follow-up-leaves'
    | 'opportunities'
    | 'follow-up-pledges';
  actionLabel: string;
  sample?: string[];
};

type ExamAlertRow = {
  id: string;
  name: string;
  date: Date;
  courseIds: string;
  mainSite: string | null;
  fullMark: number;
};

type StudentAlertRow = {
  id: string;
  courseId: string;
  mainSite: string | null;
  subSite: string | null;
  locationScope: string | null;
  createdAt: Date;
};

type GradeAlertRow = {
  examId: string;
  studentId: string;
  status: string;
  score: number | null;
};

type LeaveAlertRow = {
  studentId: string;
  examId: string | null;
  leaveType: string;
  date: Date;
  dateFrom: Date | null;
  dateTo: Date | null;
};

function parseCourseIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function splitSelection(value?: string | null): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function dateKey(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  const date = new Date(value);
  if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dayAfter(value: Date): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function getTodayBaghdadRange() {
  const baghdadNow = new Date(Date.now() + BAGHDAD_OFFSET_MS);
  const key = `${baghdadNow.getUTCFullYear()}-${String(baghdadNow.getUTCMonth() + 1).padStart(2, '0')}-${String(baghdadNow.getUTCDate()).padStart(2, '0')}`;
  const start = new Date(`${key}T00:00:00.000Z`);
  return { key, start, end: dayAfter(start) };
}

function normalizeArabicText(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ');
}

function normalizeExamSiteValue(value?: string | null): string {
  const raw = normalizeArabicText(value);
  if (!raw || raw === normalizeArabicText('الكل')) return raw || '';
  if (['اونلاين', 'الكتروني', 'إلكتروني', 'الكترونى'].map(normalizeArabicText).includes(raw)) {
    return normalizeArabicText('أونلاين');
  }
  return raw;
}

function studentMatchesExamMainSites(
  student: { mainSite?: string | null; subSite?: string | null; locationScope?: string | null },
  selectedMainSites: string[],
): boolean {
  const normalizedSelection = selectedMainSites.map(normalizeExamSiteValue).filter(Boolean);
  if (normalizedSelection.length === 0 || normalizedSelection.includes(normalizeExamSiteValue('الكل'))) return true;
  const values = new Set([student.mainSite, student.subSite, student.locationScope].map(normalizeExamSiteValue).filter(Boolean));
  return normalizedSelection.some((site) => values.has(site));
}

function isExamOnOrAfterStudentRegistration(student: { createdAt?: Date | string | null }, exam: { date?: Date | string | null }): boolean {
  const registeredAt = dateKey(student.createdAt);
  const examDate = dateKey(exam.date);
  if (!registeredAt || !examDate) return true;
  return examDate >= registeredAt;
}

function isGradeEntered(grade: GradeAlertRow | undefined, exam: { fullMark?: number | null }): boolean {
  if (!grade) return false;
  if (grade.status === 'درجة') {
    const score = Number(grade.score);
    return Number.isFinite(score) && score >= 0 && score <= Number(exam.fullMark || 0);
  }
  return grade.status === 'غائب' || grade.status === 'غش';
}

function hasLeaveForExam(studentId: string, exam: ExamAlertRow, leaves: LeaveAlertRow[]): boolean {
  const examDate = dateKey(exam.date);
  return leaves.some((leave) => {
    if (leave.studentId !== studentId) return false;
    if ((leave.leaveType || 'exam') === 'period') {
      const from = dateKey(leave.dateFrom || leave.date);
      const to = dateKey(leave.dateTo || leave.dateFrom || leave.date);
      return Boolean(examDate && from && to && examDate >= from && examDate <= to);
    }
    return leave.examId === exam.id;
  });
}

async function countActiveExamsWithMissingGrades(activeChapterCourseIds: Set<string>) {
  const exams = (await db.exam.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      date: true,
      courseIds: true,
      mainSite: true,
      fullMark: true,
    },
    orderBy: { date: 'desc' },
  })) as ExamAlertRow[];

  const examIds = exams.map((exam) => exam.id);
  const courseIds = Array.from(new Set(exams.flatMap((exam) => parseCourseIds(exam.courseIds))));
  if (exams.length === 0 || courseIds.length === 0) {
    return { examsWithMissingGrades: 0, missingGradesTotal: 0, sample: [] as string[] };
  }

  const examDates = exams.map((exam) => exam.date).filter((date): date is Date => date instanceof Date);
  const minExamDate = examDates.length ? new Date(Math.min(...examDates.map((date) => date.getTime()))) : null;
  const maxExamDate = examDates.length ? new Date(Math.max(...examDates.map((date) => date.getTime()))) : null;

  const leaveWhere: Prisma.StudentLeaveWhereInput = {
    OR: [
      { examId: { in: examIds } },
      ...(minExamDate && maxExamDate
        ? [
            {
              leaveType: 'period',
              dateFrom: { lte: dayAfter(maxExamDate) },
              dateTo: { gte: minExamDate },
            },
          ]
        : []),
    ],
  };

  const [students, grades, leaves] = await Promise.all([
    db.student.findMany({
      where: {
        status: 'نشط',
        courseId: { in: courseIds },
      },
      select: {
        id: true,
        courseId: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
        createdAt: true,
      },
    }),
    db.grade.findMany({
      where: { examId: { in: examIds } },
      select: {
        examId: true,
        studentId: true,
        status: true,
        score: true,
      },
    }),
    withFollowupTables(() => db.studentLeave.findMany({
      where: leaveWhere,
      select: {
        studentId: true,
        examId: true,
        leaveType: true,
        date: true,
        dateFrom: true,
        dateTo: true,
      },
    }), 'StudentLeave'),
  ]);

  const studentsByCourse = new Map<string, StudentAlertRow[]>();
  students.forEach((student) => {
    if (!activeChapterCourseIds.has(student.courseId)) return;
    const current = studentsByCourse.get(student.courseId) || [];
    current.push(student);
    studentsByCourse.set(student.courseId, current);
  });

  const gradesByExam = new Map<string, Map<string, GradeAlertRow>>();
  grades.forEach((grade) => {
    const examGrades = gradesByExam.get(grade.examId) || new Map<string, GradeAlertRow>();
    examGrades.set(grade.studentId, grade);
    gradesByExam.set(grade.examId, examGrades);
  });

  const leavesByStudent = new Map<string, LeaveAlertRow[]>();
  leaves.forEach((leave) => {
    const current = leavesByStudent.get(leave.studentId) || [];
    current.push(leave);
    leavesByStudent.set(leave.studentId, current);
  });

  let examsWithMissingGrades = 0;
  let missingGradesTotal = 0;
  const sample: string[] = [];

  for (const exam of exams) {
    const selectedCourseIds = parseCourseIds(exam.courseIds).filter((courseId) => activeChapterCourseIds.has(courseId));
    if (selectedCourseIds.length === 0) continue;
    const selectedMainSites = splitSelection(exam.mainSite);
    const examGrades = gradesByExam.get(exam.id) || new Map<string, GradeAlertRow>();
    const eligibleStudents = selectedCourseIds
      .flatMap((courseId) => studentsByCourse.get(courseId) || [])
      .filter((student) => isExamOnOrAfterStudentRegistration(student, exam))
      .filter((student) => studentMatchesExamMainSites(student, selectedMainSites));

    let missingForExam = 0;
    for (const student of eligibleStudents) {
      const studentLeaves = leavesByStudent.get(student.id) || [];
      if (studentLeaves.length > 0 && hasLeaveForExam(student.id, exam, studentLeaves)) continue;
      if (!isGradeEntered(examGrades.get(student.id), exam)) missingForExam += 1;
    }

    if (missingForExam > 0) {
      examsWithMissingGrades += 1;
      missingGradesTotal += missingForExam;
      if (sample.length < 3) sample.push(`${exam.name} (${missingForExam})`);
    }
  }

  return { examsWithMissingGrades, missingGradesTotal, sample };
}

/**
 * Dashboard statistics endpoint.
 *
 * Every number returned here is calculated from the database at request time.
 * The dashboard intentionally does not fall back to client-side cached arrays,
 * because cached/paginated data can make الإدارة ترى أرقاماً ناقصة ومطمئنة.
 */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const today = getTodayBaghdadRange();

    const activeChapterLinks = (await db.courseChapter.findMany({
      where: { active: true, archived: false },
      select: { courseId: true },
    })) as Array<{ courseId: string }>;
    const activeChapterCourseIds = new Set<string>(activeChapterLinks.map((link) => link.courseId));

    const activeStudentWhere = { status: 'نشط' as const };
    const studentsWithoutActiveChapterWhere: Prisma.StudentWhereInput = activeChapterCourseIds.size > 0
      ? { status: 'نشط', courseId: { notIn: Array.from(activeChapterCourseIds) } }
      : activeStudentWhere;

    const [
      activeCount,
      dismissedCount,
      totalCount,
      pendingSheetsCount,
      missingNotesCount,
      zeroOpportunityActiveCount,
      studentsWithoutActiveChapterCount,
      todaysLeavesCount,
      dismissedStudents,
      pledgeNotes,
      recentLogs,
      missingGradesSummary,
    ] = await Promise.all([
      db.student.count({ where: activeStudentWhere }),
      db.student.count({ where: { status: 'مفصول' } }),
      db.student.count(),
      db.correctionSheet.count({ where: { NOT: { status: 'مكتمل' } } }),
      withGradeEntryMissingNoteSchema(() => db.gradeEntryMissingNote.count()),
      db.student.count({ where: { status: 'نشط', opportunities: 0 } }),
      db.student.count({ where: studentsWithoutActiveChapterWhere }),
      withFollowupTables(() => db.studentLeave.count({
        where: {
          OR: [
            { leaveType: 'exam', date: { gte: today.start, lt: today.end } },
            { leaveType: 'period', dateFrom: { lte: today.start }, dateTo: { gte: today.start } },
          ],
        },
      }), 'StudentLeave'),
      db.student.findMany({
        where: { status: 'مفصول' },
        select: { id: true },
      }),
      withFollowupTables(() => db.studentNote.findMany({
        where: { kind: PLEDGE_NOTE_KIND },
        select: { studentId: true },
      }), 'StudentNote'),
      db.auditLog.findMany({
        orderBy: { time: 'desc' },
        take: 6,
      }),
      countActiveExamsWithMissingGrades(activeChapterCourseIds),
    ]);

    const pledgedStudentIds = new Set(pledgeNotes.map((note) => note.studentId));
    const dismissedNeedsPledgeCount = dismissedStudents.filter((student) => !pledgedStudentIds.has(student.id)).length;

    const allAlerts: DashboardAlert[] = [
      {
        id: 'exams-missing-grades',
        title: 'امتحانات عليها طلاب بلا درجات',
        description: `يوجد ${missingGradesSummary.missingGradesTotal} طالباً نشطاً ضمن امتحانات مفعلة ولم تُسجل لهم درجة أو غياب أو غش أو إجازة.`,
        count: missingGradesSummary.examsWithMissingGrades,
        tone: 'danger',
        actionSection: 'grade-entry',
        actionLabel: 'فتح تسجيل الدرجات',
        sample: missingGradesSummary.sample,
      },
      {
        id: 'students-without-active-chapter',
        title: 'طلاب بدون فصل نشط',
        description: 'هؤلاء الطلاب في دورات لا تملك أي فصل نشط، لذلك قد لا تدخل قواعد الامتحان والفرص عليهم بشكل صحيح.',
        count: studentsWithoutActiveChapterCount,
        tone: 'warning',
        actionSection: 'student-registry',
        actionLabel: 'مراجعة سجل الطلاب',
      },
      {
        id: 'today-leaves',
        title: 'إجازات اليوم',
        description: `إجازات مطابقة لتاريخ اليوم ${today.key} بتوقيت بغداد، وتشمل إجازات اليوم والإجازات الممتدة.`,
        count: todaysLeavesCount,
        tone: 'info',
        actionSection: 'follow-up-leaves',
        actionLabel: 'فتح الإجازات',
      },
      {
        id: 'active-zero-opportunities',
        title: 'طلاب نشطون بفرص صفر',
        description: 'طلاب حالتهم نشط لكن عدد الفرص لديهم صفر، وهذا يحتاج مراجعة قبل أي خصم أو فصل تلقائي جديد.',
        count: zeroOpportunityActiveCount,
        tone: 'danger',
        actionSection: 'opportunities',
        actionLabel: 'فتح إدارة الفرص',
      },
      {
        id: 'dismissed-needs-pledge',
        title: 'طلاب مفصولون يحتاجون تعهد',
        description: 'طلاب مفصولون لا يوجد لهم تعهد ولي أمر محفوظ في قاعدة البيانات.',
        count: dismissedNeedsPledgeCount,
        tone: 'warning',
        actionSection: 'follow-up-pledges',
        actionLabel: 'فتح التعهدات',
      },
    ];
    const alerts = allAlerts.filter((alert) => alert.count > 0);

    return NextResponse.json({
      activeStudents: activeCount,
      dismissedStudents: dismissedCount,
      totalStudents: totalCount,
      pendingCorrectionSheets: pendingSheetsCount,
      missingStudentsNotes: missingNotesCount,
      alerts,
      recentLogs,
      source: 'database' as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] /api/stats error:', error);
    return NextResponse.json(
      { error: 'تعذر تحميل الإحصائيات والتنبيهات من قاعدة البيانات حالياً.' },
      { status: 500 },
    );
  }
}
