export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import {
  getAvailablePrograms,
  getAvailableStudyTypes,
  getCourseLocationConfig,
  getStudyTypesByProgram,
  type CourseLocationConfig,
  type StudyType,
} from "@/lib/course-config";
import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";

function dateOnly(value: Date | string | null | undefined): string {
  if (!value) return baghdadTodayKey();
  return baghdadDateKey(value) || baghdadTodayKey();
}

function normalizeCourse(course: Record<string, unknown>) {
  return {
    id: String(course.id),
    name: String(course.name || ""),
    active: course.active !== undefined ? Boolean(course.active) : true,
    createdAt: dateOnly(course.createdAt as Date | string | null | undefined),
    availablePrograms: getAvailablePrograms(course),
    availableStudyTypes: getAvailableStudyTypes(course),
    studyTypesByProgram: getStudyTypesByProgram(course),
    locationConfig: getCourseLocationConfig(course),
  };
}

function summarizeCourseConfigWarnings(input: {
  courseActive: boolean;
  activeChapterCount: number;
  activeChapterName: string | null;
  activeChapterOpportunities: number | null;
  locationConfig: CourseLocationConfig;
  studyTypes: string[];
}): string[] {
  const warnings: string[] = [];

  if (!input.courseActive) {
    warnings.push("الدورة موقوفة عن التسجيل ولا تظهر ضمن الاختيارات الجديدة.");
  }

  if (input.activeChapterCount === 0) {
    warnings.push("لا يوجد فصل نشط لهذه الدورة، سيتم تسجيل الطالب بفرص 0.");
  } else if (input.activeChapterCount > 1) {
    warnings.push(
      "توجد أكثر من علاقة فصل نشطة لهذه الدورة، يجب إصلاح الفصول قبل التسجيل.",
    );
  } else if ((input.activeChapterOpportunities ?? 0) <= 0) {
    warnings.push(
      "الفصل النشط لهذه الدورة فرصه 0، لذلك سيبدأ الطالب بدون فرص.",
    );
  } else if (input.activeChapterName) {
    warnings.push(
      `الفصل النشط: ${input.activeChapterName} — فرص البداية: ${input.activeChapterOpportunities}.`,
    );
  }

  for (const studyType of input.studyTypes) {
    const config = input.locationConfig[studyType as StudyType];
    if (
      !config ||
      !Array.isArray(config.scopes) ||
      config.scopes.length === 0
    ) {
      warnings.push(`نوع البرنامج "${studyType}" لا يحتوي إعداد مواقع مكتمل.`);
    }
  }

  return warnings;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.add");
  if (authError) return authError;

  try {
    const [courses, courseChapters, studentCounts] = await Promise.all([
      db.course.findMany({ orderBy: { createdAt: "desc" } }),
      db.courseChapter.findMany({
        where: { archived: false },
        include: {
          chapter: { select: { id: true, name: true, opportunities: true } },
        },
        orderBy: { id: "asc" },
      }),
      db.student.groupBy({
        by: ["courseId", "status"],
        _count: { _all: true },
      }),
    ]);

    const linksByCourseId = new Map<string, typeof courseChapters>();
    for (const link of courseChapters) {
      const bucket = linksByCourseId.get(link.courseId) || [];
      bucket.push(link);
      linksByCourseId.set(link.courseId, bucket);
    }

    const countsByCourseId = new Map<
      string,
      { total: number; active: number; dismissed: number; archived: number }
    >();
    for (const row of studentCounts) {
      const bucket = countsByCourseId.get(row.courseId) || {
        total: 0,
        active: 0,
        dismissed: 0,
        archived: 0,
      };
      const count = row._count._all;
      bucket.total += count;
      if (row.status === "نشط") bucket.active += count;
      else if (row.status === "مؤرشف") bucket.archived += count;
      else bucket.dismissed += count;
      countsByCourseId.set(row.courseId, bucket);
    }

    const rows = courses.map((course) => {
      const normalizedCourse = normalizeCourse(
        course as unknown as Record<string, unknown>,
      );
      const links = linksByCourseId.get(course.id) || [];
      const activeLinks = links.filter((link) => link.active);
      const activeChapter =
        activeLinks.length === 1
          ? {
              id: activeLinks[0].chapter.id,
              name: activeLinks[0].chapter.name,
              opportunities: Math.max(
                0,
                Math.trunc(Number(activeLinks[0].chapter.opportunities || 0)),
              ),
            }
          : null;
      const counts = countsByCourseId.get(course.id) || {
        total: 0,
        active: 0,
        dismissed: 0,
        archived: 0,
      };
      const warnings = summarizeCourseConfigWarnings({
        courseActive: normalizedCourse.active,
        activeChapterCount: activeLinks.length,
        activeChapterName: activeChapter?.name || null,
        activeChapterOpportunities: activeChapter?.opportunities ?? null,
        locationConfig: normalizedCourse.locationConfig,
        studyTypes: normalizedCourse.availableStudyTypes,
      });

      return {
        id: course.id,
        course: normalizedCourse,
        activeChapter,
        counts,
        activeChapterCount: activeLinks.length,
        canRegister: normalizedCourse.active && activeLinks.length <= 1,
        warnings,
      };
    });

    return NextResponse.json({
      rows,
      stats: {
        total: rows.length,
        active: rows.filter((row) => row.course.active).length,
        selectable: rows.filter((row) => row.canRegister).length,
        withoutActiveChapter: rows.filter((row) => row.activeChapterCount === 0)
          .length,
        withChapterConflict: rows.filter((row) => row.activeChapterCount > 1)
          .length,
      },
      source: "database",
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل سياق تسجيل الطالب حالياً.");
  }
}
