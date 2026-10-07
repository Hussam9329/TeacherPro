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

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, [
    "chapters.view",
    "courses.view",
    "grades.add",
    "grades.view",
    // Adding or editing a student shows the course's active chapter.
    "students.add",
    "students.edit",
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
    const courseError = requireText(body.courseId, "اسم الدورة");
    if (courseError) return validationError(courseError);
    const chapterError = requireText(body.chapterId, "الفصل");
    if (chapterError) return validationError(chapterError);
    const courseId = String(body.courseId);
    const chapterId = String(body.chapterId);
    const findExistingLink = () =>
      db.courseChapter.findFirst({
        where: { courseId, chapterId, archived: false },
        include: { course: true, chapter: true },
      });
    const existing = await findExistingLink();
    if (existing) {
      // Attaching again must not reactivate the chapter or reset its archive.
      return NextResponse.json({ courseChapter: existing, alreadyLinked: true });
    }

    try {
      const courseChapter = await db.courseChapter.create({
        data: {
          active: false,
          archived: false,
          archive: "[]",
          courseId,
          chapterId,
        },
        include: { course: true, chapter: true },
      });
      return NextResponse.json(
        { courseChapter, alreadyLinked: false },
        { status: 201 },
      );
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "P2002") {
        // Another request may have attached this exact pair after our read.
        // Keep the database uniqueness guard and return the committed link.
        const concurrentLink = await findExistingLink();
        if (concurrentLink) {
          return NextResponse.json({
            courseChapter: concurrentLink,
            alreadyLinked: true,
          });
        }
      }
      throw error;
    }
  } catch (error) {
    return courseChapterMutationError(error, "تعذر ربط الفصل بالدورة حالياً.");
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
