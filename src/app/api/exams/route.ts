export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { baghdadDateKey, parseBaghdadDateOnly, parseBaghdadDateTime } from '@/lib/baghdad-time';
import { getExamEntryAvailability } from '@/lib/exam-utils';
import { assertDatabaseSchemaReady } from '@/lib/schema-readiness';
import { canonicalCourseIds, parseCourseIds, syncExamCourseLinks } from '@/lib/exam-course-links';
import { recalculateStudentsForExam } from '@/lib/academic-recalculate-server';
import { writeRequestAuditLog } from '@/lib/audit-log-server';
import type { Prisma } from '@prisma/client';
import { buildMutationPreviewToken } from '@/lib/mutation-preview-token';
import { withSerializableTransaction } from '@/lib/serializable-transaction';
import {
  ensureProtectedGradeMarkers,
  reconcileProtectedGradeMarkersForExamEdit,
} from '@/lib/protected-grade-markers-server';
import { repairProtectedAbsencesForStudents } from '@/lib/grace-period-repair-server';
import { settleDueScheduledExamActivations } from '@/lib/scheduled-exam-activation-server';
import {
  parseExamNumber,
  validateExamForm,
  validateExamGradePolicy,
} from '@/lib/exam-form-validation';

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
  mainSite?: unknown;
  date?: unknown;
  fullMark?: unknown;
  passMark?: unknown;
  discountMark?: unknown;
  opportunitiesPenalty?: unknown;
  dismissalGrade?: unknown;
  noDiscount?: unknown;
  active?: unknown;
  scheduledActivateAt?: unknown;
}): Record<string, string> {
  return {
    type: String(exam.type ?? ''),
    courseIds: canonicalCourseIds(exam.courseIds),
    mainSite: String(exam.mainSite ?? ''),
    date: canonicalDateTime(exam.date),
    fullMark: String(Number(exam.fullMark ?? 0)),
    passMark: String(Number(exam.passMark ?? 0)),
    discountMark: String(Number(exam.discountMark ?? 0)),
    opportunitiesPenalty: String(exam.opportunitiesPenalty ?? ''),
    dismissalGrade: exam.dismissalGrade === null || exam.dismissalGrade === undefined ? '' : String(Number(exam.dismissalGrade)),
    noDiscount: String(parseBoolean(exam.noDiscount)),
    active: String(parseBoolean(exam.active)),
    scheduledActivateAt: canonicalDateTime(exam.scheduledActivateAt),
  };
}

function hasAcademicExamChange(before: unknown, after: unknown): boolean {
  const beforeSnapshot = academicExamSnapshot(before as Record<string, unknown>);
  const afterSnapshot = academicExamSnapshot(after as Record<string, unknown>);
  return Object.keys(beforeSnapshot).some((key) => beforeSnapshot[key] !== afterSnapshot[key]);
}

function hasProtectedMarkerScopeChange(before: unknown, after: unknown): boolean {
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  return (
    canonicalCourseIds(left.courseIds) !== canonicalCourseIds(right.courseIds) ||
    String(left.mainSite ?? '') !== String(right.mainSite ?? '') ||
    canonicalDateTime(left.date) !== canonicalDateTime(right.date)
  );
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
  const parsedCourseIds = parseCourseIds(body.courseIds);
  const selectedMainSites = String(body.mainSite ?? '')
    .split(',')
    .map((site) => site.trim())
    .filter(Boolean);
  const noDiscount = parseBoolean(body.noDiscount);
  const validation = validateExamForm({
    name: body.name,
    type: body.type,
    courseIds: parsedCourseIds,
    mainSites: selectedMainSites,
    date: body.date,
    fullMark: body.fullMark ?? 100,
    passMark: body.passMark ?? 50,
    discountMark: body.discountMark ?? 0,
    opportunitiesPenalty: body.opportunitiesPenalty ?? 1,
    dismissalGrade: body.dismissalGrade,
    noDiscount,
  });
  if (!validation.isValid) return validation.firstError;

  const examDate = parseBaghdadDateOnly(
    body.date as string | Date | null | undefined,
  );
  return examDate ? null : 'تاريخ الامتحان غير صحيح';
}

type ValidatedExamGradeValues = {
  fullMark: number;
  passMark: number;
  discountMark: number;
  opportunitiesPenalty: number;
  dismissalGrade: number | null;
};

function validatedGradeValues(
  body: Record<string, unknown>,
): ValidatedExamGradeValues {
  const validation = validateExamGradePolicy({
    type: body.type,
    noDiscount: parseBoolean(body.noDiscount),
    fullMark: body.fullMark ?? 100,
    passMark: body.passMark ?? 50,
    discountMark: body.discountMark ?? 0,
    opportunitiesPenalty: body.opportunitiesPenalty ?? 1,
    dismissalGrade: body.dismissalGrade,
  });
  const { values } = validation;
  if (
    !validation.isValid ||
    values.fullMark === null ||
    values.passMark === null ||
    values.discountMark === null ||
    values.opportunitiesPenalty === null
  ) {
    throw new Error(
      `Exam grade values reached persistence without validation: ${validation.firstError || 'unknown validation error'}`,
    );
  }
  return {
    fullMark: values.fullMark,
    passMark: values.passMark,
    discountMark: values.discountMark,
    opportunitiesPenalty: values.opportunitiesPenalty,
    dismissalGrade: values.dismissalGrade,
  };
}

function normalizePatchedExamNumber(value: unknown): unknown {
  const parsed = parseExamNumber(value);
  // Preserve invalid/blank input for candidate validation instead of silently
  // coercing it to zero with Number(""). Valid values are canonicalized so
  // Arabic/Persian digits and numeric strings are persisted as numbers.
  return parsed === null ? value : parsed;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'exams.view');
  if (authError) return authError;

  try {
    await assertDatabaseSchemaReady();
    // A scheduled exam becomes logically active as time passes. Materialize any
    // due activation before returning the exam registry so persisted student
    // opportunities/dismissal state cannot remain stale until a later write.
    await settleDueScheduledExamActivations({ batchSize: 5 });
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
    await assertDatabaseSchemaReady();

    const body = await req.json();
    const validationMessage = validateExamPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const parsedCourseIds = parseCourseIds(body.courseIds);
    const courseProblems = await courseSelectionProblems(db, parsedCourseIds);
    if (courseProblems.length > 0) {
      return validationError(`لا يمكن حفظ الامتحان بسبب مشاكل الدورات: ${courseProblems.join('، ')}`);
    }
    const noDiscount = parseBoolean(body.noDiscount);
    const isFinalExam = String(body.type) === 'فاينل';
    const gradeValues = validatedGradeValues(body);
    const examDate = parseBaghdadDateOnly(body.date as string | Date | null | undefined);
    if (!examDate) return validationError('تاريخ الامتحان غير صحيح');
    const scheduledActivateAt = body.scheduledActivateAt ? parseBaghdadDateTime(String(body.scheduledActivateAt)) : null;
    const requestedActive = body.active === undefined ? true : parseBoolean(body.active);
    const effectiveStoredActive = Boolean(scheduledActivateAt && scheduledActivateAt > new Date()) ? false : requestedActive;
    // Student creation uses the same SERIALIZABLE helper. Keeping exam
    // creation at the same isolation level prevents a concurrent exam +
    // student import from both missing each other's protected grade markers.
    // If PostgreSQL detects that race, the shared helper retries the complete
    // transaction and the retry sees the committed student/exam.
    const exam = await withSerializableTransaction(async (tx) => {
      const createdExam = await tx.exam.create({
        data: {
          name: String(body.name ?? '').trim(),
          type: body.type,
          courseIds: JSON.stringify(parsedCourseIds),
          mainSite: body.mainSite,
          date: examDate,
          fullMark: gradeValues.fullMark,
          passMark: gradeValues.passMark,
          discountMark:
            noDiscount || isFinalExam ? 0 : gradeValues.discountMark,
          opportunitiesPenalty: noDiscount
            ? '0'
            : isFinalExam
              ? '0'
              : String(gradeValues.opportunitiesPenalty),
          dismissalGrade:
            !noDiscount && isFinalExam ? gradeValues.dismissalGrade : null,
          noDiscount,
          active: effectiveStoredActive,
          scheduledActivateAt,
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
    await assertDatabaseSchemaReady();

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
      'active', 'scheduledActivateAt',
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
    if (normalizedPatch.fullMark !== undefined) {
      normalizedPatch.fullMark = normalizePatchedExamNumber(normalizedPatch.fullMark);
    }
    if (normalizedPatch.passMark !== undefined) {
      normalizedPatch.passMark = normalizePatchedExamNumber(normalizedPatch.passMark);
    }
    if (normalizedPatch.discountMark !== undefined) {
      normalizedPatch.discountMark = normalizePatchedExamNumber(normalizedPatch.discountMark);
    }
    if (normalizedPatch.opportunitiesPenalty !== undefined) {
      const normalizedPenalty = normalizePatchedExamNumber(
        normalizedPatch.opportunitiesPenalty,
      );
      normalizedPatch.opportunitiesPenalty =
        typeof normalizedPenalty === 'number'
          ? String(normalizedPenalty)
          : normalizedPenalty;
    }
    if (normalizedPatch.dismissalGrade !== undefined) {
      normalizedPatch.dismissalGrade =
        normalizedPatch.dismissalGrade === null ||
        normalizedPatch.dismissalGrade === ''
          ? null
          : normalizePatchedExamNumber(normalizedPatch.dismissalGrade);
    }
    if (normalizedPatch.noDiscount !== undefined) normalizedPatch.noDiscount = parseBoolean(normalizedPatch.noDiscount);
    if (normalizedPatch.scheduledActivateAt !== undefined) normalizedPatch.scheduledActivateAt = normalizedPatch.scheduledActivateAt ? parseBaghdadDateTime(String(normalizedPatch.scheduledActivateAt)) : null;
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
      const effectiveNoDiscount = Boolean(
        data.noDiscount ?? existingExam.noDiscount,
      );
      const effectiveType = String(data.type ?? existingExam.type);
      if (effectiveNoDiscount) {
        data.discountMark = 0;
        data.opportunitiesPenalty = '0';
        data.dismissalGrade = null;
      } else if (effectiveType === 'فاينل') {
        data.discountMark = 0;
        data.opportunitiesPenalty = '0';
      } else {
        data.dismissalGrade = null;
      }

      const candidateExam = { ...existingExam, ...data };
      const candidateValidationMessage = validateExamPayload(candidateExam);
      if (candidateValidationMessage) {
        return { validationMessage: candidateValidationMessage } as const;
      }
      const candidateGradeValues = validatedGradeValues(candidateExam);
      if (data.fullMark !== undefined) {
        data.fullMark = candidateGradeValues.fullMark;
      }
      if (data.passMark !== undefined) {
        data.passMark = candidateGradeValues.passMark;
      }
      if (!effectiveNoDiscount && effectiveType !== 'فاينل') {
        if (data.discountMark !== undefined) {
          data.discountMark = candidateGradeValues.discountMark;
        }
        if (data.opportunitiesPenalty !== undefined) {
          data.opportunitiesPenalty = String(
            candidateGradeValues.opportunitiesPenalty,
          );
        }
      }
      if (!effectiveNoDiscount && effectiveType === 'فاينل') {
        data.dismissalGrade = candidateGradeValues.dismissalGrade;
      }

      // Never make an existing numeric grade invalid by lowering fullMark.
      // Stored grades are user data: reject the exam edit instead of silently
      // clamping, deleting, or excluding them from academic calculation.
      if (
        data.fullMark !== undefined &&
        Number(data.fullMark) !== Number(existingExam.fullMark)
      ) {
        const [invalidGradeStats, invalidPendingStats, invalidBackupStats] = await Promise.all([
          tx.grade.aggregate({
            where: {
              examId: id,
              status: 'درجة',
              score: { gt: Number(candidateExam.fullMark) },
            },
            _count: { _all: true },
            _max: { score: true },
          }),
          tx.gradeSmartNote.aggregate({
            where: {
              examId: id,
              status: 'PENDING',
              score: { gt: Number(candidateExam.fullMark) },
            },
            _count: { _all: true },
            _max: { score: true },
          }),
          tx.studentLeaveGradeBackup.aggregate({
            where: {
              examId: id,
              status: 'درجة',
              score: { gt: Number(candidateExam.fullMark) },
            },
            _count: { _all: true },
            _max: { score: true },
          }),
        ]);
        const invalidGradeCount =
          invalidGradeStats._count._all +
          invalidPendingStats._count._all +
          invalidBackupStats._count._all;
        const highestStoredScore = Math.max(
          Number(invalidGradeStats._max.score || 0),
          Number(invalidPendingStats._max.score || 0),
          Number(invalidBackupStats._max.score || 0),
        );
        if (invalidGradeCount > 0) {
          return {
            gradeRangeConflict: {
              invalidGradeCount,
              invalidLiveGradeCount: invalidGradeStats._count._all,
              invalidPendingGradeCount: invalidPendingStats._count._all,
              invalidLeaveBackupCount: invalidBackupStats._count._all,
              highestStoredScore,
              proposedFullMark: Number(candidateExam.fullMark),
            },
          } as const;
        }
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
      if (
        normalizedPatch.name !== undefined &&
        String(existingExam.name || '') !== String(exam.name || '')
      ) {
        // Renaming an exam is display/history synchronization, not an academic
        // rule change. Keep the existing no-recalculation contract, but update
        // textual opportunity-log references tied to this exam so profiles and
        // dismissal reasons do not keep showing the obsolete exam name.
        const oldName = String(existingExam.name || '');
        const newName = String(exam.name || '');
        if (oldName && newName) {
          const namedLogs = await tx.opportunityLog.findMany({
            where: { examId: exam.id, reason: { contains: oldName } },
            select: { id: true, reason: true },
          });
          for (const log of namedLogs) {
            const nextReason = String(log.reason || '').split(oldName).join(newName);
            if (nextReason !== log.reason) {
              await tx.opportunityLog.update({
                where: { id: log.id },
                data: { reason: nextReason },
              });
            }
          }
        }
      }
      if (normalizedPatch.date !== undefined) {
        // Exam leaves are linked by examId, so their academic effect already
        // follows the edited exam date. Only move display-date fields that were
        // actually tracking the old exam day; preserve any intentionally custom
        // administrative leave date instead of rewriting it blindly.
        const oldExamDay = baghdadDateKey(existingExam.date);
        const examLeaves = await tx.studentLeave.findMany({
          where: { examId: exam.id, leaveType: 'exam' },
          select: { id: true, date: true, dateFrom: true, dateTo: true },
        });
        for (const leave of examLeaves) {
          const leaveDatePatch: Prisma.StudentLeaveUpdateInput = {};
          if (baghdadDateKey(leave.date) === oldExamDay) leaveDatePatch.date = exam.date;
          if (leave.dateFrom && baghdadDateKey(leave.dateFrom) === oldExamDay) {
            leaveDatePatch.dateFrom = exam.date;
          }
          if (leave.dateTo && baghdadDateKey(leave.dateTo) === oldExamDay) {
            leaveDatePatch.dateTo = exam.date;
          }
          if (Object.keys(leaveDatePatch).length > 0) {
            await tx.studentLeave.update({
              where: { id: leave.id },
              data: leaveDatePatch,
            });
          }
        }
      }
      const protectedScopeChanged = hasProtectedMarkerScopeChange(existingExam, exam);
      const protectedMarkerReconciliation = protectedScopeChanged
        ? await reconcileProtectedGradeMarkersForExamEdit(tx, exam.id)
        : null;
      await ensureProtectedGradeMarkers(tx, {
        examIds: [exam.id],
        includeAbsent: protectedScopeChanged,
      });
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
        protectedMarkerReconciliation,
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
    if ('gradeRangeConflict' in result && result.gradeRangeConflict) {
      const {
        invalidGradeCount,
        invalidLiveGradeCount,
        invalidPendingGradeCount,
        invalidLeaveBackupCount,
        highestStoredScore,
        proposedFullMark,
      } = result.gradeRangeConflict;
      return NextResponse.json(
        {
          error: `لا يمكن جعل الدرجة الكاملة ${proposedFullMark} لأن ${invalidGradeCount} درجة محفوظة/معلقة/احتياطية تتجاوزها (أعلاها ${highestStoredScore}). لم تُعدّل أو تُحذف أي درجة. صحح هذه الدرجات أولاً أو اختر درجة كاملة مناسبة.`,
          code: 'EXAM_FULL_MARK_BELOW_STORED_GRADES',
          retryable: false,
          invalidGradeCount,
          invalidLiveGradeCount,
          invalidPendingGradeCount,
          invalidLeaveBackupCount,
          highestStoredScore,
          proposedFullMark,
        },
        {
          status: 409,
          headers: { 'X-TeacherPro-Retryable': '0' },
        },
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
    await assertDatabaseSchemaReady();

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
        smartNoteCount,
        leaveBackupCount,
      ] = await Promise.all([
        tx.exam.findUnique({ where: { id }, select: { id: true, name: true } }),
        tx.grade.count({ where: { examId: id } }),
        tx.studentLeave.count({ where: { examId: id } }),
        tx.studentCall.count({ where: { examId: id } }),
        tx.correctionSheet.count({ where: { examId: id } }),
        tx.telegramExamSubmission.count({ where: { examId: id } }),
        tx.opportunityLog.count({ where: { examId: id } }),
        tx.gradeSmartNote.count({ where: { examId: id } }),
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
        ['ملاحظات درجات ذكية', smartNoteCount],
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
