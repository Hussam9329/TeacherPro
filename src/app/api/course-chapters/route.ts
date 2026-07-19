export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import {
  requireText,
  routeErrorResponse,
  validationError,
} from "@/lib/route-helpers";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";

class CourseChapterIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseChapterIntegrityError";
  }
}

function courseChapterMutationError(error: unknown, fallback: string) {
  if (error instanceof CourseChapterIntegrityError) {
    return validationError(error.message, 409);
  }
  const prismaError = error as { code?: string };
  if (prismaError?.code === "P2002") {
    return validationError(
      "تعذر حفظ الربط لأن الدورة تحتوي فصلاً نشطاً أو ربطاً مماثلاً بالفعل. حدّث الصفحة ثم راجع الفصول المرتبطة.",
      409,
    );
  }
  return routeErrorResponse(error, fallback);
}

function readListPagination(
  req: NextRequest,
  fallbackPageSize = 100,
  maxPageSize = 500,
) {
  const searchParams = new URL(req.url).searchParams;
  const rawPageSize = searchParams.get("pageSize") ?? searchParams.get("limit");
  const rawPage = searchParams.get("page");
  const pageNumber = Number(rawPage ?? 1);
  const pageSizeNumber = Number(rawPageSize ?? fallbackPageSize);
  const page =
    Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1;
  const pageSize =
    Number.isFinite(pageSizeNumber) && pageSizeNumber > 0
      ? Math.min(Math.floor(pageSizeNumber), maxPageSize)
      : fallbackPageSize;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

type ArchiveEntry = { studentId: string; opportunities: number; date?: string };

function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return Boolean(value);
}

function normalizeOpportunityValue(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function parseArchiveEntries(value: unknown): ArchiveEntry[] {
  const source =
    typeof value === "string" ? value : JSON.stringify(value ?? []);
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        studentId: String(
          (entry as { studentId?: unknown }).studentId || "",
        ).trim(),
        opportunities: normalizeOpportunityValue(
          (entry as { opportunities?: unknown }).opportunities,
        ),
        date: (entry as { date?: unknown }).date
          ? String((entry as { date?: unknown }).date)
          : undefined,
      }))
      .filter((entry) => entry.studentId);
  } catch {
    return [];
  }
}

function normalizeArchiveText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim() ? value : "[]";
  }
  try {
    return JSON.stringify(Array.isArray(value) ? value : []);
  } catch {
    return "[]";
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, [
    "chapters.view",
    "courses.view",
    "grades.add",
    "grades.view",
  ]);
  if (authError) return authError;

  try {
    const { page, pageSize, skip } = readListPagination(req);
    const [totalCount, courseChapters] = await Promise.all([
      db.courseChapter.count(),
      db.courseChapter.findMany({
        orderBy: { courseId: "asc" },
        include: { course: true, chapter: true },
        skip,
        take: pageSize,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return NextResponse.json({
      courseChapters,
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل روابط الفصول بالدورات حالياً.",
    );
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAnyPermission(req, [
    "chapters.edit",
    "courses.edit",
  ]);
  if (authError) return authError;

  try {
    const body = await req.json();
    const courseError = requireText(body.courseId, "الدورة");
    if (courseError) return validationError(courseError);
    const chapterError = requireText(body.chapterId, "الفصل");
    if (chapterError) return validationError(chapterError);
    const existing = await db.courseChapter.findFirst({
      where: {
        courseId: String(body.courseId),
        chapterId: String(body.chapterId),
        archived: false,
      },
    });
    if (existing) return validationError("الفصل مرتبط مسبقاً بهذه الدورة", 409);
    const courseChapter = await db.courseChapter.create({
      data: {
        active: false,
        archived: false,
        archive: "[]",
        courseId: String(body.courseId),
        chapterId: String(body.chapterId),
      },
      include: { course: true, chapter: true },
    });
    return NextResponse.json({ courseChapter }, { status: 201 });
  } catch (error) {
    return courseChapterMutationError(error, "تعذر ربط الفصل بالدورة حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requireAnyPermission(req, [
    "chapters.edit",
    "courses.edit",
  ]);
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return validationError("تعذر تحديد رابط الفصل بالدورة");

    const syncStudentOpportunities = body.syncStudentOpportunities === true;
    if (syncStudentOpportunities) {
      const rateLimitError = await checkApiRateLimit(
        req,
        API_RATE_LIMITS.studentOpportunitySync,
      );
      if (rateLimitError) return rateLimitError;
    }

    const updateData: {
      active?: boolean;
      archived?: boolean;
      archive?: string;
      courseId?: string;
      chapterId?: string;
    } = {};

    const activeValue = normalizeBoolean(body.active);
    const archivedValue = normalizeBoolean(body.archived);
    if (activeValue !== undefined) updateData.active = activeValue;
    if (archivedValue !== undefined) updateData.archived = archivedValue;
    if (body.archive !== undefined)
      updateData.archive = normalizeArchiveText(body.archive);
    if (body.courseId !== undefined && !syncStudentOpportunities)
      updateData.courseId = String(body.courseId);
    if (body.chapterId !== undefined && !syncStudentOpportunities)
      updateData.chapterId = String(body.chapterId);

    const result = await withSerializableTransaction(async (tx) => {
      const existingCourseChapter = await tx.courseChapter.findUnique({
        where: { id: String(id) },
      });
      if (!existingCourseChapter) {
        throw new CourseChapterIntegrityError(
          "رابط الفصل غير موجود أو تم حذفه مسبقاً",
        );
      }

      const finalCourseId = String(
        updateData.courseId ?? existingCourseChapter.courseId,
      ).trim();
      const finalChapterId = String(
        updateData.chapterId ?? existingCourseChapter.chapterId,
      ).trim();
      const finalActive = updateData.active ?? existingCourseChapter.active;
      const finalArchived =
        updateData.archived ?? existingCourseChapter.archived;

      if (!finalCourseId || !finalChapterId) {
        throw new CourseChapterIntegrityError(
          "تعذر تحديد الدورة أو الفصل للرابط",
        );
      }
      if (finalActive && finalArchived) {
        throw new CourseChapterIntegrityError(
          "لا يمكن أن يكون ربط الفصل مفعلاً ومؤرشفاً في الوقت نفسه",
        );
      }

      // Moving an already-active link would otherwise leave the source course
      // with stale student balances. Force the explicit deactivate -> move ->
      // activate flow, which previews and synchronizes both sides safely.
      if (
        existingCourseChapter.active &&
        finalCourseId !== existingCourseChapter.courseId
      ) {
        throw new CourseChapterIntegrityError(
          "لا يمكن نقل ربط فصل مفعل مباشرة. ألغِ تفعيله أولاً، ثم انقله وفعّله في الدورة الجديدة بعد معاينة الأثر.",
        );
      }

      const [targetCourse, targetChapter] = await Promise.all([
        tx.course.findUnique({
          where: { id: finalCourseId },
          select: { id: true },
        }),
        tx.chapter.findUnique({
          where: { id: finalChapterId },
          select: { id: true, name: true, opportunities: true },
        }),
      ]);
      if (!targetCourse)
        throw new CourseChapterIntegrityError("الدورة الجديدة غير موجودة");
      if (!targetChapter)
        throw new CourseChapterIntegrityError("الفصل المحدد غير موجود");

      const duplicateLink = await tx.courseChapter.findFirst({
        where: {
          id: { not: String(id) },
          courseId: finalCourseId,
          chapterId: finalChapterId,
          archived: false,
        },
        select: { id: true },
      });
      if (duplicateLink) {
        throw new CourseChapterIntegrityError("الفصل مرتبط مسبقاً بهذه الدورة");
      }

      if (finalActive) {
        const conflictingActiveLink = await tx.courseChapter.findFirst({
          where: {
            id: { not: String(id) },
            courseId: finalCourseId,
            active: true,
            archived: false,
          },
          select: { id: true },
        });
        if (
          conflictingActiveLink &&
          finalCourseId !== existingCourseChapter.courseId
        ) {
          throw new CourseChapterIntegrityError(
            "الدورة الجديدة تحتوي فصلاً نشطاً بالفعل. ألغِ تفعيله أو استخدم إجراء التفعيل الرسمي أولاً.",
          );
        }

        await tx.courseChapter.updateMany({
          where: {
            courseId: finalCourseId,
            id: { not: String(id) },
            active: true,
            archived: false,
          },
          // Never unarchive another link as a side effect of activation.
          data: { active: false },
        });
      }

      const courseChapter = await tx.courseChapter.update({
        where: { id: String(id) },
        data: updateData,
        include: { chapter: { select: { name: true, opportunities: true } } },
      });
      let affectedStudents = 0;
      let opportunityStudents = 0;
      let baseOnlyStudents = 0;
      let skippedArchived = 0;
      let skippedDismissed = 0;
      let academicRecalculation: Awaited<
        ReturnType<typeof recalculateStudentsAcademicState>
      > | null = null;

      if (syncStudentOpportunities) {
        // Ignore every opportunity/course value sent by an old client. Resolve
        // the course's actual active link after the update, inside this same
        // transaction, so an inactive legacy link can never zero balances while
        // another real active chapter still exists.
        const courseId = courseChapter.courseId;
        const activeLinks = await tx.courseChapter.findMany({
          where: { courseId, active: true, archived: false },
          include: {
            chapter: { select: { name: true, opportunities: true } },
          },
        });
        if (activeLinks.length > 1) {
          throw new CourseChapterIntegrityError(
            "لا يمكن مزامنة الفرص لأن الدورة تحتوي أكثر من فصل نشط. لم يتم تغيير أرصدة الطلاب.",
          );
        }

        const courseStudents = await tx.student.findMany({
          where: { courseId },
          select: { id: true, status: true },
        });
        const nonArchivedStudents = courseStudents.filter(
          (student) => student.status !== "مؤرشف",
        );
        const activeStudentIds = nonArchivedStudents
          .filter((student) => student.status !== "مفصول")
          .map((student) => student.id);
        const dismissedStudentIds = nonArchivedStudents
          .filter((student) => student.status === "مفصول")
          .map((student) => student.id);
        skippedArchived = courseStudents.length - nonArchivedStudents.length;
        skippedDismissed = dismissedStudentIds.length;

        const effectiveActiveLink = activeLinks[0] || null;
        if (effectiveActiveLink) {
          const baseOpportunities = normalizeOpportunityValue(
            effectiveActiveLink.chapter.opportunities,
          );
          if (activeStudentIds.length) {
            const baseUpdate = await tx.student.updateMany({
              where: { id: { in: activeStudentIds }, courseId },
              data: { opportunities: baseOpportunities, baseOpportunities },
            });
            opportunityStudents = baseUpdate.count;
          }
          if (dismissedStudentIds.length) {
            const dismissedBaseUpdate = await tx.student.updateMany({
              where: { id: { in: dismissedStudentIds }, courseId },
              data: { baseOpportunities },
            });
            baseOnlyStudents = dismissedBaseUpdate.count;
          }

          const archiveEntries = parseArchiveEntries(
            effectiveActiveLink.archive,
          );
          const activeStudentIdSet = new Set(activeStudentIds);
          const dismissedStudentIdSet = new Set(dismissedStudentIds);
          for (const entry of archiveEntries) {
            if (activeStudentIdSet.has(entry.studentId)) {
              await tx.student.updateMany({
                where: {
                  id: entry.studentId,
                  courseId,
                  status: { not: "مؤرشف" },
                },
                data: {
                  opportunities: Math.min(
                    entry.opportunities,
                    baseOpportunities,
                  ),
                  baseOpportunities,
                },
              });
            } else if (dismissedStudentIdSet.has(entry.studentId)) {
              await tx.student.updateMany({
                where: {
                  id: entry.studentId,
                  courseId,
                  status: { not: "مؤرشف" },
                },
                data: { baseOpportunities },
              });
            }
          }

          if (activeStudentIds.length) {
            academicRecalculation = await recalculateStudentsAcademicState(
              activeStudentIds,
              { tx },
            );
          }
          affectedStudents = opportunityStudents + baseOnlyStudents;
        } else {
          const resetUpdate = await tx.student.updateMany({
            where: { courseId, status: { not: "مؤرشف" } },
            data: { opportunities: 0, baseOpportunities: 0 },
          });
          affectedStudents = resetUpdate.count;
          opportunityStudents = resetUpdate.count;
        }
      }

      return {
        courseChapter,
        affectedStudents,
        opportunityStudents,
        baseOnlyStudents,
        skippedArchived,
        skippedDismissed,
        academicRecalculation,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return courseChapterMutationError(
      error,
      "تعذر تحديث رابط الفصل بالدورة حالياً.",
    );
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAnyPermission(req, [
    "chapters.delete",
    "courses.delete",
  ]);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return validationError("تعذر تحديد رابط الفصل بالدورة");
    const result = await withSerializableTransaction(async (tx) => {
      const link = await tx.courseChapter.findUnique({ where: { id } });
      if (!link) return { notFound: true } as const;
      if (link.active) return { active: true } as const;
      const archiveEntries = parseArchiveEntries(link.archive);
      const rawArchive = String(link.archive || "[]").trim();
      const archiveCount =
        archiveEntries.length || (rawArchive && rawArchive !== "[]" ? 1 : 0);
      if (archiveCount > 0) {
        return { archiveCount } as const;
      }
      await tx.courseChapter.delete({ where: { id } });
      return { deleted: true } as const;
    });
    if ('notFound' in result)
      return validationError("رابط الفصل غير موجود أو تم حذفه مسبقاً", 404);
    if ('active' in result)
      return validationError(
        "لا يمكن حذف ربط فصل مفعل. ألغِ التفعيل أولاً.",
        409,
      );
    if ('archiveCount' in result && typeof result.archiveCount === "number") {
      return validationError(
        `لا يمكن حذف هذا الربط لأنه يحتوي أرشيف فرص لـ ${result.archiveCount} طالب. راجع الأثر أولاً.`,
        409,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حذف رابط الفصل بالدورة حالياً.");
  }
}
