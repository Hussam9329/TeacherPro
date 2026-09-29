export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission, requirePermissionPrincipal, type AuthPrincipal } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { writeSecurityAudit } from '@/lib/security-audit';
import { ensureDefaultRoles } from '@/lib/default-roles-server';

const ADMIN_USERNAME = 'admin';
const ADMIN_ROLE_ID = 'role_admin';
const SENSITIVE_PERMISSION_IDS = new Set([
  'accounts.manage',
  'accounts.users.add',
  'accounts.users.edit',
  'accounts.users.delete',
  'accounts.roles.add',
  'accounts.roles.edit',
  'accounts.roles.delete',
  'accounts.permissions.assign',
  'logs.clear',
  'logs.restore',
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
  const authError = await requireAnyPermission(req, ['accounts.view', 'accounts.roles.view']);
  if (authError) return authError;

  try {
    await ensureDefaultRoles();
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
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.roles.add');
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
        name: String(body.name ?? '').trim(),
        isDefault: body.isDefault ?? false,
        permissions: normalizePermissions(body.permissions),
      },
    });
    await writeSecurityAudit(principal, 'إنشاء دور', {
      roleId: role.id,
      name: role.name,
      isDefault: role.isDefault,
      permissions: role.permissions,
    });
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر إنشاء الدور حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.roles.edit');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد الدور المطلوب');
    await ensureDefaultRoles();
    const roleBeforeUpdate = await db.role.findUnique({ where: { id } });
    if (!roleBeforeUpdate) return validationError('الدور غير موجود', 404);
    const securityError = validateRoleSecurity(principal, { id, ...data }, roleBeforeUpdate);
    if (securityError) return securityError;
    if (data.name !== undefined) {
      const nameError = requireText(data.name, 'اسم الدور');
      if (nameError) return validationError(nameError);
      data.name = String(data.name ?? '').trim();
    }
    if (data.permissions !== undefined) data.permissions = normalizePermissions(data.permissions);
    const roleData: Record<string, unknown> = {};
    for (const key of ['name', 'permissions'] as const) {
      if (data[key] !== undefined) roleData[key] = data[key];
    }
    // A user's permissions are the role's plus their own. A permission taken
    // off the role is also taken off its users' own lists, or they would keep
    // it and the edit would look saved but change nothing.
    const removedPermissions = data.permissions !== undefined
      ? parsePermissionIds(roleBeforeUpdate.permissions).filter(
          (permission) => !parsePermissionIds(data.permissions).includes(permission),
        )
      : [];
    const { role, syncedUsers, updatedUserPermissions } = await db.$transaction(async (tx) => {
      const role = await tx.role.update({ where: { id }, data: roleData });
      const syncedUsers = roleData.name !== undefined
        ? await tx.appUser.updateMany({ where: { roleId: role.id }, data: { role: role.name } })
        : { count: 0 };
      let updatedUserPermissions = 0;
      if (removedPermissions.length) {
        const roleUsers = await tx.appUser.findMany({
          where: { roleId: role.id },
          select: { id: true, username: true, permissions: true },
        });
        for (const user of roleUsers) {
          if (user.username.trim().toLowerCase() === ADMIN_USERNAME) continue;
          const own = parsePermissionIds(user.permissions);
          const kept = own.filter((permission) => !removedPermissions.includes(permission));
          if (kept.length === own.length) continue;
          await tx.appUser.update({ where: { id: user.id }, data: { permissions: JSON.stringify(kept) } });
          updatedUserPermissions += 1;
        }
      }
      return { role, syncedUsers, updatedUserPermissions };
    });
    await writeSecurityAudit(principal, 'تعديل دور', {
      roleId: role.id,
      before: roleBeforeUpdate,
      after: role,
      syncedUsers: syncedUsers.count,
      removedPermissions,
      updatedUserPermissions,
    });
    return NextResponse.json({ role, syncedUsers: syncedUsers.count, updatedUserPermissions });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الدور حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.roles.delete');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الدور المطلوب');
    const role = await db.role.findUnique({ where: { id } });
    if (!role) return validationError('الدور غير موجود', 404);
    if (role.isDefault) return validationError('لا يمكن حذف دور افتراضي', 403);
    const assignedUsers = await db.appUser.count({ where: { roleId: id } });
    if (assignedUsers > 0) {
      return validationError(`لا يمكن حذف هذا الدور لأنه مستخدم من ${assignedUsers} حساب/حسابات. انقل المستخدمين إلى دور آخر أولاً.`, 409);
    }
    const securityError = validateRoleSecurity(principal, { id }, role || undefined);
    if (securityError) return securityError;
    await db.role.delete({ where: { id } });
    await writeSecurityAudit(principal, 'حذف دور', {
      roleId: id,
      name: role?.name || id,
      permissions: role?.permissions || '[]',
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الدور حالياً.');
  }
}
