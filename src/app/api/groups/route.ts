import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

function validateGroupPayload(body: Record<string, unknown>) {
  const nameError = requireText(body.name, 'اسم المجموعة الإلكترونية');
  if (nameError) return nameError;
  const courseError = requireText(body.courseId, 'الدورة');
  if (courseError) return courseError;
  return null;
}

export async function GET() {
  try {
    const groups = await db.group.findMany({ orderBy: { name: 'asc' }, include: { course: true } });
    return NextResponse.json({ groups });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل المجموعات الإلكترونية حالياً.');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validationMessage = validateGroupPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const group = await db.group.create({
      data: {
        id: body.id,
        name: String(body.name ?? '').trim(),
        electronicGroup: String(body.electronicGroup ?? '').trim(),
        active: body.active ?? true,
        courseId: String(body.courseId ?? ''),
      },
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ المجموعة الإلكترونية حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد المجموعة الإلكترونية المطلوبة');
    if (data.name !== undefined) {
      const nameError = requireText(data.name, 'اسم المجموعة الإلكترونية');
      if (nameError) return validationError(nameError);
      data.name = String(data.name ?? '').trim();
    }
    if (data.electronicGroup !== undefined) data.electronicGroup = String(data.electronicGroup ?? '').trim();
    const group = await db.group.update({ where: { id }, data });
    return NextResponse.json({ group });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث المجموعة الإلكترونية حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد المجموعة الإلكترونية المطلوبة');

    const [studentCount, examCount] = await Promise.all([
      db.student.count({ where: { groupId: id } }),
      db.exam.count({ where: { groupId: { contains: id } } }),
    ]);
    if (studentCount > 0 || examCount > 0) {
      return validationError('لا يمكن حذف المجموعة الإلكترونية لأنها مرتبطة بطلاب أو امتحانات.', 409);
    }

    await db.group.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف المجموعة الإلكترونية حالياً.');
  }
}
