export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { validationError, routeErrorResponse } from '@/lib/route-helpers';
import { API_RATE_LIMITS, checkApiRateLimit } from '@/lib/api-rate-limit';
import { recalculateStudentsAcademicState } from '@/lib/academic-recalculate-server';

type ArchiveEntry = { studentId: string; opportunities: number; date: string };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArchiveEntries(value: unknown): ArchiveEntry[] {
  const source = typeof value === 'string' ? value : JSON.stringify(value ?? []);
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        studentId: String((entry as { studentId?: unknown }).studentId || '').trim(),
        opportunities: Math.max(0, Math.trunc(Number((entry as { opportunities?: unknown }).opportunities || 0))),
        date: String((entry as { date?: unknown }).date || todayISO()),
      }))
      .filter((entry) => entry.studentId);
  } catch {
    return [];
  }
}

function buildArchive(students: Array<{ id: string; opportunities: number }>): string {
  const entries: ArchiveEntry[] = students.map((student) => ({
    studentId: student.id,
    opportunities: Math.max(0, Math.trunc(Number(student.opportunities || 0))),
    date: todayISO(),
  }));
  return JSON.stringify(entries);
}

export async function POST(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['chapters.edit', 'courses.edit']);
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.studentOpportunitySync);
  if (rateLimitError) return rateLimitError;

  try {
    const body = await req.json().catch(() => ({}));
    const courseChapterId = String(body.courseChapterId || '').trim();
    const action = String(body.action || '').trim();
    const confirmImpact = body.confirmImpact === true;
    if (!courseChapterId) return validationError('تعذر تحديد ربط الفصل بالدورة');
    if (action !== 'activate' && action !== 'deactivate') return validationError('نوع إجراء الفصل غير معروف');
    if (!confirmImpact) return validationError('يجب تأكيد أثر العملية قبل تنفيذها', 409);

    const result = await db.$transaction(async (tx) => {
      const target = await tx.courseChapter.findUnique({
        where: { id: courseChapterId },
        include: { chapter: true, course: true },
      });
      if (!target) throw new Error('رابط الفصل غير موجود أو تم حذفه مسبقاً');

      const courseStudents = await tx.student.findMany({
        where: { courseId: target.courseId },
        select: { id: true, status: true, opportunities: true, baseOpportunities: true },
      });
      const nonArchivedStudents = courseStudents.filter((student) => student.status !== 'مؤرشف');
      const activeStudents = nonArchivedStudents.filter((student) => student.status !== 'مفصول');
      const dismissedStudents = nonArchivedStudents.filter((student) => student.status === 'مفصول');
      const activeStudentIds = activeStudents.map((student) => student.id);
      const dismissedStudentIds = dismissedStudents.map((student) => student.id);
      const baseOpportunities = Math.max(0, Math.trunc(Number(target.chapter.opportunities || 0)));
      let academicRecalculation: Awaited<ReturnType<typeof recalculateStudentsAcademicState>> | null = null;

      if (action === 'activate') {
        const activeLinks = await tx.courseChapter.findMany({
          where: { courseId: target.courseId, active: true, archived: false },
          select: { id: true },
        });
        const activeLinkIds = activeLinks.map((link) => link.id).filter((id) => id !== target.id);
        if (activeLinkIds.length) {
          await tx.courseChapter.updateMany({
            where: { id: { in: activeLinkIds } },
            data: { active: false, archived: false, archive: buildArchive(nonArchivedStudents) },
          });
        }

        const restoredArchive = new Map(parseArchiveEntries(target.archive).map((entry) => [entry.studentId, entry.opportunities]));
        await tx.courseChapter.update({
          where: { id: target.id },
          data: { active: true, archived: false },
        });

        for (const student of activeStudents) {
          await tx.student.update({
            where: { id: student.id },
            data: {
              opportunities: restoredArchive.has(student.id) ? Number(restoredArchive.get(student.id)) : baseOpportunities,
              baseOpportunities,
            },
          });
        }
        if (dismissedStudentIds.length) {
          await tx.student.updateMany({
            where: { id: { in: dismissedStudentIds }, courseId: target.courseId, status: { not: 'مؤرشف' } },
            data: { baseOpportunities },
          });
        }
        if (activeStudentIds.length) {
          academicRecalculation = await recalculateStudentsAcademicState(activeStudentIds, { tx });
        }

        return {
          ok: true,
          action,
          courseChapter: { id: target.id, courseId: target.courseId, chapterId: target.chapterId, active: true },
          impact: {
            affectedStudents: activeStudents.length + dismissedStudents.length,
            opportunityStudents: activeStudents.length,
            baseOnlyStudents: dismissedStudents.length,
            skippedArchived: courseStudents.length - nonArchivedStudents.length,
            disabledOtherActiveLinks: activeLinkIds.length,
            restoredArchiveEntries: restoredArchive.size,
          },
          academicRecalculation,
        };
      }

      await tx.courseChapter.update({
        where: { id: target.id },
        data: { active: false, archived: false, archive: buildArchive(nonArchivedStudents) },
      });
      const resetUpdate = await tx.student.updateMany({
        where: { courseId: target.courseId, status: { not: 'مؤرشف' } },
        data: { opportunities: 0, baseOpportunities: 0 },
      });
      if (activeStudentIds.length) {
        academicRecalculation = await recalculateStudentsAcademicState(activeStudentIds, { tx });
      }

      return {
        ok: true,
        action,
        courseChapter: { id: target.id, courseId: target.courseId, chapterId: target.chapterId, active: false },
        impact: {
          affectedStudents: resetUpdate.count,
          opportunityStudents: activeStudents.length,
          baseOnlyStudents: dismissedStudents.length,
          skippedArchived: courseStudents.length - nonArchivedStudents.length,
          archivedEntries: nonArchivedStudents.length,
        },
        academicRecalculation,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تنفيذ إجراء الفصل والفرص حالياً.');
  }
}
