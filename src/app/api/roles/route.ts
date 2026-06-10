export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

function normalizePermissions(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return '[]';
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.view');
  if (authError) return authError;

  try {
    const roles = await db.role.findMany({
      orderBy: { name: 'asc' },
      include: { users: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ roles });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الأدوار حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const nameError = requireText(body.name, 'اسم الدور');
    if (nameError) return validationError(nameError);
    const role = await db.role.create({
      data: {
        id: body.id,
        name: String(body.name ?? '').trim(),
        isDefault: body.isDefault ?? false,
        permissions: normalizePermissions(body.permissions),
      },
    });
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر إنشاء الدور حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد الدور المطلوب');
    if (data.name !== undefined) {
      const nameError = requireText(data.name, 'اسم الدور');
      if (nameError) return validationError(nameError);
      data.name = String(data.name ?? '').trim();
    }
    if (data.permissions !== undefined) data.permissions = normalizePermissions(data.permissions);
    const role = await db.role.update({ where: { id }, data });
    return NextResponse.json({ role });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الدور حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.manage');
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الدور المطلوب');
    const role = await db.role.findUnique({ where: { id } });
    if (role?.isDefault) return validationError('لا يمكن حذف دور افتراضي', 403);
    await db.role.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الدور حالياً.');
  }
}
