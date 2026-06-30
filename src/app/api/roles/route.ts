export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, requirePermissionPrincipal, type AuthPrincipal } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

const ADMIN_USERNAME = 'admin';
const ADMIN_ROLE_ID = 'role_admin';
const SENSITIVE_PERMISSION_IDS = new Set([
  'accounts.manage',
  'backup.view',
  'system.settings',
]);

function normalizePermissions(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return '[]';
}

function parsePermissionIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function isOwner(principal: AuthPrincipal): boolean {
  return principal.username.trim().toLowerCase() === ADMIN_USERNAME;
}

function hasSensitivePermissions(value: unknown): boolean {
  return parsePermissionIds(value).some((permission) => SENSITIVE_PERMISSION_IDS.has(permission));
}

function validateRoleSecurity(principal: AuthPrincipal, payload: Record<string, unknown>, existingRole?: { id?: string | null }) {
  const actorIsOwner = isOwner(principal);
  const targetIsAdminRole = String(existingRole?.id || payload.id || '') === ADMIN_ROLE_ID;

  if (targetIsAdminRole) {
    return validationError('دور مدير النظام محمي ولا يمكن تعديله أو حذفه من إدارة الأدوار.', 403);
  }

  if (!actorIsOwner && payload.permissions !== undefined && hasSensitivePermissions(payload.permissions)) {
    return validationError('لا يمكن إنشاء أو تعديل دور يحتوي صلاحيات حساسة إلا من حساب admin الرئيسي.', 403);
  }

  return null;
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
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.manage');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const body = await req.json();
    const nameError = requireText(body.name, 'اسم الدور');
    if (nameError) return validationError(nameError);
    const securityError = validateRoleSecurity(principal, body);
    if (securityError) return securityError;
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
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.manage');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد الدور المطلوب');
    const roleBeforeUpdate = await db.role.findUnique({ where: { id }, select: { id: true } });
    if (!roleBeforeUpdate) return validationError('الدور غير موجود', 404);
    const securityError = validateRoleSecurity(principal, { id, ...data }, roleBeforeUpdate);
    if (securityError) return securityError;
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
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.manage');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الدور المطلوب');
    const role = await db.role.findUnique({ where: { id } });
    if (role?.isDefault) return validationError('لا يمكن حذف دور افتراضي', 403);
    const securityError = validateRoleSecurity(principal, { id }, role || undefined);
    if (securityError) return securityError;
    await db.role.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الدور حالياً.');
  }
}
