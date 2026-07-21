export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { parseBaghdadDateOnly, parseBaghdadDateTime } from '@/lib/baghdad-time';
import { getExamEntryAvailability } from '@/lib/exam-utils';
import { ensureExamSchema } from '@/lib/exam-schema';
import { canonicalCourseIds, parseCourseIds, syncExamCourseLinks } from '@/lib/exam-course-links';
import { recalculateStudentsForExam } from '@/lib/academic-recalculate-server';
import { writeRequestAuditLog } from '@/lib/audit-log-server';
import type { Prisma } from '@prisma/client';
import { buildMutationPreviewToken } from '@/lib/mutation-preview-token';
import { withSerializableTransaction } from '@/lib/serializable-transaction';
import { ensureProtectedGradeMarkers } from '@/lib/protected-grade-markers-server';
import { repairProtectedAbsencesForStudents } from '@/lib/grace-period-repair-server';

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function canonicalDateTime(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function academicExamSnapshot(exam: {
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

function examMutationToken(exam: Record<string, unknown>): string {
  return buildMutationPreviewToken(`exam-edit:${String(exam.id || '')}`, exam);
}



type CourseValidationClient = Pick<Prisma.TransactionClient, 'course' | 'courseChapter'>;

async function courseSelectionProblems(
  client: CourseValidationClient,
  courseIds: string[],
): Promise<string[]> {
  const uniqueCourseIds = Array.from(new Set(courseIds.filter(Boolean)));
  if (uniqueCourseIds.length === 0) return [];

  const courses = await client.course.findMany({
    where: { id: { in: uniqueCourseIds } },
    select: { id: true, name: true, active: true },
  }) as Array<{ id: string; name: string; active: boolean }>;
  const courseById = new Map<string, { id: string; name: string; active: boolean }>(
    courses.map((course) => [course.id, course]),
  );

  const activeLinks = await client.courseChapter.findMany({
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
  const examDate = parseBaghdadDateOnly(body.date as string | Date | null | undefined);
  if (!examDate) return 'تاريخ الامتحان غير صحيح';
  const noDiscount = parseBoolean(body.noDiscount);
  const fullMark = Number(body.fullMark ?? 100);
  const passMark = Number(body.passMark ?? 50);
  const discountMark = noDiscount ? 0 : Number(body.discountMark ?? 0);
  if (![fullMark, passMark, discountMark].every((value) => Number.isFinite(value) && Number.isInteger(value))) return 'درجات الامتحان يجب أن تكون أعداداً صحيحة بدون كسور';
  if (fullMark <= 0) return 'الدرجة الكاملة يجب أن تكون أكبر من صفر';
  if (passMark < 0 || passMark > fullMark) return 'درجة النجاح يجب أن تكون بين صفر والدرجة الكاملة';
  if (!noDiscount && (discountMark < 0 || discountMark > fullMark)) return 'درجة الخصم يجب أن تكون بين صفر والدرجة الكاملة';
  if (!noDiscount && String(body.type) !== 'فاينل' && passMark <= discountMark) return 'درجة النجاح يجب أن تكون أكبر من درجة الخصم';
  const penalty = Number(body.opportunitiesPenalty ?? 1);
  if (!noDiscount && String(body.type) !== 'فاينل' && (!Number.isInteger(penalty) || penalty <= 0)) return 'خصم الفرص يجب أن يكون عدداً صحيحاً أكبر من صفر';
  if (!noDiscount && String(body.type) === 'فاينل' && body.dismissalGrade !== null && body.dismissalGrade !== undefined && body.dismissalGrade !== '') {
    const dismissalGrade = Number(body.dismissalGrade);
    if (!Number.isInteger(dismissalGrade) || dismissalGrade < 0 || dismissalGrade > fullMark) return 'درجة الفصل يجب أن تكون عدداً صحيحاً بين صفر والدرجة الكاملة';
  }
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
      return NextResponse.json({
        exams: exams.map((exam) => ({
          ...exam,
          mutationToken: examMutationToken(exam as unknown as Record<string, unknown>),
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    }
    // Default: return all exams WITHOUT grades (grades fetched separately via /api/grades)
    const exams = await db.exam.findMany({ orderBy: { date: 'desc' } });
    return NextResponse.json({
      exams: exams.map((exam) => ({
        ...exam,
        mutationToken: examMutationToken(exam as unknown as Record<string, unknown>),
      })),
    });
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
    const courseProblems = await courseSelectionProblems(db, parsedCourseIds);
    if (courseProblems.length > 0) {
      return validationError(`لا يمكن حفظ الامتحان بسبب مشاكل الدورات: ${courseProblems.join('، ')}`);
    }
    const noDiscount = parseBoolean(body.noDiscount);
    const examDate = parseBaghdadDateOnly(body.date as string | Date | null | undefined);
    if (!examDate) return validationError('تاريخ الامتحان غير صحيح');
    const scheduledActivateAt = body.scheduledActivateAt ? parseBaghdadDateTime(String(body.scheduledActivateAt)) : null;
    const scheduledDeactivateAt = body.scheduledDeactivateAt ? parseBaghdadDateTime(String(body.scheduledDeactivateAt)) : null;
    const requestedActive = body.active === undefined ? true : parseBoolean(body.active);
    const effectiveStoredActive = Boolean(scheduledActivateAt && scheduledActivateAt > new Date()) ? false : requestedActive;
    const exam = await db.$transaction(async (tx) => {
      const createdExam = await tx.exam.create({
        data: {
        name: String(body.name ?? '').trim(),
        type: body.type,
        courseIds: JSON.stringify(parsedCourseIds),
        mainSite: body.mainSite,
        date: examDate,
        fullMark: Number(body.fullMark || 100),
        passMark: Number(body.passMark || 50),
        discountMark: noDiscount ? 0 : Number(body.discountMark || 0),
        opportunitiesPenalty: noDiscount ? '0' : String(body.opportunitiesPenalty ?? 1),
        dismissalGrade: !noDiscount && String(body.type) === 'فاينل' && body.dismissalGrade !== null && body.dismissalGrade !== undefined ? Number(body.dismissalGrade) : null,
        noDiscount,
        active: effectiveStoredActive,
        scheduledActivateAt,
        scheduledDeactivateAt,
        },
      });
      await syncExamCourseLinks(tx, createdExam.id, parsedCourseIds);
      await ensureProtectedGradeMarkers(tx, { examIds: [createdExam.id] });
      return createdExam;
    });
    await writeRequestAuditLog(req, 'الامتحانات', 'إضافة امتحان من بيانات النظام', {
      examId: exam.id,
      examName: exam.name,
      courseIds: parsedCourseIds,
      active: exam.active,
    });
    return NextResponse.json(
      {
        exam: {
          ...exam,
          mutationToken: examMutationToken(exam as unknown as Record<string, unknown>),
        },
        source: 'database',
      },
      { status: 201 },
    );
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
    const {
      id,
      activationPreviewToken,
      expectedMutationToken,
      confirmExistingGrades: _legacyConfirmExistingGrades,
      ...rawPatch
    } = body;
    const normalizedPatch = { ...rawPatch };
    const allowedUpdateKeys = new Set([
      'name', 'type', 'courseIds', 'mainSite', 'date', 'fullMark', 'passMark',
      'discountMark', 'opportunitiesPenalty', 'dismissalGrade', 'noDiscount',
      'active', 'scheduledActivateAt', 'scheduledDeactivateAt',
    ]);
    for (const key of Object.keys(normalizedPatch)) {
      if (!allowedUpdateKeys.has(key)) delete normalizedPatch[key];
    }
    if (!id) return validationError('تعذر تحديد الامتحان المطلوب');
    if (normalizedPatch.name !== undefined) {
      const nameError = requireText(normalizedPatch.name, 'اسم الامتحان');
      if (nameError) return validationError(nameError);
      normalizedPatch.name = String(normalizedPatch.name ?? '').trim();
    }
    if (normalizedPatch.courseIds !== undefined) normalizedPatch.courseIds = JSON.stringify(parseCourseIds(normalizedPatch.courseIds));
    if (normalizedPatch.date !== undefined) {
      const parsedDate = parseBaghdadDateOnly(normalizedPatch.date as string | Date | null | undefined);
      if (!parsedDate) return validationError('تاريخ الامتحان غير صحيح');
      normalizedPatch.date = parsedDate;
    }
    if (normalizedPatch.fullMark !== undefined) normalizedPatch.fullMark = Number(normalizedPatch.fullMark);
    if (normalizedPatch.passMark !== undefined) normalizedPatch.passMark = Number(normalizedPatch.passMark);
    if (normalizedPatch.discountMark !== undefined) normalizedPatch.discountMark = Number(normalizedPatch.discountMark);
    if (normalizedPatch.opportunitiesPenalty !== undefined) normalizedPatch.opportunitiesPenalty = String(normalizedPatch.opportunitiesPenalty);
    if (normalizedPatch.dismissalGrade !== undefined) normalizedPatch.dismissalGrade = normalizedPatch.dismissalGrade === null || normalizedPatch.dismissalGrade === "" ? null : Number(normalizedPatch.dismissalGrade);
    if (normalizedPatch.noDiscount !== undefined) normalizedPatch.noDiscount = parseBoolean(normalizedPatch.noDiscount);
    if (normalizedPatch.scheduledActivateAt !== undefined) normalizedPatch.scheduledActivateAt = normalizedPatch.scheduledActivateAt ? parseBaghdadDateTime(String(normalizedPatch.scheduledActivateAt)) : null;
    if (normalizedPatch.scheduledDeactivateAt !== undefined) normalizedPatch.scheduledDeactivateAt = normalizedPatch.scheduledDeactivateAt ? parseBaghdadDateTime(String(normalizedPatch.scheduledDeactivateAt)) : null;
    if (normalizedPatch.active !== undefined) normalizedPatch.active = parseBoolean(normalizedPatch.active);
    if (normalizedPatch.scheduledActivateAt instanceof Date && normalizedPatch.scheduledActivateAt > new Date()) normalizedPatch.active = false;

    const result = await withSerializableTransaction(async (tx) => {
      const existingExam = await tx.exam.findUnique({ where: { id } });
      if (!existingExam) {
        return { validationMessage: 'الامتحان المطلوب غير موجود' } as const;
      }
      const currentMutationToken = examMutationToken(
        existingExam as unknown as Record<string, unknown>,
      );
      if (
        String(expectedMutationToken || '').trim() &&
        String(expectedMutationToken).trim() !== currentMutationToken
      ) {
        return { editConflict: true } as const;
      }
      const data = { ...normalizedPatch };
      const effectiveNoDiscount = Boolean(data.noDiscount ?? existingExam.noDiscount);
      if (effectiveNoDiscount) {
        data.discountMark = 0;
        data.opportunitiesPenalty = '0';
        data.dismissalGrade = null;
      } else if (String(data.type ?? existingExam.type) !== 'فاينل') {
        data.dismissalGrade = null;
      }

      const candidateExam = { ...existingExam, ...data };
      const candidateValidationMessage = validateExamPayload(candidateExam);
      if (candidateValidationMessage) {
        return { validationMessage: candidateValidationMessage } as const;
      }
      const candidateCourseIds = parseCourseIds(candidateExam.courseIds);
      const courseProblems = await courseSelectionProblems(tx, candidateCourseIds);
      if (courseProblems.length > 0) {
        return {
          validationMessage: `لا يمكن حفظ الامتحان بسبب مشاكل الدورات: ${courseProblems.join('، ')}`,
        } as const;
      }

      const wasAvailable = getExamEntryAvailability(existingExam).available;
      const candidateAvailability = getExamEntryAvailability(candidateExam);
      const candidateHasAutomaticActivation = Boolean(
        candidateExam.active || candidateExam.scheduledActivateAt,
      );
      if (!wasAvailable && candidateHasAutomaticActivation) {
        const storedGrades = await tx.grade.findMany({
          where: { examId: id },
          select: {
            id: true,
            studentId: true,
            status: true,
            score: true,
            updatedAt: true,
          },
          orderBy: { id: 'asc' },
        });
        if (storedGrades.length > 0) {
          const previewToken = buildMutationPreviewToken(`exam-activation:${id}`, {
            current: existingExam,
            proposed: candidateExam,
            grades: storedGrades,
          });
          if (String(activationPreviewToken || '') !== previewToken) {
            return {
              activationConflict: {
                previewToken,
                storedGradeCount: storedGrades.length,
                requiresFreshPreview: Boolean(activationPreviewToken),
              },
            } as const;
          }
        }
      }

      const exam = await tx.exam.update({ where: { id }, data });
      await syncExamCourseLinks(tx, exam.id, exam.courseIds);
      await ensureProtectedGradeMarkers(tx, { examIds: [exam.id] });
      const examGradeStudents = await tx.grade.findMany({
        where: { examId: exam.id },
        distinct: ['studentId'],
        select: { studentId: true },
      });
      if (examGradeStudents.length > 0) {
        await repairProtectedAbsencesForStudents(
          tx,
          examGradeStudents.map((grade) => grade.studentId),
        );
      }
      const academicRecalculation = hasAcademicExamChange(existingExam, exam)
        ? await recalculateStudentsForExam(exam.id, {
            tx,
            periodLeaveDates: [existingExam.date, exam.date],
          })
        : null;
      return {
        exam,
        academicRecalculation,
        availability: candidateAvailability,
        wasAvailable,
      } as const;
    });
    if ('validationMessage' in result && result.validationMessage) {
      return validationError(result.validationMessage);
    }
    if ('activationConflict' in result && result.activationConflict) {
      const { previewToken, storedGradeCount, requiresFreshPreview } = result.activationConflict;
      return NextResponse.json(
        {
          error: requiresFreshPreview
            ? `تغيرت درجات الامتحان أو حالته بعد التأكيد. راجع الأثر الجديد (${storedGradeCount} درجة) وأكد مرة أخرى.`
            : `هذا الامتحان غير متاح حالياً ومرتبط بـ ${storedGradeCount} درجة محفوظة. تفعيله الآن أو جدولته قد يجعل هذه الدرجات مؤثرة.`,
          requiresActivationConfirmation: true,
          requiresFreshPreview,
          previewToken,
          storedGradeCount,
        },
        { status: 409 },
      );
    }
    if ('editConflict' in result && result.editConflict) {
      return NextResponse.json(
        {
          error:
            'تغير الامتحان بعد فتحه للتعديل. تم إيقاف الحفظ قبل أي كتابة؛ حدّث البيانات وراجع التغييرات ثم حاول مجدداً.',
          requiresFreshExam: true,
        },
        { status: 409 },
      );
    }
    if (!result.exam || !result.availability) {
      throw new Error('تعذر تثبيت نتيجة تحديث الامتحان');
    }
    await writeRequestAuditLog(req, 'الامتحانات', 'تعديل امتحان وإعادة احتساب المتأثرين', {
      examId: result.exam.id,
      examName: result.exam.name,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
      academicChange: Boolean(result.academicRecalculation),
      availabilityBefore: result.wasAvailable,
      availabilityAfter: result.availability.available,
    });
    return NextResponse.json({
      exam: {
        ...result.exam,
        mutationToken: examMutationToken(
          result.exam as unknown as Record<string, unknown>,
        ),
      },
      academicRecalculation: result.academicRecalculation,
      availability: result.availability,
    });
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

    const result = await withSerializableTransaction(async (tx) => {
      const [
        exam,
        gradeCount,
        leaveCount,
        callCount,
        correctionSheetCount,
        telegramSubmissionCount,
        opportunityLogCount,
        missingNoteCount,
        leaveBackupCount,
      ] = await Promise.all([
        tx.exam.findUnique({ where: { id }, select: { id: true, name: true } }),
        tx.grade.count({ where: { examId: id } }),
        tx.studentLeave.count({ where: { examId: id } }),
        tx.studentCall.count({ where: { examId: id } }),
        tx.correctionSheet.count({ where: { examId: id } }),
        tx.telegramExamSubmission.count({ where: { examId: id } }),
        tx.opportunityLog.count({ where: { examId: id } }),
        tx.gradeEntryMissingNote.count({ where: { examId: id } }),
        tx.studentLeaveGradeBackup.count({ where: { examId: id } }),
      ]);
      if (!exam) return { notFound: true } as const;
      const relationCounts = [
        ['درجات', gradeCount],
        ['إجازات', leaveCount],
        ['مكالمات', callCount],
        ['أوراق تصحيح', correctionSheetCount],
        ['مستلمات تيليجرام', telegramSubmissionCount],
        ['حركات فرص', opportunityLogCount],
        ['ملاحظات إدخال', missingNoteCount],
        ['نسخ درجات الإجازات', leaveBackupCount],
      ] as const;
      const blockers = relationCounts.filter(([, count]) => count > 0);
      if (blockers.length > 0) {
        return { exam, blockers } as const;
      }
      await tx.examCourse.deleteMany({ where: { examId: id } });
      await tx.exam.delete({ where: { id } });
      return { exam, deleted: true } as const;
    });
    if ('notFound' in result) return validationError('الامتحان المطلوب غير موجود');
    if ('blockers' in result && result.blockers) {
      const details = result.blockers.map(([label, count]) => `${label}: ${count}`).join('، ');
      return validationError(
        `لا يمكن حذف الامتحان "${result.exam.name}" لأنه مرتبط ببيانات محفوظة (${details}). عطّل الامتحان بدلاً من حذفه حتى يبقى التاريخ الأكاديمي سليماً.`,
        409,
      );
    }
    await writeRequestAuditLog(req, 'الامتحانات', 'حذف امتحان غير مرتبط بأي بيانات', {
      examId: id,
      examName: result.exam.name,
      affectedStudents: 0,
      recalculatedStudents: 0,
    });
    return NextResponse.json({ ok: true, affectedStudents: 0, recalculatedStudents: 0 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الامتحان حالياً.');
  }
}
