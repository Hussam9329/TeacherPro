import { NextRequest, NextResponse } from 'next/server';
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
} from '@/lib/course-config';
import { IRAQI_PROVINCES } from '@/lib/iraq';

function validateCoursePayload(body: Record<string, unknown>, isUpdate = false): string | null {
  if (!isUpdate) {
    const nameError = requireText(body.name, 'اسم الدورة');
    if (nameError) return nameError;
  }

  // Validate availablePrograms
  const programs = parseJsonArray<string>(body.availablePrograms);
  if (programs.length === 0) return 'يجب اختيار خيار واحد على الأقل من نوع الدورة';
  for (const p of programs) {
    if (!COURSE_PROGRAMS.includes(p as any)) return `نوع الدورة "${p}" غير صالح`;
  }

  // Validate study types per course program
  const studyTypesByProgram = parseJsonRecord<StudyTypesByProgram>(body.studyTypesByProgram, {});
  const studyTypesSet = new Set<string>();
  for (const program of programs) {
    const studyTypes = parseJsonArray<string>(studyTypesByProgram[program as keyof StudyTypesByProgram]);
    if (studyTypes.length === 0) return `يجب اختيار نوع دراسة واحد على الأقل لنوع الدورة "${program}"`;
    for (const st of studyTypes) {
      if (!STUDY_TYPES.includes(st as any)) return `نوع الدراسة "${st}" غير صالح`;
      studyTypesSet.add(st);
    }
  }

  // Keep availableStudyTypes as the normalized union for backward compatibility.
  const studyTypes = Array.from(studyTypesSet);
  if (studyTypes.length === 0) return 'يجب اختيار خيار واحد على الأقل من نوع الدراسة';

  // Validate locationConfig
  const locationConfig = parseJsonRecord<CourseLocationConfig>(body.locationConfig, {});
  for (const studyType of studyTypes) {
    const config = locationConfig[studyType as StudyType];
    if (!config) return `يجب تحديد إعدادات المواقع لنوع الدراسة "${studyType}"`;
    if (!config.scopes || config.scopes.length === 0)
      return `يجب اختيار بغداد أو محافظات لنوع الدراسة "${studyType}"`;
    for (const scope of config.scopes) {
      if (!LOCATION_SCOPES.includes(scope as any))
        return `الموقع "${scope}" غير صالح`;
    }
    if (config.scopes.includes('بغداد')) {
      if (!config.baghdadMode || !BAGHDAD_MODES.includes(config.baghdadMode as any))
        return `يجب اختيار نوع بغداد لنوع الدراسة "${studyType}"`;
      if (studyType === 'حضوري' && config.baghdadMode !== 'بغداد - مخصص')
        return 'نوع بغداد للدراسة الحضورية يجب أن يكون بغداد - مخصص';
      if (config.baghdadMode === 'بغداد - مخصص') {
        if (!config.baghdadSites || config.baghdadSites.length === 0)
          return `يجب اختيار موقع واحد على الأقل من مواقع بغداد لنوع الدراسة "${studyType}"`;
      }
    }
    if (config.scopes.includes('محافظات')) {
      if (config.provinces && config.provinces.length > 0) {
        for (const prov of config.provinces) {
          if (!IRAQI_PROVINCES.includes(prov as any))
            return `المحافظة "${prov}" غير صالحة`;
        }
      }
    }
  }

  return null;
}

export async function GET() {
  try {
    const courses = await db.course.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json({ courses });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الدورات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const validationMessage = validateCoursePayload(body);
    if (validationMessage) return validationError(validationMessage);

    const studyTypes = getAvailableStudyTypes(body);
    const course = await db.course.create({
      data: {
        id: body.id,
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

      const newPrograms = getAvailablePrograms(draftCourse);
      const newLocationConfig = getCourseLocationConfig(draftCourse);
      const existingStudents = await db.student.findMany({
        where: { courseId: id },
        select: { courseProgram: true, courseTerm: true, studyType: true, locationScope: true, baghdadMode: true, subSite: true }
      });

      for (const student of existingStudents) {
        if (student.courseProgram && !newPrograms.includes(student.courseProgram as any)) {
          return validationError('لا يمكن إزالة هذا الخيار لأنه مستخدم من طلاب مسجلين في هذه الدورة', 409);
        }
        if (student.courseProgram && student.studyType) {
          const newStudyTypesForProgram = getAvailableStudyTypesForProgram(draftCourse, student.courseProgram);
          if (!newStudyTypesForProgram.includes(student.studyType as any)) {
            return validationError('لا يمكن إزالة هذا الخيار لأنه مستخدم من طلاب مسجلين في هذه الدورة', 409);
          }
        }
        if (student.studyType && student.locationScope) {
          const studyConfig = newLocationConfig[student.studyType as StudyType];
          if (studyConfig && !studyConfig.scopes?.includes(student.locationScope as any)) {
            return validationError('لا يمكن إزالة هذا الخيار لأنه مستخدم من طلاب مسجلين في هذه الدورة', 409);
          }
          if (student.locationScope === 'بغداد' && student.subSite && studyConfig?.baghdadMode === 'بغداد - مخصص') {
            if (studyConfig.baghdadSites && !studyConfig.baghdadSites.includes(student.subSite)) {
              return validationError('لا يمكن إزالة هذا الخيار لأنه مستخدم من طلاب مسجلين في هذه الدورة', 409);
            }
          }
          if (student.locationScope === 'محافظات' && student.subSite && studyConfig?.provinces && studyConfig.provinces.length > 0) {
            if (!studyConfig.provinces.includes(student.subSite)) {
              return validationError('لا يمكن إزالة هذا الخيار لأنه مستخدم من طلاب مسجلين في هذه الدورة', 409);
            }
          }
        }
      }
    }

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
    return NextResponse.json({ course });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الدورة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الدورة المطلوبة');

    const studentCount = await db.student.count({ where: { courseId: id } });
    if (studentCount > 0) {
      return validationError('لا يمكن حذف الدورة لأنها مرتبطة بطلاب. انقل الطلاب أولاً.', 409);
    }

    await db.$transaction(async (tx) => {
      await tx.courseChapter.deleteMany({ where: { courseId: id } });
      await tx.site.deleteMany({ where: { courseId: id } });
      await tx.course.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الدورة حالياً.');
  }
}
