export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { routeErrorResponse } from '@/lib/route-helpers';
import {
  getAvailablePrograms,
  getAvailableStudyTypes,
  getStudyTypesByProgram,
  getCourseLocationConfig,
  type CourseLocationConfig,
  type StudyType,
} from '@/lib/course-config';
import { ensureExamCourseLinksSchema, parseCourseIds } from '@/lib/exam-course-links';
import { baghdadDateKey, baghdadTodayKey } from '@/lib/baghdad-time';

function dateOnly(value: Date | string | null | undefined): string {
  if (!value) return baghdadTodayKey();
  return baghdadDateKey(value) || baghdadTodayKey();
}

function mapCountKey(map: Map<string, number>, key: string | null | undefined): void {
  const normalized = String(key || '').trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function mapToObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ar')));
}

function archivedBalanceCount(value: unknown): number {
  const source = String(value || '[]').trim();
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return source === '[]' ? 0 : 1;
    return parsed.length;
  } catch {
    return source && source !== '[]' ? 1 : 0;
  }
}

function normalizeCourse(course: Record<string, unknown>) {
  return {
    id: String(course.id),
    name: String(course.name || ''),
    active: course.active !== undefined ? Boolean(course.active) : true,
    createdAt: dateOnly(course.createdAt as Date | string | null | undefined),
    availablePrograms: getAvailablePrograms(course),
    availableStudyTypes: getAvailableStudyTypes(course),
    studyTypesByProgram: getStudyTypesByProgram(course),
    locationConfig: getCourseLocationConfig(course),
  };
}

function summarizeCourseWarnings(input: {
  active: boolean;
  studentCount: number;
  examCount: number;
  activeChapterName: string | null;
  locationConfig: CourseLocationConfig;
  studyTypes: string[];
}): string[] {
  const warnings: string[] = [];
  if (!input.active && (input.studentCount > 0 || input.examCount > 0)) {
    warnings.push('الدورة موقوفة عن الاختيارات الجديدة، لكنها ما زالت مرتبطة ببيانات حالية.');
  }
  if (!input.activeChapterName) {
    warnings.push('لا يوجد فصل نشط مرتبط بهذه الدورة حالياً.');
  }
  for (const studyType of input.studyTypes) {
    const config = input.locationConfig[studyType as StudyType];
    if (!config || !Array.isArray(config.scopes) || config.scopes.length === 0) {
      warnings.push(`نوع البرنامج "${studyType}" لا يحتوي إعداد مواقع مكتمل.`);
    }
  }
  return warnings;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'courses.view');
  if (authError) return authError;

  try {
    await ensureExamCourseLinksSchema();

    const [courses, students, exams, courseChapters] = await Promise.all([
      db.course.findMany({ orderBy: { createdAt: 'desc' } }),
      db.student.findMany({
        select: {
          id: true,
          status: true,
          courseId: true,
          courseProgram: true,
          studyType: true,
          locationScope: true,
          baghdadMode: true,
          subSite: true,
        },
      }),
      db.exam.findMany({
        select: {
          id: true,
          name: true,
          active: true,
          courseIds: true,
          examCourses: { select: { courseId: true } },
        },
      }),
      db.courseChapter.findMany({
        include: { chapter: { select: { id: true, name: true, opportunities: true } } },
      }),
    ]);

    const studentStatsByCourse = new Map<string, {
      total: number;
      active: number;
      dismissed: number;
      archived: number;
      programs: Map<string, number>;
      studyTypes: Map<string, number>;
      locations: Map<string, number>;
    }>();

    for (const student of students) {
      const bucket = studentStatsByCourse.get(student.courseId) || {
        total: 0,
        active: 0,
        dismissed: 0,
        archived: 0,
        programs: new Map<string, number>(),
        studyTypes: new Map<string, number>(),
        locations: new Map<string, number>(),
      };
      bucket.total += 1;
      if (student.status === 'نشط') bucket.active += 1;
      else if (student.status === 'مؤرشف') bucket.archived += 1;
      else bucket.dismissed += 1;
      mapCountKey(bucket.programs, student.courseProgram);
      mapCountKey(bucket.studyTypes, student.studyType);
      const locationParts = [student.locationScope, student.baghdadMode, student.subSite]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      mapCountKey(bucket.locations, locationParts.join(' / '));
      studentStatsByCourse.set(student.courseId, bucket);
    }

    const examStatsByCourse = new Map<string, { total: number; active: number; inactive: number; sampleNames: string[] }>();
    for (const exam of exams) {
      const linkedCourseIds = new Set<string>([
        ...parseCourseIds(exam.courseIds),
        ...exam.examCourses.map((link) => link.courseId),
      ]);
      for (const courseId of linkedCourseIds) {
        const bucket = examStatsByCourse.get(courseId) || { total: 0, active: 0, inactive: 0, sampleNames: [] };
        bucket.total += 1;
        if (exam.active) bucket.active += 1;
        else bucket.inactive += 1;
        if (bucket.sampleNames.length < 3) bucket.sampleNames.push(exam.name);
        examStatsByCourse.set(courseId, bucket);
      }
    }

    const chapterStatsByCourse = new Map<string, {
      total: number;
      active: number;
      archived: number;
      archivedBalances: number;
      activeChapter: { id: string; name: string; opportunities: number } | null;
    }>();
    for (const link of courseChapters) {
      const bucket = chapterStatsByCourse.get(link.courseId) || {
        total: 0,
        active: 0,
        archived: 0,
        archivedBalances: 0,
        activeChapter: null,
      };
      bucket.total += 1;
      if (link.active) {
        bucket.active += 1;
        bucket.activeChapter = {
          id: link.chapter.id,
          name: link.chapter.name,
          opportunities: link.chapter.opportunities,
        };
      }
      if (link.archived) bucket.archived += 1;
      bucket.archivedBalances += archivedBalanceCount(link.archive);
      chapterStatsByCourse.set(link.courseId, bucket);
    }

    const rows = courses.map((course) => {
      const normalizedCourse = normalizeCourse(course as unknown as Record<string, unknown>);
      const studentStats = studentStatsByCourse.get(course.id) || {
        total: 0,
        active: 0,
        dismissed: 0,
        archived: 0,
        programs: new Map<string, number>(),
        studyTypes: new Map<string, number>(),
        locations: new Map<string, number>(),
      };
      const examStats = examStatsByCourse.get(course.id) || { total: 0, active: 0, inactive: 0, sampleNames: [] };
      const chapterStats = chapterStatsByCourse.get(course.id) || {
        total: 0,
        active: 0,
        archived: 0,
        archivedBalances: 0,
        activeChapter: null,
      };
      const deleteBlockers: string[] = [];
      if (studentStats.total > 0) deleteBlockers.push(`${studentStats.total} طالب مرتبط`);
      if (examStats.total > 0) deleteBlockers.push(`${examStats.total} امتحان مرتبط`);
      if (chapterStats.archivedBalances > 0) {
        deleteBlockers.push(`${chapterStats.archivedBalances} رصيد طالب مؤرشف`);
      }
      const configWarnings = summarizeCourseWarnings({
        active: normalizedCourse.active,
        studentCount: studentStats.total,
        examCount: examStats.total,
        activeChapterName: chapterStats.activeChapter?.name || null,
        locationConfig: normalizedCourse.locationConfig,
        studyTypes: normalizedCourse.availableStudyTypes,
      });

      return {
        id: course.id,
        course: normalizedCourse,
        counts: {
          students: studentStats.total,
          activeStudents: studentStats.active,
          dismissedStudents: studentStats.dismissed,
          archivedStudents: studentStats.archived,
          exams: examStats.total,
          activeExams: examStats.active,
          inactiveExams: examStats.inactive,
          courseChapters: chapterStats.total,
          activeChapters: chapterStats.active,
          archivedCourseChapters: chapterStats.archived,
        },
        usage: {
          programs: mapToObject(studentStats.programs),
          studyTypes: mapToObject(studentStats.studyTypes),
          locations: mapToObject(studentStats.locations),
        },
        activeChapter: chapterStats.activeChapter,
        deleteSafety: {
          canDelete: deleteBlockers.length === 0,
          blockers: deleteBlockers,
          recommendedAction: deleteBlockers.length === 0
            ? 'يمكن حذف هذه الدورة لأنها غير مرتبطة بطلاب أو امتحانات.'
            : 'التعطيل هو الإجراء الآمن. الحذف مرفوض حتى لا تضيع علاقات النظام.',
        },
        configWarnings,
        examSamples: examStats.sampleNames,
      };
    });

    return NextResponse.json({
      rows,
      total: rows.length,
      stats: {
        total: rows.length,
        active: rows.filter((row) => row.course.active).length,
        inactive: rows.filter((row) => !row.course.active).length,
        withStudents: rows.filter((row) => row.counts.students > 0).length,
        deletable: rows.filter((row) => row.deleteSafety.canDelete).length,
      },
      source: 'database',
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل ملخص الدورات حالياً.');
  }
}
