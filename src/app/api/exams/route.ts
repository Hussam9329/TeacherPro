export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { parseBaghdadDateTime } from '@/lib/baghdad-time';
import { ensureExamSchema } from '@/lib/exam-schema';
import { canonicalCourseIds, parseCourseIds, syncExamCourseLinks } from '@/lib/exam-course-links';
import { recalculateStudentsForExam } from '@/lib/academic-recalculate-server';
import { writeRequestAuditLog } from '@/lib/audit-log-server';

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function canonicalDateTime(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function academicExamSnapshot(exam: {
  name?: unknown;
  type?: unknown;
  courseIds?: unknown;
  date?: unknown;
  fullMark?: unknown;
  passMark?: unknown;
  discountMark?: unknown;
  opportunitiesPenalty?: unknown;
  dismissalGrade?: unknown;
  noDiscount?: unknown;
  active?: unknown;
  scheduledActivateAt?: unknown;
  scheduledDeactivateAt?: unknown;
}): Record<string, string> {
  return {
    name: String(exam.name ?? ''),
    type: String(exam.type ?? ''),
    courseIds: canonicalCourseIds(exam.courseIds),
    date: canonicalDateTime(exam.date),
    fullMark: String(Number(exam.fullMark ?? 0)),
    passMark: String(Number(exam.passMark ?? 0)),
    discountMark: String(Number(exam.discountMark ?? 0)),
    opportunitiesPenalty: String(exam.opportunitiesPenalty ?? ''),
    dismissalGrade: exam.dismissalGrade === null || exam.dismissalGrade === undefined ? '' : String(Number(exam.dismissalGrade)),
    noDiscount: String(parseBoolean(exam.noDiscount)),
    active: String(parseBoolean(exam.active)),
    scheduledActivateAt: canonicalDateTime(exam.scheduledActivateAt),
    scheduledDeactivateAt: canonicalDateTime(exam.scheduledDeactivateAt),
  };
}

function hasAcademicExamChange(before: unknown, after: unknown): boolean {
  const beforeSnapshot = academicExamSnapshot(before as Record<string, unknown>);
  const afterSnapshot = academicExamSnapshot(after as Record<string, unknown>);
  return Object.keys(beforeSnapshot).some((key) => beforeSnapshot[key] !== afterSnapshot[key]);
}



async function courseSelectionProblems(courseIds: string[]): Promise<string[]> {
  const uniqueCourseIds = Array.from(new Set(courseIds.filter(Boolean)));
  if (uniqueCourseIds.length === 0) return [];

  const courses = await db.course.findMany({
    where: { id: { in: uniqueCourseIds } },
    select: { id: true, name: true, active: true },
  }) as Array<{ id: string; name: string; active: boolean }>;
  const courseById = new Map<string, { id: string; name: string; active: boolean }>(
    courses.map((course) => [course.id, course]),
  );

  const activeLinks = await db.courseChapter.findMany({
    where: { courseId: { in: uniqueCourseIds }, active: true, archived: false },
    select: { courseId: true },
  }) as Array<{ courseId: string }>;

  const activeCountsByCourseId = new Map<string, number>();
  for (const link of activeLinks) {
    activeCountsByCourseId.set(link.courseId, (activeCountsByCourseId.get(link.courseId) || 0) + 1);
  }

  const problems: string[] = [];
  for (const courseId of uniqueCourseIds) {
    const course = courseById.get(courseId);
    const label = course?.name || courseId;
    if (!course) {
      problems.push(`الدورة "${label}" غير موجودة`);
      continue;
    }
    if (!course.active) {
      problems.push(`الدورة "${label}" موقوفة عن التسجيل والاختيارات الجديدة`);
    }
    const activeCount = activeCountsByCourseId.get(courseId) || 0;
    if (activeCount === 0) {
      problems.push(`الدورة "${label}" بلا فصل نشط`);
    } else if (activeCount > 1) {
      problems.push(`الدورة "${label}" لديها ${activeCount} فصول نشطة`);
    }
  }
  return problems;
}

function validateExamPayload(body: Record<string, unknown>) {
  const nameError = requireText(body.name, 'اسم الامتحان');
  if (nameError) return nameError;
  if (!['يومي', 'تراكمي', 'فاينل'].includes(String(body.type ?? ''))) return 'نوع الامتحان غير صحيح';
  if (parseCourseIds(body.courseIds).length === 0) return 'يجب اختيار دورة واحدة على الأقل';
  const selectedMainSites = String(body.mainSite ?? '')
    .split(',')
    .map((site) => site.trim())
    .filter(Boolean);
  if (selectedMainSites.length === 0) return 'يجب اختيار منطقة واحدة على الأقل';
  const noDiscount = parseBoolean(body.noDiscount);
  const fullMark = Number(body.fullMark ?? 100);
  const passMark = Number(body.passMark ?? 50);
  const discountMark = noDiscount ? 0 : Number(body.discountMark ?? 0);
  if (![fullMark, passMark, discountMark].every(Number.isFinite)) return 'درجات الامتحان يجب أن تكون أرقاماً صحيحة';
  if (fullMark <= 0) return 'الدرجة الكاملة يجب أن تكون أكبر من صفر';
  if (passMark < 0 || passMark > fullMark) return 'درجة النجاح يجب أن تكون بين صفر والدرجة الكاملة';
  if (!noDiscount && (discountMark < 0 || discountMark > fullMark)) return 'درجة الخصم يجب أن تكون بين صفر والدرجة الكاملة';
  if (!noDiscount && String(body.type) !== 'فاينل' && passMark <= discountMark) return 'درجة النجاح يجب أن تكون أكبر من درجة الخصم';
  if (!noDiscount && String(body.type) !== 'فاينل' && Number(body.opportunitiesPenalty ?? 1) <= 0) return 'خصم الفرص يجب أن يكون أكبر من صفر';
  return null;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'exams.view');
  if (authError) return authError;

  try {
    await ensureExamSchema();
    const { isPaginatedRequest, parsePagination } = await import('@/lib/pagination');
    if (isPaginatedRequest(req)) {
      const { page, limit, skip } = parsePagination(req);
      const [exams, total] = await Promise.all([
        db.exam.findMany({ orderBy: { date: 'desc' }, skip, take: limit }),
        db.exam.count(),
      ]);
      return NextResponse.json({ exams, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    // Default: return all exams WITHOUT grades (grades fetched separately via /api/grades)
    const exams = await db.exam.findMany({ orderBy: { date: 'desc' } });
    return NextResponse.json({ exams });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الامتحانات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'exams.add');
  if (authError) return authError;

  try {
    await ensureExamSchema();

    const body = await req.json();
    const validationMessage = validateExamPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const parsedCourseIds = parseCourseIds(body.courseIds);
    const courseProblems = await courseSelectionProblems(parsedCourseIds);
    if (courseProblems.length > 0) {
      return validationError(`لا يمكن حفظ الامتحان بسبب مشاكل الدورات: ${courseProblems.join('، ')}`);
    }
    const noDiscount = parseBoolean(body.noDiscount);
    const exam = await db.$transaction(async (tx) => {
      const createdExam = await tx.exam.create({
        data: {
        name: String(body.name ?? '').trim(),
        type: body.type,
        courseIds: JSON.stringify(parsedCourseIds),
        mainSite: body.mainSite,
        date: body.date ? new Date(body.date) : new Date(),
        fullMark: Number(body.fullMark || 100),
        passMark: Number(body.passMark || 50),
        discountMark: noDiscount ? 0 : Number(body.discountMark || 0),
        opportunitiesPenalty: noDiscount ? '0' : String(body.opportunitiesPenalty ?? 1),
        dismissalGrade: !noDiscount && String(body.type) === 'فاينل' && body.dismissalGrade !== null && body.dismissalGrade !== undefined ? Number(body.dismissalGrade) : null,
        noDiscount,
        active: body.active ?? true,
        scheduledActivateAt: body.scheduledActivateAt ? parseBaghdadDateTime(String(body.scheduledActivateAt)) : null,
        scheduledDeactivateAt: body.scheduledDeactivateAt ? parseBaghdadDateTime(String(body.scheduledDeactivateAt)) : null,
        },
      });
      await syncExamCourseLinks(tx, createdExam.id, parsedCourseIds);
      return createdExam;
    });
    await writeRequestAuditLog(req, 'الامتحانات', 'إضافة امتحان من قاعدة البيانات', {
      examId: exam.id,
      examName: exam.name,
      courseIds: parsedCourseIds,
      active: exam.active,
    });
    return NextResponse.json({ exam, source: 'database' }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الامتحان حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'exams.edit');
  if (authError) return authError;

  try {
    await ensureExamSchema();

    const body = await req.json();
    const { id, ...data } = body;
    for (const obsoleteKey of ["attendance", "attendanceClosed", "groupId"]) {
      delete data[obsoleteKey];
    }
    if (!id) return validationError('تعذر تحديد الامتحان المطلوب');
    const existingExam = await db.exam.findUnique({ where: { id } });
    if (!existingExam) return validationError('الامتحان المطلوب غير موجود');
    if (data.name !== undefined) {
      const nameError = requireText(data.name, 'اسم الامتحان');
      if (nameError) return validationError(nameError);
      data.name = String(data.name ?? '').trim();
    }
    if (data.courseIds !== undefined) data.courseIds = JSON.stringify(parseCourseIds(data.courseIds));
    if (data.date !== undefined) data.date = data.date ? new Date(data.date) : new Date();
    if (data.fullMark !== undefined) data.fullMark = Number(data.fullMark);
    if (data.passMark !== undefined) data.passMark = Number(data.passMark);
    if (data.discountMark !== undefined) data.discountMark = Number(data.discountMark);
    if (data.opportunitiesPenalty !== undefined) data.opportunitiesPenalty = String(data.opportunitiesPenalty);
    if (data.dismissalGrade !== undefined) data.dismissalGrade = data.dismissalGrade === null || data.dismissalGrade === "" ? null : Number(data.dismissalGrade);
    if (data.noDiscount !== undefined) data.noDiscount = parseBoolean(data.noDiscount);
    if (data.scheduledActivateAt !== undefined) data.scheduledActivateAt = data.scheduledActivateAt ? parseBaghdadDateTime(String(data.scheduledActivateAt)) : null;
    if (data.scheduledDeactivateAt !== undefined) data.scheduledDeactivateAt = data.scheduledDeactivateAt ? parseBaghdadDateTime(String(data.scheduledDeactivateAt)) : null;

    const candidateValidationMessage = validateExamPayload({
      name: data.name ?? existingExam.name,
      type: data.type ?? existingExam.type,
      courseIds: data.courseIds ?? existingExam.courseIds,
      fullMark: data.fullMark ?? existingExam.fullMark,
      passMark: data.passMark ?? existingExam.passMark,
      discountMark: data.discountMark ?? existingExam.discountMark,
      opportunitiesPenalty: data.opportunitiesPenalty ?? existingExam.opportunitiesPenalty,
      noDiscount: data.noDiscount ?? existingExam.noDiscount,
    });
    if (candidateValidationMessage) return validationError(candidateValidationMessage);
    const candidateCourseIds = parseCourseIds(data.courseIds ?? existingExam.courseIds);
    const courseProblems = await courseSelectionProblems(candidateCourseIds);
    if (courseProblems.length > 0) {
      return validationError(`لا يمكن حفظ الامتحان بسبب مشاكل الدورات: ${courseProblems.join('، ')}`);
    }
    const effectiveNoDiscount = Boolean(data.noDiscount ?? existingExam.noDiscount);
    if (effectiveNoDiscount) {
      data.discountMark = 0;
      data.opportunitiesPenalty = '0';
      data.dismissalGrade = null;
    } else if (String(data.type ?? existingExam.type) !== 'فاينل') {
      data.dismissalGrade = null;
    }

    const result = await db.$transaction(async (tx) => {
      const exam = await tx.exam.update({ where: { id }, data });
      await syncExamCourseLinks(tx, exam.id, exam.courseIds);
      const academicRecalculation = hasAcademicExamChange(existingExam, exam)
        ? await recalculateStudentsForExam(exam.id, { tx })
        : null;
      return { exam, academicRecalculation };
    });
    await writeRequestAuditLog(req, 'الامتحانات', 'تعديل امتحان وإعادة احتساب المتأثرين', {
      examId: result.exam.id,
      examName: result.exam.name,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
      academicChange: Boolean(result.academicRecalculation),
    });
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الامتحان حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'exams.delete');
  if (authError) return authError;

  try {
    await ensureExamSchema();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الامتحان المطلوب');

    const [exam, gradeCount] = await Promise.all([
      db.exam.findUnique({ where: { id }, select: { id: true, name: true } }),
      db.grade.count({ where: { examId: id } }),
    ]);
    if (!exam) return validationError('الامتحان المطلوب غير موجود');
    if (gradeCount > 0) {
      return validationError(`لا يمكن حذف الامتحان "${exam.name}" لأن عليه ${gradeCount} سجل درجات. عطّل الامتحان بدلاً من حذفه.`);
    }

    const deleted = await db.$transaction(async (tx) => {
      const correctionSheets = await tx.correctionSheet.deleteMany({ where: { examId: id } });
      await tx.examCourse.deleteMany({ where: { examId: id } });
      const opportunityLogs = await tx.opportunityLog.deleteMany({ where: { examId: id } });
      await tx.exam.delete({ where: { id } });
      return { correctionSheets: correctionSheets.count, opportunityLogs: opportunityLogs.count };
    });
    await writeRequestAuditLog(req, 'الامتحانات', 'حذف امتحان بدون درجات وتنظيف السجلات التابعة', {
      examId: id,
      examName: exam.name,
      deletedCorrectionSheets: deleted.correctionSheets,
      deletedOpportunityLogs: deleted.opportunityLogs,
    });
    return NextResponse.json({ ok: true, ...deleted });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الامتحان وسجلاته التابعة حالياً.');
  }
}
