export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { validationError, routeErrorResponse } from "@/lib/route-helpers";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";

type ArchiveEntry = { studentId: string; opportunities: number; date: string };

class CourseChapterActionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseChapterActionIntegrityError";
  }
}

function actionErrorResponse(error: unknown) {
  if (error instanceof CourseChapterActionIntegrityError) {
    return validationError(error.message, 409);
  }
  const prismaError = error as { code?: string };
  if (prismaError?.code === "P2002") {
    return validationError(
      "تعذر تنفيذ الإجراء لأن حالة الفصل تغيرت بالتزامن مع طلب آخر. تم منع إنشاء أكثر من فصل نشط؛ حدّث الصفحة ثم أعد المحاولة.",
      409,
    );
  }
  return routeErrorResponse(error, "تعذر تنفيذ إجراء الفصل والفرص حالياً.");
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
        opportunities: Math.max(
          0,
          Math.trunc(
            Number((entry as { opportunities?: unknown }).opportunities || 0),
          ),
        ),
        date: String((entry as { date?: unknown }).date || todayISO()),
      }))
      .filter((entry) => entry.studentId);
  } catch {
    return [];
  }
}

function buildArchive(
  students: Array<{ id: string; opportunities: number }>,
): string {
  const entries: ArchiveEntry[] = students.map((student) => ({
    studentId: student.id,
    opportunities: Math.max(0, Math.trunc(Number(student.opportunities || 0))),
    date: todayISO(),
  }));
  return JSON.stringify(entries);
}

async function buildActionPreview(
  courseChapterId: string,
  action: "activate" | "deactivate",
) {
  const target = await db.courseChapter.findUnique({
    where: { id: courseChapterId },
    include: { chapter: true, course: true },
  });
  if (!target) return null;

  const [students, otherActiveLinks] = await Promise.all([
    db.student.findMany({
      where: { courseId: target.courseId },
      select: { status: true, opportunities: true },
    }),
    db.courseChapter.count({
      where: {
        courseId: target.courseId,
        id: { not: target.id },
        active: true,
        archived: false,
      },
    }),
  ]);
  const activeStudents = students.filter((student) => student.status === "نشط");
  const dismissedStudents = students.filter(
    (student) => student.status === "مفصول",
  );
  const archivedStudents = students.filter(
    (student) => student.status === "مؤرشف",
  );
  const nonArchivedStudents = students.filter(
    (student) => student.status !== "مؤرشف",
  );

  return {
    action,
    courseChapterId: target.id,
    course: { id: target.course.id, name: target.course.name },
    chapter: {
      id: target.chapter.id,
      name: target.chapter.name,
      opportunities: Math.max(
        0,
        Math.trunc(Number(target.chapter.opportunities || 0)),
      ),
    },
    currentActive: target.active && !target.archived,
    impact: {
      activeStudents: activeStudents.length,
      dismissedStudents: dismissedStudents.length,
      archivedStudents: archivedStudents.length,
      affectedStudents: nonArchivedStudents.length,
      balancesThatWillBeZeroed:
        action === "deactivate"
          ? nonArchivedStudents.filter(
              (student) => Number(student.opportunities || 0) !== 0,
            ).length
          : 0,
      archiveEntries:
        action === "deactivate"
          ? nonArchivedStudents.length
          : parseArchiveEntries(target.archive).length,
      otherActiveLinksToDisable: action === "activate" ? otherActiveLinks : 0,
    },
    canExecute:
      action === "deactivate"
        ? target.active && !target.archived && otherActiveLinks === 0
        : true,
    blockingMessage:
      action === "deactivate" && (!target.active || target.archived)
        ? "هذا الربط غير مفعل حالياً، لذلك لن يسمح النظام بتصفير فرص الطلاب من خلاله."
        : action === "deactivate" && otherActiveLinks > 0
          ? "توجد حالة تعارض قديمة: ما زال فصل نشط آخر مرتبطاً بالدورة. أصلح التعارض أولاً حتى لا تُصفّر الفرص بينما يوجد فصل نشط."
          : null,
    message:
      action === "deactivate"
        ? `سيتم أرشفة رصيد ${nonArchivedStudents.length} طالب ثم تصفير فرصهم لأن الدورة ستصبح بلا فصل نشط.`
        : `سيتم تفعيل الفصل وتحديث ${nonArchivedStudents.length} طالب من بيانات الفصل الحقيقية.`,
    source: "database" as const,
  };
}

export async function POST(req: NextRequest) {
  const authError = await requireAnyPermission(req, [
    "chapters.edit",
    "courses.edit",
  ]);
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(
    req,
    API_RATE_LIMITS.studentOpportunitySync,
  );
  if (rateLimitError) return rateLimitError;

  try {
    const body = await req.json().catch(() => ({}));
    const courseChapterId = String(body.courseChapterId || "").trim();
    const action = String(body.action || "").trim();
    const confirmImpact = body.confirmImpact === true;
    const previewOnly = body.previewOnly === true;
    if (!courseChapterId)
      return validationError("تعذر تحديد ربط الفصل بالدورة");
    if (action !== "activate" && action !== "deactivate")
      return validationError("نوع إجراء الفصل غير معروف");

    if (previewOnly) {
      const preview = await buildActionPreview(
        courseChapterId,
        action as "activate" | "deactivate",
      );
      if (!preview)
        return validationError("رابط الفصل غير موجود أو تم حذفه مسبقاً", 404);
      return NextResponse.json({ preview });
    }

    if (!confirmImpact)
      return validationError("يجب تأكيد أثر العملية قبل تنفيذها", 409);

    const result = await withSerializableTransaction(async (tx) => {
      const target = await tx.courseChapter.findUnique({
        where: { id: courseChapterId },
        include: { chapter: true, course: true },
      });
      if (!target) {
        throw new CourseChapterActionIntegrityError(
          "رابط الفصل غير موجود أو تم حذفه مسبقاً",
        );
      }

      if (action === "deactivate") {
        if (!target.active || target.archived) {
          throw new CourseChapterActionIntegrityError(
            "لا يمكن إلغاء تفعيل هذا الربط لأنه غير مفعل حالياً. تم منع تصفير فرص الطلاب بلا فصل نشط حقيقي.",
          );
        }
        const otherActiveLinks = await tx.courseChapter.count({
          where: {
            courseId: target.courseId,
            id: { not: target.id },
            active: true,
            archived: false,
          },
        });
        if (otherActiveLinks > 0) {
          throw new CourseChapterActionIntegrityError(
            "توجد حالة تعارض قديمة بأكثر من فصل نشط لهذه الدورة. لم يتم تصفير أي رصيد؛ أصلح التعارض أولاً.",
          );
        }
      }

      const courseStudents = await tx.student.findMany({
        where: { courseId: target.courseId },
        select: {
          id: true,
          status: true,
          opportunities: true,
          baseOpportunities: true,
        },
      });
      const nonArchivedStudents = courseStudents.filter(
        (student) => student.status !== "مؤرشف",
      );
      const activeStudents = nonArchivedStudents.filter(
        (student) => student.status !== "مفصول",
      );
      const dismissedStudents = nonArchivedStudents.filter(
        (student) => student.status === "مفصول",
      );
      const activeStudentIds = activeStudents.map((student) => student.id);
      const dismissedStudentIds = dismissedStudents.map(
        (student) => student.id,
      );
      const baseOpportunities = Math.max(
        0,
        Math.trunc(Number(target.chapter.opportunities || 0)),
      );
      let academicRecalculation: Awaited<
        ReturnType<typeof recalculateStudentsAcademicState>
      > | null = null;

      if (action === "activate") {
        const activeLinks = await tx.courseChapter.findMany({
          where: { courseId: target.courseId, active: true, archived: false },
          select: { id: true },
        });
        const activeLinkIds = activeLinks
          .map((link) => link.id)
          .filter((id) => id !== target.id);
        if (activeLinkIds.length) {
          await tx.courseChapter.updateMany({
            where: { id: { in: activeLinkIds } },
            data: { active: false, archive: buildArchive(nonArchivedStudents) },
          });
        }

        const restoredArchive = new Map(
          parseArchiveEntries(target.archive).map((entry) => [
            entry.studentId,
            entry.opportunities,
          ]),
        );
        await tx.courseChapter.update({
          where: { id: target.id },
          data: { active: true, archived: false },
        });

        for (const student of activeStudents) {
          await tx.student.update({
            where: { id: student.id },
            data: {
              opportunities: restoredArchive.has(student.id)
                ? Math.min(
                    Number(restoredArchive.get(student.id)),
                    baseOpportunities,
                  )
                : baseOpportunities,
              baseOpportunities,
            },
          });
        }
        if (dismissedStudentIds.length) {
          await tx.student.updateMany({
            where: {
              id: { in: dismissedStudentIds },
              courseId: target.courseId,
              status: { not: "مؤرشف" },
            },
            data: { baseOpportunities },
          });
        }
        if (activeStudentIds.length) {
          academicRecalculation = await recalculateStudentsAcademicState(
            activeStudentIds,
            { tx },
          );
        }

        return {
          ok: true,
          action,
          courseChapter: {
            id: target.id,
            courseId: target.courseId,
            chapterId: target.chapterId,
            active: true,
          },
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
        data: { active: false, archive: buildArchive(nonArchivedStudents) },
      });
      const resetUpdate = await tx.student.updateMany({
        where: { courseId: target.courseId, status: { not: "مؤرشف" } },
        data: { opportunities: 0, baseOpportunities: 0 },
      });
      if (activeStudentIds.length) {
        academicRecalculation = await recalculateStudentsAcademicState(
          activeStudentIds,
          { tx },
        );
      }

      return {
        ok: true,
        action,
        courseChapter: {
          id: target.id,
          courseId: target.courseId,
          chapterId: target.chapterId,
          active: false,
        },
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
    return actionErrorResponse(error);
  }
}
