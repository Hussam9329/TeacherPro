export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { normalizePasswordForStorage } from '@/lib/passwords';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

function normalizePermissions(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return '[]';
}

function readPasswordInput(body: Record<string, unknown>): string {
  const password = typeof body.password === 'string' ? body.password : '';
  const legacyPasswordHash = typeof body.passwordHash === 'string' ? body.passwordHash : '';
  return (password || legacyPasswordHash).trim();
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

function safeUserSelect() {
  return {
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
  } as const;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.view');
  if (authError) return authError;

  try {
    const users = await db.appUser.findMany({
      orderBy: { name: 'asc' },
      select: safeUserSelect(),
    });
    return NextResponse.json({ users });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل المستخدمين حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const validationMessage = validateUserPayload(body);
    if (validationMessage) return validationError(validationMessage);

    const password = readPasswordInput(body);
    if (!password) return validationError('يرجى إدخال رمز المرور');

    const user = await db.appUser.create({
      data: {
        id: body.id,
        username: String(body.username ?? '').trim(),
        name: String(body.name ?? '').trim(),
        passwordHash: await normalizePasswordForStorage(password),
        role: body.role,
        roleId: body.roleId,
        permissions: normalizePermissions(body.permissions),
        active: body.active ?? true,
      },
      select: safeUserSelect(),
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر إنشاء المستخدم حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id, password, passwordHash, ...data } = body;
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

    const passwordInput = typeof password === 'string' ? password.trim() : typeof passwordHash === 'string' ? passwordHash.trim() : '';
    if (passwordInput) updateData.passwordHash = await normalizePasswordForStorage(passwordInput);

    const user = await db.appUser.update({ where: { id }, data: updateData, select: safeUserSelect() });
    return NextResponse.json({ user });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث المستخدم حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.manage');
  if (authError) return authError;

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
