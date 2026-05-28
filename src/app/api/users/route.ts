import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

function normalizePermissions(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return '[]';
}

function validateUserPayload(body: Record<string, unknown>) {
  const usernameError = requireText(body.username, 'اسم المستخدم');
  if (usernameError) return usernameError;
  const nameError = requireText(body.name, 'الاسم الكامل');
  if (nameError) return nameError;
  const roleError = requireText(body.roleId, 'الدور');
  if (roleError) return roleError;
  return null;
}

export async function GET() {
  try {
    const users = await db.appUser.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        roleId: true,
        permissions: true,
        active: true,
        createdAt: true,
        roleRef: true,
        correctionSheets: true,
        logs: true,
      },
    });
    return NextResponse.json({ users });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل المستخدمين حالياً.');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validationMessage = validateUserPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const user = await db.appUser.create({
      data: {
        id: body.id,
        username: String(body.username ?? '').trim(),
        name: String(body.name ?? '').trim(),
        passwordHash: body.passwordHash ?? body.password,
        role: body.role,
        roleId: body.roleId,
        permissions: normalizePermissions(body.permissions),
        active: body.active ?? true,
      },
    });
    const { passwordHash: _pw, ...safeUser } = user;
    void _pw;
    return NextResponse.json({ user: safeUser }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر إنشاء المستخدم حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد المستخدم المطلوب');

    const updateData: Record<string, unknown> = { ...data };
    if (updateData.name !== undefined) {
      const nameError = requireText(updateData.name, 'الاسم الكامل');
      if (nameError) return validationError(nameError);
      updateData.name = String(updateData.name ?? '').trim();
    }
    if (updateData.username !== undefined) {
      const usernameError = requireText(updateData.username, 'اسم المستخدم');
      if (usernameError) return validationError(usernameError);
      updateData.username = String(updateData.username ?? '').trim();
    }
    if (updateData.permissions !== undefined) updateData.permissions = normalizePermissions(updateData.permissions);
    if (updateData.password !== undefined) {
      updateData.passwordHash = updateData.password;
      delete updateData.password;
    }

    const user = await db.appUser.update({ where: { id }, data: updateData });
    const { passwordHash: _pw, ...safeUser } = user;
    void _pw;
    return NextResponse.json({ user: safeUser });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث المستخدم حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد المستخدم المطلوب');
    const linkedSheets = await db.correctionSheet.count({ where: { correctorId: id } });
    if (linkedSheets > 0) {
      return validationError('لا يمكن حذف المستخدم لأنه مرتبط بأوراق تصحيح. عطّل الحساب بدلاً من حذفه.', 409);
    }
    await db.appUser.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف المستخدم حالياً.');
  }
}
