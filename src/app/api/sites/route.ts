export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

function validateSitePayload(body: Record<string, unknown>) {
  const courseError = requireText(body.courseId, 'الدورة');
  if (courseError) return courseError;
  const mainError = requireText(body.main, 'الموقع الرئيسي');
  if (mainError) return mainError;
  const subError = requireText(body.sub, 'الموقع الفرعي');
  if (subError) return subError;
  return null;
}

export async function GET() {
  try {
    const sites = await db.site.findMany({ orderBy: { main: 'asc' }, include: { course: true } });
    return NextResponse.json({ sites });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل المواقع حالياً.');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validationMessage = validateSitePayload(body);
    if (validationMessage) return validationError(validationMessage);
    const site = await db.site.create({
      data: {
        id: body.id,
        main: String(body.main ?? '').trim(),
        sub: String(body.sub ?? '').trim(),
        active: body.active ?? true,
        courseId: String(body.courseId ?? ''),
      },
    });
    return NextResponse.json({ site }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الموقع حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد الموقع المطلوب');
    if (data.main !== undefined) {
      const mainError = requireText(data.main, 'الموقع الرئيسي');
      if (mainError) return validationError(mainError);
      data.main = String(data.main ?? '').trim();
    }
    if (data.sub !== undefined) {
      const subError = requireText(data.sub, 'الموقع الفرعي');
      if (subError) return validationError(subError);
      data.sub = String(data.sub ?? '').trim();
    }
    const site = await db.site.update({ where: { id }, data });
    return NextResponse.json({ site });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الموقع حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الموقع المطلوب');
    const site = await db.site.findUnique({ where: { id } });
    if (!site) return validationError('الموقع غير موجود أو تم حذفه مسبقاً', 404);

    const linkedStudentsCount = await db.student.count({
      where: {
        courseId: site.courseId,
        mainSite: site.main,
        subSite: site.sub || '',
      },
    });
    if (linkedStudentsCount > 0) {
      return validationError('لا يمكن حذف الموقع لأنه مرتبط بطلاب. انقل الطلاب أولاً ثم حاول الحذف.', 409);
    }

    await db.site.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الموقع حالياً.');
  }
}
