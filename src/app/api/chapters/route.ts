export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import {
  requireText,
  routeErrorResponse,
  validationError,
} from "@/lib/route-helpers";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { buildMutationPreviewToken } from "@/lib/mutation-preview-token";

class ChapterPreviewConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChapterPreviewConflictError";
  }
}

function validateChapterPayload(body: Record<string, unknown>) {
  const nameError = requireText(body.name, "اسم الفصل");
  if (nameError) return nameError;
  const opportunities = Number(body.opportunities ?? 0);
  if (
    !Number.isFinite(opportunities) ||
    opportunities < 0 ||
    !Number.isInteger(opportunities)
  ) {
    return "عدد الفرص يجب أن يكون رقماً صحيحاً لا يقل عن صفر";
  }
  return null;
}

async function buildOpportunityImpact(
  chapterId: string,
  nextOpportunities: number,
  client: typeof db | Prisma.TransactionClient = db,
  proposedName?: string,
) {
  const chapter = await client.chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, name: true, opportunities: true },
  });
  if (!chapter) return null;

  const activeLinks = await client.courseChapter.findMany({
    where: { chapterId, active: true, archived: false },
    select: {
      id: true,
      courseId: true,
      course: { select: { id: true, name: true } },
    },
  });
  const courseIds = Array.from(
    new Set(activeLinks.map((link) => link.courseId)),
  );
  const students = courseIds.length
    ? await client.student.findMany({
        where: { courseId: { in: courseIds } },
        select: {
          id: true,
          status: true,
          opportunities: true,
          baseOpportunities: true,
        },
      })
    : [];

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
    chapterId,
    chapterName: chapter.name,
    previousOpportunities: Math.max(
      0,
      Math.trunc(Number(chapter.opportunities || 0)),
    ),
    nextOpportunities,
    changed: Number(chapter.opportunities || 0) !== nextOpportunities,
    activeCourses: activeLinks.length,
    courseIds,
    courseNames: activeLinks.map((link) => link.course.name),
    affectedStudents: nonArchivedStudents.length,
    activeStudents: activeStudents.length,
    dismissedStudents: dismissedStudents.length,
    skippedArchived: archivedStudents.length,
    currentlyAboveNewCap: nonArchivedStudents.filter(
      (student) => Number(student.opportunities || 0) > nextOpportunities,
    ).length,
    baselinesToChange: nonArchivedStudents.filter(
      (student) => Number(student.baseOpportunities || 0) !== nextOpportunities,
    ).length,
    previewToken: buildMutationPreviewToken("chapter-opportunity-update", {
      proposed: {
        name: proposedName ?? chapter.name,
        opportunities: nextOpportunities,
      },
      chapter,
      activeLinks: activeLinks
        .map((link) => ({
          id: link.id,
          courseId: link.courseId,
          course: link.course,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      students: students
        .map((student) => ({
          id: student.id,
          status: student.status,
          opportunities: student.opportunities,
          baseOpportunities: student.baseOpportunities,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
    source: "database" as const,
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "chapters.view");
  if (authError) return authError;

  try {
    const { isPaginatedRequest, parsePagination } =
      await import("@/lib/pagination");
    if (isPaginatedRequest(req)) {
      const { page, limit, skip } = parsePagination(req);
      const [chapters, total] = await Promise.all([
        db.chapter.findMany({
          orderBy: { name: "asc" },
          include: { courseLinks: true },
          skip,
          take: limit,
        }),
        db.chapter.count(),
      ]);
      return NextResponse.json({
        chapters,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    }
    const chapters = await db.chapter.findMany({
      orderBy: { name: "asc" },
      include: { courseLinks: true },
    });
    return NextResponse.json({ chapters });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل الفصول حالياً.");
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "chapters.add");
  if (authError) return authError;

  try {
    const body = await req.json();
    const validationMessage = validateChapterPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const chapter = await db.chapter.create({
      data: {
        name: String(body.name ?? "").trim(),
        opportunities: Number(body.opportunities || 0),
      },
    });
    return NextResponse.json({ chapter }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ الفصل حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "chapters.edit");
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return validationError("تعذر تحديد الفصل المطلوب");

    const previewOnly = body.previewOnly === true;
    const syncStudentOpportunities = body.syncStudentOpportunities === true;
    const previewToken = String(body.previewToken || "").trim();
    const existing = await db.chapter.findUnique({
      where: { id: String(id) },
      select: { id: true, name: true, opportunities: true },
    });
    if (!existing) return validationError("الفصل غير موجود", 404);

    const data: { name?: string; opportunities?: number } = {};
    if (body.name !== undefined) {
      const nameError = requireText(body.name, "اسم الفصل");
      if (nameError) return validationError(nameError);
      data.name = String(body.name ?? "").trim();
    }
    if (body.opportunities !== undefined) {
      const opportunities = Number(body.opportunities);
      if (
        !Number.isFinite(opportunities) ||
        opportunities < 0 ||
        !Number.isInteger(opportunities)
      ) {
        return validationError(
          "عدد الفرص يجب أن يكون رقماً صحيحاً لا يقل عن صفر",
        );
      }
      data.opportunities = opportunities;
    }

    const nextOpportunities = data.opportunities ?? existing.opportunities;
    const didChangeOpportunities =
      Number(existing.opportunities || 0) !== nextOpportunities;
    const opportunityImpact = await buildOpportunityImpact(
      String(id),
      nextOpportunities,
      db,
      data.name ?? existing.name,
    );
    if (!opportunityImpact) return validationError("الفصل غير موجود", 404);

    if (previewOnly) {
      const freshPreview = await withSerializableTransaction((tx) =>
        buildOpportunityImpact(
          String(id),
          nextOpportunities,
          tx,
          data.name ?? existing.name,
        ),
      );
      if (!freshPreview) return validationError("الفصل غير موجود", 404);
      return NextResponse.json({
        preview: freshPreview,
        message:
          freshPreview.changed && freshPreview.affectedStudents > 0
            ? `سيتأثر ${freshPreview.affectedStudents} طالب في ${freshPreview.activeCourses} دورة مفعلة.`
            : "لا يوجد طلاب يحتاجون مزامنة بسبب هذا التعديل.",
      });
    }

    if (
      syncStudentOpportunities &&
      opportunityImpact.changed &&
      opportunityImpact.affectedStudents > 0
    ) {
      const rateLimitError = await checkApiRateLimit(
        req,
        API_RATE_LIMITS.studentOpportunitySync,
      );
      if (rateLimitError) return rateLimitError;
    }

    const result = await withSerializableTransaction(async (tx) => {
      const currentImpact = await buildOpportunityImpact(
        String(id),
        nextOpportunities,
        tx,
        data.name ?? existing.name,
      );
      if (!currentImpact) {
        throw new ChapterPreviewConflictError("الفصل غير موجود");
      }
      if (
        body.opportunities !== undefined &&
        (!previewToken || previewToken !== currentImpact.previewToken)
      ) {
        throw new ChapterPreviewConflictError(
          "تغير الفصل أو الطلاب المتأثرون بعد المعاينة. تم إيقاف الحفظ قبل أي تعديل؛ أعد المعاينة ثم أكد من جديد.",
        );
      }
      const chapter = await tx.chapter.update({
        where: { id: String(id) },
        data,
      });
      // Re-read active links and students after the chapter update inside the
      // same transaction. The execution never trusts the earlier UI preview.
      const freshImpact = await buildOpportunityImpact(
        String(id),
        chapter.opportunities,
        tx,
      );
      if (!freshImpact) {
        throw new Error("تعذر قراءة أثر الفصل بعد تحديثه");
      }

      let academicRecalculation: Awaited<
        ReturnType<typeof recalculateStudentsAcademicState>
      > | null = null;
      let syncedStudents = 0;

      if (
        syncStudentOpportunities &&
        didChangeOpportunities &&
        freshImpact.courseIds.length > 0
      ) {
        const students = await tx.student.findMany({
          where: {
            courseId: { in: freshImpact.courseIds },
            status: { not: "مؤرشف" },
          },
          select: { id: true },
        });
        syncedStudents = students.length;
        academicRecalculation = await recalculateStudentsAcademicState(
          students.map((student) => student.id),
          { tx },
        );
      }

      return {
        chapter,
        academicRecalculation,
        freshImpact: {
          ...freshImpact,
          previousOpportunities: Math.max(
            0,
            Math.trunc(Number(existing.opportunities || 0)),
          ),
          nextOpportunities: Math.max(
            0,
            Math.trunc(Number(chapter.opportunities || 0)),
          ),
          changed: didChangeOpportunities,
        },
        syncedStudents,
      };
    });

    return NextResponse.json({
      chapter: result.chapter,
      academicRecalculation: result.academicRecalculation,
      opportunityImpact: {
        ...result.freshImpact,
        syncedStudents: result.syncedStudents,
        autoSynced: Boolean(
          syncStudentOpportunities && result.freshImpact.changed,
        ),
        message: result.freshImpact.changed
          ? syncStudentOpportunities
            ? `تم تحديث الفصل وإعادة احتساب ${result.syncedStudents} طالب حسب السقف الجديد.`
            : `تم تحديث الفصل فقط. ${result.freshImpact.affectedStudents} طالب يحتفظون بأرصدتهم المحفوظة حتى تختار المزامنة.`
          : "لم يتغير عدد الفرص.",
      },
    });
  } catch (error) {
    if (error instanceof ChapterPreviewConflictError) {
      return validationError(error.message, 409);
    }
    return routeErrorResponse(error, "تعذر تحديث الفصل حالياً.");
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, "chapters.delete");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return validationError("تعذر تحديد الفصل المطلوب");
    const result = await withSerializableTransaction(async (tx) => {
      const [chapter, activeLinks, linkedCourseChapters, linkedOpportunityLogs] =
        await Promise.all([
          tx.chapter.findUnique({ where: { id }, select: { id: true } }),
          tx.courseChapter.count({ where: { chapterId: id, active: true } }),
          tx.courseChapter.count({ where: { chapterId: id } }),
          tx.opportunityLog.count({ where: { chapterId: id } }),
        ]);
      if (!chapter) return { notFound: true } as const;
      if (activeLinks > 0) return { activeLinks } as const;
      if (linkedCourseChapters > 0 || linkedOpportunityLogs > 0) {
        return { linkedCourseChapters, linkedOpportunityLogs } as const;
      }
      await tx.chapter.delete({ where: { id } });
      return { deleted: true } as const;
    });
    if ('notFound' in result)
      return validationError("الفصل غير موجود", 404);
    if ('activeLinks' in result)
      return validationError(
        "لا يمكن حذف فصل مفعل حالياً. ألغِ تفعيله أولاً.",
        409,
      );
    if ('linkedCourseChapters' in result) {
      return validationError(
        `لا يمكن حذف الفصل لأنه مرتبط بـ ${result.linkedCourseChapters} ربط دورة و ${result.linkedOpportunityLogs} سجل فرص. احذف الروابط أو راجع الأثر قبل الحذف.`,
        409,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حذف الفصل حالياً.");
  }
}
