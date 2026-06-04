import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { parseJsonArray, parseJsonRecord, stringifyJson, type CourseLocationConfig, type StudyType, COURSE_PROGRAMS, STUDY_TYPES, LOCATION_SCOPES, BAGHDAD_MODES } from '@/lib/course-config';
import { BAGHDAD_COURSE_SITES } from '@/lib/iraq';
import { IRAQI_PROVINCES } from '@/lib/iraq';

const DEFAULT_COURSES = [
  { id: 'c_batch27_k1_elec', name: 'دفعة 2027 - الكورس الأول - امتحان إلكتروني', type: 'عامة', active: true,
    availablePrograms: '["منهج كامل"]',
    availableStudyTypes: '["إلكتروني"]',
    locationConfig: JSON.stringify({
      'إلكتروني': {
        scopes: ['بغداد', 'محافظات'],
        baghdadMode: 'عموم بغداد',
        baghdadSites: [],
        provinces: [],
      },
    }),
  },
  { id: 'c_batch27_full_elec', name: 'دفعة 2027 - منهج كامل - امتحان إلكتروني', type: 'عامة', active: true,
    availablePrograms: '["منهج كامل"]',
    availableStudyTypes: '["إلكتروني"]',
    locationConfig: JSON.stringify({
      'إلكتروني': {
        scopes: ['بغداد', 'محافظات'],
        baghdadMode: 'عموم بغداد',
        baghdadSites: [],
        provinces: [],
      },
    }),
  },
  { id: 'c_batch27_k1_att', name: 'دفعة 2027 - الكورس الأول - امتحان حضوري', type: 'عامة', active: true,
    availablePrograms: '["منهج كامل"]',
    availableStudyTypes: '["حضوري"]',
    locationConfig: JSON.stringify({
      'حضوري': {
        scopes: ['بغداد', 'محافظات'],
        baghdadMode: 'عموم بغداد',
        baghdadSites: [],
        provinces: [],
      },
    }),
  },
  { id: 'c_batch27_full_att', name: 'دفعة 2027 - منهج كامل - امتحان حضوري', type: 'عامة', active: true,
    availablePrograms: '["منهج كامل"]',
    availableStudyTypes: '["حضوري"]',
    locationConfig: JSON.stringify({
      'حضوري': {
        scopes: ['بغداد', 'محافظات'],
        baghdadMode: 'عموم بغداد',
        baghdadSites: [],
        provinces: [],
      },
    }),
  },
  { id: 'c_batch27_exempt_elec', name: 'دفعة 2027 - منهج كامل (طلاب الإعفاء) - امتحان إلكتروني', type: 'عامة', active: true,
    availablePrograms: '["منهج كامل"]',
    availableStudyTypes: '["إلكتروني"]',
    locationConfig: JSON.stringify({
      'إلكتروني': {
        scopes: ['بغداد', 'محافظات'],
        baghdadMode: 'عموم بغداد',
        baghdadSites: [],
        provinces: [],
      },
    }),
  },
];

function validateCoursePayload(body: Record<string, unknown>, isUpdate = false): string | null {
  if (!isUpdate) {
    const nameError = requireText(body.name, 'اسم الدورة');
    if (nameError) return nameError;
  }
  
  if (!isUpdate || body.type !== undefined) {
    if (!['خاصة', 'عامة'].includes(String(body.type ?? ''))) 
      return 'تصنيف الدورة المالي يجب أن يكون خاصة أو عامة';
  }

  // Validate availablePrograms
  const programs = parseJsonArray<string>(body.availablePrograms);
  if (programs.length === 0) return 'يجب اختيار خيار واحد على الأقل من نوع الدورة';
  for (const p of programs) {
    if (!COURSE_PROGRAMS.includes(p as any)) return `نوع الدورة "${p}" غير صالح`;
  }

  // Validate availableStudyTypes
  const studyTypes = parseJsonArray<string>(body.availableStudyTypes);
  if (studyTypes.length === 0) return 'يجب اختيار خيار واحد على الأقل من نوع الدراسة';
  for (const st of studyTypes) {
    if (!STUDY_TYPES.includes(st as any)) return `نوع الدراسة "${st}" غير صالح`;
  }

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
      if (config.baghdadMode === 'بغداد - مخصص') {
        if (!config.baghdadSites || config.baghdadSites.length === 0)
          return `يجب اختيار موقع واحد على الأقل من مواقع بغداد لنوع الدراسة "${studyType}"`;
      }
    }
    if (config.scopes.includes('محافظات')) {
      // Allow either empty provinces (all) or specific list
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

    // Special endpoint: seed missing default courses without touching existing records.
    if (body._action === 'seed-defaults') {
      await Promise.all(DEFAULT_COURSES.map((course) => db.course.upsert({
        where: { id: course.id },
        update: { name: course.name, type: course.type },
        create: course,
      })));
      const courses = await db.course.findMany({ orderBy: { createdAt: 'desc' } });
      return NextResponse.json({ courses });
    }

    const validationMessage = validateCoursePayload(body);
    if (validationMessage) return validationError(validationMessage);

    const course = await db.course.create({
      data: {
        id: body.id,
        name: String(body.name ?? '').trim(),
        type: String(body.type ?? ''),
        active: body.active ?? true,
        availablePrograms: stringifyJson(body.availablePrograms || []),
        availableStudyTypes: stringifyJson(body.availableStudyTypes || []),
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
    if (data.type !== undefined && !['خاصة', 'عامة'].includes(String(data.type))) {
      return validationError('تصنيف الدورة المالي يجب أن يكون خاصة أو عامة');
    }

    // Check if removing options used by students
    const existingStudents = await db.student.findMany({ 
      where: { courseId: id },
      select: { courseProgram: true, courseTerm: true, studyType: true, locationScope: true, baghdadMode: true, subSite: true }
    });

    if (data.availablePrograms !== undefined || data.availableStudyTypes !== undefined || data.locationConfig !== undefined) {
      const newPrograms = data.availablePrograms ? parseJsonArray<string>(data.availablePrograms) : [];
      const newStudyTypes = data.availableStudyTypes ? parseJsonArray<string>(data.availableStudyTypes) : [];
      const newLocationConfig = data.locationConfig ? parseJsonRecord<CourseLocationConfig>(data.locationConfig, {}) : {};
      
      for (const student of existingStudents) {
        if (student.courseProgram && newPrograms.length > 0 && !newPrograms.includes(student.courseProgram)) {
          return validationError('لا يمكن إزالة هذا الخيار لأنه مستخدم من طلاب مسجلين في هذه الدورة', 409);
        }
        if (student.studyType && newStudyTypes.length > 0 && !newStudyTypes.includes(student.studyType)) {
          return validationError('لا يمكن إزالة هذا الخيار لأنه مستخدم من طلاب مسجلين في هذه الدورة', 409);
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

    if (data.availablePrograms !== undefined) data.availablePrograms = stringifyJson(data.availablePrograms);
    if (data.availableStudyTypes !== undefined) data.availableStudyTypes = stringifyJson(data.availableStudyTypes);
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

    const [studentCount, examCount] = await Promise.all([
      db.student.count({ where: { courseId: id } }),
      db.exam.count({ where: { courseIds: { contains: id } } }),
    ]);
    if (studentCount > 0 && examCount > 0) {
      return validationError('لا يمكن حذف الدورة لأنها مرتبطة بطلاب وامتحانات. انقل البيانات المرتبطة أولاً.', 409);
    } else if (studentCount > 0) {
      return validationError('لا يمكن حذف الدورة لأنها مرتبطة بطلاب. انقل الطلاب أولاً.', 409);
    } else if (examCount > 0) {
      return validationError('لا يمكن حذف الدورة لأنها مرتبطة بامتحانات. انقل الامتحانات أولاً.', 409);
    }

    await db.$transaction(async (tx) => {
      await tx.courseChapter.deleteMany({ where: { courseId: id } });
      await tx.site.deleteMany({ where: { courseId: id } });
      await tx.group.deleteMany({ where: { courseId: id } });
      await tx.course.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الدورة حالياً.');
  }
}
