import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

const DEFAULT_COURSES = [
  { id: 'c_batch27_k1_elec', name: 'دفعة 2027 - الكورس الأول - امتحان إلكتروني', type: 'عامة', active: true },
  { id: 'c_batch27_full_elec', name: 'دفعة 2027 - منهج كامل - امتحان إلكتروني', type: 'عامة', active: true },
  { id: 'c_batch27_k1_att', name: 'دفعة 2027 - الكورس الأول - امتحان حضوري', type: 'عامة', active: true },
  { id: 'c_batch27_full_att', name: 'دفعة 2027 - منهج كامل - امتحان حضوري', type: 'عامة', active: true },
  { id: 'c_batch27_exempt_elec', name: 'دفعة 2027 - منهج كامل (طلاب الإعفاء) - امتحان إلكتروني', type: 'عامة', active: true },
];

function validateCoursePayload(body: Record<string, unknown>) {
  const nameError = requireText(body.name, 'اسم الدورة');
  if (nameError) return nameError;
  if (!['خاصة', 'عامة'].includes(String(body.type ?? ''))) return 'نوع الدورة يجب أن يكون خاصة أو عامة';
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
      return validationError('نوع الدورة يجب أن يكون خاصة أو عامة');
    }
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
    if (studentCount > 0 || examCount > 0) {
      return validationError('لا يمكن حذف الدورة لأنها مرتبطة بطلاب أو امتحانات. انقل البيانات المرتبطة أولاً.', 409);
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
