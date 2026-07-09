export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeExamSiteValue } from "@/lib/exam-utils";

function increment(map: Record<string, number>, key: string) {
  const normalized = normalizeExamSiteValue(key);
  if (!normalized) return;
  map[normalized] = (map[normalized] || 0) + 1;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "exams.add");
  if (authError) return authError;

  const courses = await db.course.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      active: true,
      availablePrograms: true,
      availableStudyTypes: true,
      studyTypesByProgram: true,
      locationConfig: true,
      createdAt: true,
    },
  });

  const courseIds = courses.map((course) => course.id);
  const [activeLinks, activeStudents] = await db.$transaction([
    db.courseChapter.findMany({
      where: { courseId: { in: courseIds }, active: true, archived: false },
      select: {
        courseId: true,
        chapter: { select: { id: true, name: true, opportunities: true } },
      },
    }),
    db.student.findMany({
      where: { courseId: { in: courseIds }, status: "نشط" },
      select: {
        courseId: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
      },
    }),
  ]);

  const linksByCourseId = new Map<string, typeof activeLinks>();
  for (const link of activeLinks) {
    const list = linksByCourseId.get(link.courseId) || [];
    list.push(link);
    linksByCourseId.set(link.courseId, list);
  }

  const studentStatsByCourseId = new Map<string, { activeStudents: number; siteCounts: Record<string, number> }>();
  for (const student of activeStudents) {
    const current = studentStatsByCourseId.get(student.courseId) || {
      activeStudents: 0,
      siteCounts: {},
    };
    current.activeStudents += 1;
    const seen = new Set<string>();
    [student.mainSite, student.subSite, student.locationScope].forEach((value) => {
      const normalized = normalizeExamSiteValue(value);
      if (normalized) seen.add(normalized);
    });
    for (const site of seen) increment(current.siteCounts, site);
    studentStatsByCourseId.set(student.courseId, current);
  }

  const rows = courses.map((course) => {
    const links = linksByCourseId.get(course.id) || [];
    const stats = studentStatsByCourseId.get(course.id) || {
      activeStudents: 0,
      siteCounts: {},
    };
    const blockers: string[] = [];
    if (!course.active) blockers.push("الدورة موقوفة عن التسجيل والاختيارات الجديدة");
    if (links.length === 0) blockers.push("لا يوجد فصل نشط لهذه الدورة");
    if (links.length > 1) blockers.push(`تعارض: يوجد ${links.length} فصول نشطة لهذه الدورة`);

    return {
      id: course.id,
      course,
      activeChapterCount: links.length,
      activeChapter: links.length === 1
        ? {
            id: links[0].chapter.id,
            name: links[0].chapter.name,
            opportunities: Number(links[0].chapter.opportunities || 0),
          }
        : null,
      activeStudents: stats.activeStudents,
      siteCounts: stats.siteCounts,
      canSelectForExam: course.active && links.length === 1,
      blockers,
    };
  });

  return NextResponse.json({
    source: "database",
    rows,
    stats: {
      totalCourses: rows.length,
      selectableCourses: rows.filter((row) => row.canSelectForExam).length,
      blockedCourses: rows.filter((row) => !row.canSelectForExam).length,
      activeStudents: rows.reduce((sum, row) => sum + Number(row.activeStudents || 0), 0),
    },
  });
}
