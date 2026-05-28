import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

export async function GET() {
  try {
    const demoCopies = await db.demoCopy.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ demoCopies });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل نسخ الديمو حالياً.');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const nameError = requireText(body.name, 'اسم نسخة الديمو');
    if (nameError) return validationError(nameError);
    const userError = requireText(body.demoUserId, 'مستخدم الديمو');
    if (userError) return validationError(userError);
    const durationDays = Number(body.durationDays ?? 7);
    if (!Number.isFinite(durationDays) || durationDays <= 0) return validationError('مدة نسخة الديمو يجب أن تكون رقماً أكبر من صفر');
    const demoCopy = await db.demoCopy.create({
      data: {
        id: body.id,
        name: String(body.name ?? '').trim(),
        description: String(body.description || '').trim(),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        active: body.active ?? true,
        demoUserId: body.demoUserId,
        createdFromData: body.createdFromData ?? false,
        snapshot: typeof body.snapshot === 'string' ? body.snapshot : JSON.stringify(body.snapshot || {}),
        limits: typeof body.limits === 'string' ? body.limits : JSON.stringify(body.limits || {}),
        durationDays,
      },
    });
    return NextResponse.json({ demoCopy }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر إنشاء نسخة الديمو حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد نسخة الديمو المطلوبة');

    const updateData: Record<string, unknown> = { ...data };
    if (updateData.name !== undefined) {
      const nameError = requireText(updateData.name, 'اسم نسخة الديمو');
      if (nameError) return validationError(nameError);
      updateData.name = String(updateData.name ?? '').trim();
    }
    if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    if (data.snapshot !== undefined && typeof data.snapshot !== 'string') updateData.snapshot = JSON.stringify(data.snapshot);
    if (data.limits !== undefined && typeof data.limits !== 'string') updateData.limits = JSON.stringify(data.limits);

    const demoCopy = await db.demoCopy.update({ where: { id }, data: updateData });
    return NextResponse.json({ demoCopy });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث نسخة الديمو حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد نسخة الديمو المطلوبة');
    await db.demoCopy.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف نسخة الديمو حالياً.');
  }
}
