export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { routeErrorResponse } from '@/lib/route-helpers';

type ArchiveEntry = { studentId: string; opportunities: number; date?: string };
type CourseRecord = { id: string; name: string; active: boolean };
type ChapterRecord = { id: string; name: string; opportunities: number };
type StudentRecord = { id: string; name: string; code: string; status: string; courseId: string; opportunities: number; baseOpportunities: number };
type CourseChapterRecord = {
  id: string;
  courseId: string;
  chapterId: string;
  active: boolean;
  archived: boolean;
  archive: string;
  course: CourseRecord;
  chapter: ChapterRecord;
};
type OpportunityLogRecord = { id: string; chapterId: string | null; chapterNameSnapshot: string | null; studentId: string };


function parseArchiveEntries(value: unknown): ArchiveEntry[] {
  const source = typeof value === 'string' ? value : JSON.stringify(value ?? []);
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        studentId: String((entry as { studentId?: unknown }).studentId || '').trim(),
        opportunities: Number((entry as { opportunities?: unknown }).opportunities || 0),
        date: (entry as { date?: unknown }).date ? String((entry as { date?: unknown }).date) : undefined,
      }))
      .filter((entry) => entry.studentId);
  } catch {
    return [];
  }
}

function countBy<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['chapters.view', 'courses.view', 'students.view']);
  if (authError) return authError;

  try {
    const [courses, chapters, courseChapters, students, opportunityLogs] = await Promise.all([
      db.course.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, active: true } }),
      db.chapter.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, opportunities: true } }),
      db.courseChapter.findMany({
        orderBy: [{ courseId: 'asc' }, { active: 'desc' }],
        include: {
          course: { select: { id: true, name: true, active: true } },
          chapter: { select: { id: true, name: true, opportunities: true } },
        },
      }),
      db.student.findMany({
        select: { id: true, name: true, code: true, status: true, courseId: true, opportunities: true, baseOpportunities: true },
      }),
      db.opportunityLog.findMany({ select: { id: true, chapterId: true, chapterNameSnapshot: true, studentId: true } }),
    ]);

    const typedCourses = courses as CourseRecord[];
    const typedChapters = chapters as ChapterRecord[];
    const typedCourseChapters = courseChapters as CourseChapterRecord[];
    const typedStudents = students as StudentRecord[];
    const typedOpportunityLogs = opportunityLogs as OpportunityLogRecord[];

    const studentsByCourse = new Map<string, StudentRecord[]>();
    for (const student of typedStudents) {
      const bucket = studentsByCourse.get(student.courseId) || [];
      bucket.push(student);
      studentsByCourse.set(student.courseId, bucket);
    }

    const linksByCourse = new Map<string, CourseChapterRecord[]>();
    const linksByChapter = new Map<string, CourseChapterRecord[]>();
    for (const link of typedCourseChapters) {
      const courseBucket = linksByCourse.get(link.courseId) || [];
      courseBucket.push(link);
      linksByCourse.set(link.courseId, courseBucket);
      const chapterBucket = linksByChapter.get(link.chapterId) || [];
      chapterBucket.push(link);
      linksByChapter.set(link.chapterId, chapterBucket);
    }

    const logsByChapter = new Map<string, number>();
    for (const log of typedOpportunityLogs) {
      if (!log.chapterId) continue;
      logsByChapter.set(log.chapterId, (logsByChapter.get(log.chapterId) || 0) + 1);
    }

    const courseRows = typedCourses.map((course) => {
      const courseStudents = studentsByCourse.get(course.id) || [];
      const links = (linksByCourse.get(course.id) || []).map((link) => {
        const archiveEntries = parseArchiveEntries(link.archive);
        return {
          id: link.id,
          courseId: link.courseId,
          chapterId: link.chapterId,
          active: Boolean(link.active),
          archived: Boolean(link.archived),
          archiveCount: archiveEntries.length,
          chapter: {
            id: link.chapter.id,
            name: link.chapter.name,
            opportunities: Number(link.chapter.opportunities || 0),
          },
          deleteSafety: {
            canDelete: !link.active && archiveEntries.length === 0,
            blockers: [
              ...(link.active ? ['الربط مفعل حالياً'] : []),
              ...(archiveEntries.length > 0 ? [`يحتوي أرشيف فرص لـ ${archiveEntries.length} طالب`] : []),
            ],
          },
        };
      });
      const activeLinks = links.filter((link) => link.active && !link.archived);
      const activeLink = activeLinks[0] || null;
      const activeOpportunities = Number(activeLink?.chapter.opportunities || 0);
      const nonArchivedStudents = courseStudents.filter((student) => student.status !== 'مؤرشف');
      const activeStudents = courseStudents.filter((student) => student.status === 'نشط');
      const dismissedStudents = courseStudents.filter((student) => student.status === 'مفصول');
      const zeroZeroWithActive = activeLink
        ? activeStudents.filter((student) => Number(student.opportunities || 0) === 0 && Number(student.baseOpportunities || 0) === 0)
        : [];
      const aboveCap = activeLink && activeOpportunities > 0
        ? activeStudents.filter((student) => Number(student.opportunities || 0) > activeOpportunities || Number(student.baseOpportunities || 0) > activeOpportunities)
        : [];
      const nonZeroWithoutActive = !activeLink
        ? activeStudents.filter((student) => Number(student.opportunities || 0) > 0 || Number(student.baseOpportunities || 0) > 0)
        : [];
      const warnings = dedupe([
        ...(activeLinks.length === 0 ? ['لا يوجد فصل نشط لهذه الدورة'] : []),
        ...(activeLinks.length > 1 ? [`يوجد ${activeLinks.length} فصول نشطة لنفس الدورة`] : []),
        ...(activeLink && activeOpportunities <= 0 ? ['الفصل النشط فرصه صفر'] : []),
        ...(zeroZeroWithActive.length > 0 ? [`${zeroZeroWithActive.length} طالب نشط فرصهم 0/0 رغم وجود فصل نشط`] : []),
        ...(aboveCap.length > 0 ? [`${aboveCap.length} طالب فرصهم أعلى من سقف الفصل النشط`] : []),
        ...(nonZeroWithoutActive.length > 0 ? [`${nonZeroWithoutActive.length} طالب لديهم فرص رغم عدم وجود فصل نشط`] : []),
      ]);
      return {
        id: course.id,
        course: { id: course.id, name: course.name, active: Boolean(course.active) },
        counts: {
          students: courseStudents.length,
          activeStudents: activeStudents.length,
          dismissedStudents: dismissedStudents.length,
          archivedStudents: countBy(courseStudents, (student) => student.status === 'مؤرشف'),
          nonArchivedStudents: nonArchivedStudents.length,
          linkedChapters: links.length,
          activeLinks: activeLinks.length,
          zeroZeroWithActive: zeroZeroWithActive.length,
          aboveCap: aboveCap.length,
          nonZeroWithoutActive: nonZeroWithoutActive.length,
        },
        activeLink,
        links,
        warnings,
        health: {
          needsRepair: warnings.length > 0,
          canSafelyActivate: activeStudents.length === 0 || zeroZeroWithActive.length === activeStudents.length || activeLinks.length <= 1,
        },
      };
    });

    const chapterRows = typedChapters.map((chapter) => {
      const links = linksByChapter.get(chapter.id) || [];
      const activeLinkCount = countBy(links, (link) => Boolean(link.active));
      const archivedLinkCount = countBy(links, (link) => Boolean(link.archived));
      const archiveEntryCount = links.reduce((sum, link) => sum + parseArchiveEntries(link.archive).length, 0);
      const opportunityLogCount = logsByChapter.get(chapter.id) || 0;
      const blockers = [
        ...(activeLinkCount > 0 ? [`مفعل في ${activeLinkCount} دورة`] : []),
        ...(links.length > 0 ? [`مرتبط بـ ${links.length} دورة`] : []),
        ...(opportunityLogCount > 0 ? [`عليه ${opportunityLogCount} سجل فرص`] : []),
        ...(archiveEntryCount > 0 ? [`يحمل أرشيف فرص لـ ${archiveEntryCount} طالب`] : []),
      ];
      return {
        id: chapter.id,
        chapter: { id: chapter.id, name: chapter.name, opportunities: Number(chapter.opportunities || 0) },
        counts: {
          linkedCourses: links.length,
          activeLinks: activeLinkCount,
          archivedLinks: archivedLinkCount,
          archiveEntries: archiveEntryCount,
          opportunityLogs: opportunityLogCount,
        },
        deleteSafety: {
          canDelete: blockers.length === 0,
          blockers,
          recommendedAction: blockers.length === 0
            ? 'يمكن حذف هذا الفصل لأنه غير مستخدم ولا يحمل أثراً تاريخياً.'
            : 'الأفضل إبقاء الفصل كأثر تاريخي أو حذف الروابط/السجلات المرتبطة أولاً.',
        },
      };
    });

    const stats = {
      courses: courseRows.length,
      chapters: chapterRows.length,
      links: typedCourseChapters.length,
      coursesWithoutActiveChapter: courseRows.filter((row) => row.counts.activeLinks === 0).length,
      coursesWithMultipleActiveChapters: courseRows.filter((row) => row.counts.activeLinks > 1).length,
      studentsZeroZeroWithActive: courseRows.reduce((sum, row) => sum + row.counts.zeroZeroWithActive, 0),
      studentsAboveChapterCap: courseRows.reduce((sum, row) => sum + row.counts.aboveCap, 0),
      deletableChapters: chapterRows.filter((row) => row.deleteSafety.canDelete).length,
    };

    return NextResponse.json({
      source: 'database',
      generatedAt: new Date().toISOString(),
      stats,
      courseRows,
      chapterRows,
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل ملخص الفصول والفرص حالياً.');
  }
}
