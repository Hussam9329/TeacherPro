export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import {
  parseJsonArray,
  parseJsonRecord,
  stringifyJson,
  getAvailablePrograms,
  getAvailableStudyTypes,
  getAvailableStudyTypesForProgram,
  getCourseLocationConfig,
  type CourseLocationConfig,
  type StudyTypesByProgram,
  type StudyType,
  COURSE_PROGRAMS,
  STUDY_TYPES,
  LOCATION_SCOPES,
  BAGHDAD_MODES,
  OUT_OF_COUNTRY_LOCATION_SCOPE,
} from '@/lib/course-config';
import { IRAQI_PROVINCES, normalizeIraqiProvinceName } from '@/lib/iraq';
import { ensureExamCourseLinksSchema, parseCourseIds } from '@/lib/exam-course-links';

function formatLinkedStudentCount(count: number): string {
  return `${count} طالب`;
}

type CourseLinkedStudent = {
  courseProgram: string | null;
  courseTerm: string | null;
  studyType: string | null;
  locationScope: string | null;
  baghdadMode: string | null;
  subSite: string | null;
};

function countByUsageKey(students: CourseLinkedStudent[], getKey: (student: CourseLinkedStudent) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const student of students) {
    const key = getKey(student);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function firstUsageBlockMessage(
  courseName: string,
  draftCourse: Record<string, unknown>,
  linkedStudents: CourseLinkedStudent[],
): string | null {
  const newPrograms = getAvailablePrograms(draftCourse);
  const newLocationConfig = getCourseLocationConfig(draftCourse);

  const removedProgramCounts = countByUsageKey(linkedStudents, (student) =>
    student.courseProgram && !(newPrograms as readonly string[]).includes(student.courseProgram)
      ? student.courseProgram
      : ''
  );
  const firstRemovedProgram = Array.from(removedProgramCounts.entries())[0];
  if (firstRemovedProgram) {
    const [program, count] = firstRemovedProgram;
    return `لا يمكن حذف نوع الدورة "${program}" لأن ${formatLinkedStudentCount(count)} مرتبطين به في دورة "${courseName}". انقل الطلاب أو غيّر نوعهم أولاً.`;
  }

  const removedStudyTypeCounts = countByUsageKey(linkedStudents, (student) => {
    if (!student.courseProgram || !student.studyType) return '';
    const newStudyTypesForProgram = getAvailableStudyTypesForProgram(draftCourse, student.courseProgram);
    return (newStudyTypesForProgram as readonly string[]).includes(student.studyType)
      ? ''
      : `${student.courseProgram}|||${student.studyType}`;
  });
  const firstRemovedStudyType = Array.from(removedStudyTypeCounts.entries())[0];
  if (firstRemovedStudyType) {
    const [key, count] = firstRemovedStudyType;
    const [program, studyType] = key.split('|||');
    return `لا يمكن حذف نوع البرنامج "${studyType}" من نوع الدورة "${program}" لأن ${formatLinkedStudentCount(count)} مرتبطين به في دورة "${courseName}". انقل الطلاب أو غيّر نوع دراستهم أولاً.`;
  }

  const removedScopeCounts = countByUsageKey(linkedStudents, (student) => {
    if (!student.studyType || !student.locationScope || student.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE) return '';
    const studyConfig = newLocationConfig[student.studyType as StudyType];
    return (studyConfig?.scopes as readonly string[] | undefined)?.includes(student.locationScope)
      ? ''
      : `${student.studyType}|||${student.locationScope}`;
  });
  const firstRemovedScope = Array.from(removedScopeCounts.entries())[0];
  if (firstRemovedScope) {
    const [key, count] = firstRemovedScope;
    const [studyType, scope] = key.split('|||');
    return `لا يمكن حذف الموقع "${scope}" من نوع البرنامج "${studyType}" لأن ${formatLinkedStudentCount(count)} مرتبطين به في دورة "${courseName}". انقل الطلاب أو غيّر مواقعهم أولاً.`;
  }

  const removedBaghdadSiteCounts = countByUsageKey(linkedStudents, (student) => {
    if (student.locationScope !== 'بغداد' || !student.studyType || !student.subSite) return '';
    const studyConfig = newLocationConfig[student.studyType as StudyType];
    if (studyConfig?.baghdadMode !== 'بغداد - مخصص') return '';
    return studyConfig.baghdadSites?.includes(student.subSite)
      ? ''
      : `${student.studyType}|||${student.subSite}`;
  });
  const firstRemovedBaghdadSite = Array.from(removedBaghdadSiteCounts.entries())[0];
  if (firstRemovedBaghdadSite) {
    const [key, count] = firstRemovedBaghdadSite;
    const [studyType, site] = key.split('|||');
    return `لا يمكن حذف موقع بغداد "${site}" من نوع البرنامج "${studyType}" لأن ${formatLinkedStudentCount(count)} مرتبطين به في دورة "${courseName}". انقل الطلاب أو غيّر موقعهم أولاً.`;
  }

  const removedProvinceCounts = countByUsageKey(linkedStudents, (student) => {
    if (student.locationScope !== 'محافظات' || !student.studyType || !student.subSite) return '';
    const studyConfig = newLocationConfig[student.studyType as StudyType];
    if (!studyConfig?.provinces || studyConfig.provinces.length === 0) return '';
    const nextProvinces = studyConfig.provinces.map(normalizeIraqiProvinceName);
    const normalizedStudentProvince = normalizeIraqiProvinceName(student.subSite);
    return nextProvinces.includes(normalizedStudentProvince)
      ? ''
      : `${student.studyType}|||${student.subSite}`;
  });
  const firstRemovedProvince = Array.from(removedProvinceCounts.entries())[0];
  if (firstRemovedProvince) {
    const [key, count] = firstRemovedProvince;
    const [studyType, province] = key.split('|||');
    return `لا يمكن حذف المحافظة "${province}" من نوع البرنامج "${studyType}" لأن ${formatLinkedStudentCount(count)} مرتبطين بها في دورة "${courseName}". انقل الطلاب أو غيّر محافظاتهم أولاً.`;
  }

  return null;
}


function validateCoursePayload(body: Record<string, unknown>, isUpdate = false): string | null {
  if (!isUpdate) {
    const nameError = requireText(body.name, 'اسم الدورة');
    if (nameError) return nameError;
  }

  // Validate availablePrograms
  const programs = parseJsonArray<string>(body.availablePrograms);
  if (programs.length === 0) return 'يجب اختيار خيار واحد على الأقل من نوع الدورة';
  for (const p of programs) {
    if (!(COURSE_PROGRAMS as readonly string[]).includes(p)) return `نوع الدورة "${p}" غير صالح`;
  }

  // Validate study types per course program
  const studyTypesByProgram = parseJsonRecord<StudyTypesByProgram>(body.studyTypesByProgram, {});
  const studyTypesSet = new Set<string>();
  for (const program of programs) {
    const studyTypes = parseJsonArray<string>(studyTypesByProgram[program as keyof StudyTypesByProgram]);
    if (studyTypes.length === 0) return `يجب اختيار نوع دراسة واحد على الأقل لنوع الدورة "${program}"`;
    for (const st of studyTypes) {
      if (!(STUDY_TYPES as readonly string[]).includes(st)) return `نوع البرنامج "${st}" غير صالح`;
      studyTypesSet.add(st);
    }
  }

  // Keep availableStudyTypes as the normalized union for backward compatibility.
  const studyTypes = Array.from(studyTypesSet);
  if (studyTypes.length === 0) return 'يجب اختيار خيار واحد على الأقل من نوع البرنامج';

  // Validate locationConfig
  const locationConfig = parseJsonRecord<CourseLocationConfig>(body.locationConfig, {});
  for (const studyType of studyTypes) {
    const config = locationConfig[studyType as StudyType];
    if (!config) return `يجب تحديد إعدادات المواقع لنوع البرنامج "${studyType}"`;
    if (!config.scopes || config.scopes.length === 0)
      return `يجب اختيار بغداد أو محافظات لنوع البرنامج "${studyType}"`;
    for (const scope of config.scopes) {
      if (!(LOCATION_SCOPES as readonly string[]).includes(scope))
        return `الموقع "${scope}" غير صالح`;
    }
    if (config.scopes.includes('بغداد')) {
      if (!config.baghdadMode || !(BAGHDAD_MODES as readonly string[]).includes(config.baghdadMode))
        return `يجب اختيار نوع بغداد لنوع البرنامج "${studyType}"`;
      if (studyType === 'حضوري' && config.baghdadMode !== 'بغداد - مخصص')
        return 'نوع بغداد للدراسة الحضورية يجب أن يكون بغداد - مخصص';
      if (config.baghdadMode === 'بغداد - مخصص') {
        if (!config.baghdadSites || config.baghdadSites.length === 0)
          return `يجب اختيار موقع واحد على الأقل من مواقع بغداد لنوع البرنامج "${studyType}"`;
      }
    }
    if (config.scopes.includes('محافظات')) {
      if (!config.provinces || config.provinces.length === 0) {
        return `يجب اختيار محافظة واحدة على الأقل لنوع البرنامج "${studyType}"`;
      }
      for (const prov of config.provinces) {
        const normalizedProvince = normalizeIraqiProvinceName(prov);
        if (!(IRAQI_PROVINCES as readonly string[]).includes(normalizedProvince))
          return `المحافظة "${prov}" غير صالحة`;
      }
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'courses.view');
  if (authError) return authError;

  try {
    const { isPaginatedRequest, parsePagination } = await import('@/lib/pagination');
    if (isPaginatedRequest(req)) {
      const { page, limit, skip } = parsePagination(req);
      const [courses, total] = await Promise.all([
        db.course.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit }),
        db.course.count(),
      ]);
      return NextResponse.json({ courses, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    const courses = await db.course.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json({ courses });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الدورات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'courses.add');
  if (authError) return authError;

  try {
    const body = await req.json();

    const validationMessage = validateCoursePayload(body);
    if (validationMessage) return validationError(validationMessage);

    const studyTypes = getAvailableStudyTypes(body);
    const course = await db.course.create({
      data: {
        name: String(body.name ?? '').trim(),
        active: body.active ?? true,
        availablePrograms: stringifyJson(body.availablePrograms || []),
        availableStudyTypes: stringifyJson(studyTypes),
        studyTypesByProgram: stringifyJson(body.studyTypesByProgram || {}),
        locationConfig: stringifyJson(body.locationConfig || {}),
      },
    });
    return NextResponse.json({ course }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الدورة حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'courses.edit');
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد الدورة المطلوبة');
    if (data.name !== undefined) {
      const nameError = requireText(data.name, 'اسم الدورة');
      if (nameError) return validationError(nameError);
      data.name = String(data.name ?? '').trim();
    }

    const existingCourse = await db.course.findUnique({ where: { id } });
    if (!existingCourse) return validationError('الدورة غير موجودة', 404);

    if (data.availablePrograms !== undefined || data.studyTypesByProgram !== undefined || data.locationConfig !== undefined) {
      const draftCourse = {
        availablePrograms: data.availablePrograms ?? existingCourse.availablePrograms,
        availableStudyTypes: data.availableStudyTypes ?? existingCourse.availableStudyTypes,
        studyTypesByProgram: data.studyTypesByProgram ?? existingCourse.studyTypesByProgram,
        locationConfig: data.locationConfig ?? existingCourse.locationConfig,
      };

      const validationMessage = validateCoursePayload({ ...draftCourse, name: data.name ?? existingCourse.name }, true);
      if (validationMessage) return validationError(validationMessage);

      const existingStudents = await db.student.findMany({
        where: { courseId: id },
        select: { courseProgram: true, courseTerm: true, studyType: true, locationScope: true, baghdadMode: true, subSite: true }
      });

      const usageBlockMessage = firstUsageBlockMessage(existingCourse.name, draftCourse, existingStudents);
      if (usageBlockMessage) return validationError(usageBlockMessage, 409);
    }

    const configTouched = data.availablePrograms !== undefined
      || data.availableStudyTypes !== undefined
      || data.studyTypesByProgram !== undefined
      || data.locationConfig !== undefined;
    const affectedSnapshotStudents = configTouched
      ? await db.student.count({ where: { courseId: id } })
      : 0;

    if (data.studyTypesByProgram !== undefined) data.studyTypesByProgram = stringifyJson(data.studyTypesByProgram);
    if (data.availablePrograms !== undefined) data.availablePrograms = stringifyJson(data.availablePrograms);
    if (data.studyTypesByProgram !== undefined || data.availableStudyTypes !== undefined || data.availablePrograms !== undefined) {
      data.availableStudyTypes = stringifyJson(getAvailableStudyTypes({
        availablePrograms: data.availablePrograms ?? existingCourse.availablePrograms,
        availableStudyTypes: data.availableStudyTypes ?? existingCourse.availableStudyTypes,
        studyTypesByProgram: data.studyTypesByProgram ?? existingCourse.studyTypesByProgram,
      }));
    }
    if (data.locationConfig !== undefined) data.locationConfig = stringifyJson(data.locationConfig);

    const course = await db.course.update({ where: { id }, data });
    return NextResponse.json({
      course,
      studentConfigImpact: configTouched
        ? {
            affectedStudents: affectedSnapshotStudents,
            autoSynced: false,
            message: affectedSnapshotStudents > 0
              ? 'تم تحديث إعدادات الدورة فقط. بيانات الطلاب المسجلين تبقى Snapshot ولا تتغير تلقائياً حتى لا يتغير تصنيف طالب قديم بدون قصد.'
              : 'لا يوجد طلاب حاليون متأثرون بإعدادات هذه الدورة.',
          }
        : null,
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الدورة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'courses.delete');
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الدورة المطلوبة');

    const course = await db.course.findUnique({ where: { id }, select: { name: true } });
    if (!course) return validationError('الدورة غير موجودة', 404);

    const studentCount = await db.student.count({ where: { courseId: id } });
    if (studentCount > 0) {
      return validationError(
        `لا يمكن حذف الدورة "${course.name}" لأن ${formatLinkedStudentCount(studentCount)} مرتبطين بها. استخدم تعطيل الدورة إذا تريد إيقافها بدون حذف بياناتها.`,
        409,
      );
    }

    await ensureExamCourseLinksSchema();
    const relatedExamLink = await db.examCourse.findFirst({
      where: { courseId: id },
      include: { exam: { select: { id: true, name: true } } },
    });
    const relatedExam = relatedExamLink?.exam || (await db.exam.findMany({
      select: { id: true, name: true, courseIds: true },
    })).find((exam) => parseCourseIds(exam.courseIds).includes(id));
    if (relatedExam) {
      return validationError(
        `لا يمكن حذف الدورة "${course.name}" لأنها مرتبطة بامتحان "${relatedExam.name}". استخدم تعطيل الدورة أو عدّل ربط الامتحان أولاً.`,
        409,
      );
    }

    await db.$transaction(async (tx) => {
      await tx.courseChapter.deleteMany({ where: { courseId: id } });
      await tx.course.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الدورة حالياً.');
  }
}
