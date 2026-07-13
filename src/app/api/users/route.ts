export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission, requirePermission, requirePermissionPrincipal, type AuthPrincipal } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { normalizePasswordForStorage } from '@/lib/passwords';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { writeSecurityAudit } from '@/lib/security-audit';

const ADMIN_USERNAME = 'admin';
const ADMIN_ROLE_ID = 'role_admin';
const ADMIN_ROLE_NAME = 'مدير عام';
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

function includesSensitivePermission(value: unknown): boolean {
  return parsePermissionIds(value).some((permission) => SENSITIVE_PERMISSION_IDS.has(permission));
}

function samePermissionIds(a: unknown, b: unknown): boolean {
  const normalize = (value: unknown) => Array.from(new Set(parsePermissionIds(value))).sort().join('\u0000');
  return normalize(a) === normalize(b);
}

function sameOptionalString(a: unknown, b: unknown): boolean {
  return String(a ?? '') === String(b ?? '');
}

function sameOptionalBoolean(a: unknown, b: unknown): boolean {
  return Boolean(a) === Boolean(b);
}

function isOwner(principal: AuthPrincipal): boolean {
  return principal.username.trim().toLowerCase() === ADMIN_USERNAME;
}

function isPrimaryAdminUser(user: { username?: string | null }): boolean {
  return String(user.username || '').trim().toLowerCase() === ADMIN_USERNAME;
}

function isAdminRoleUser(user: { roleId?: string | null }): boolean {
  return String(user.roleId || '') === ADMIN_ROLE_ID;
}

function forbiddenSecurity(message: string) {
  return NextResponse.json({ error: message }, { status: 403 });
}

function validateSensitiveUserChanges(principal: AuthPrincipal, payload: Record<string, unknown>, existingUser?: { username?: string | null; role?: string | null; roleId?: string | null; permissions?: unknown; active?: boolean | null }) {
  const actorIsOwner = isOwner(principal);
  const requestedUsername = String(payload.username ?? '').trim().toLowerCase();
  const requestedRoleId = String(payload.roleId ?? '');
  const targetIsAdmin = Boolean(existingUser && (isPrimaryAdminUser(existingUser) || isAdminRoleUser(existingUser)));

  if (!actorIsOwner && (targetIsAdmin || requestedUsername === ADMIN_USERNAME || requestedRoleId === ADMIN_ROLE_ID)) {
    return forbiddenSecurity('لا يمكن لمدير حسابات عادي إنشاء أو تعديل حساب مدير النظام.');
  }

  if (!actorIsOwner && payload.permissions !== undefined && includesSensitivePermission(payload.permissions)) {
    return forbiddenSecurity('لا يمكن منح صلاحيات حساسة إلا من حساب admin الرئيسي.');
  }

  if (principal.id === String(payload.id || '') && existingUser) {
    const roleIdChanged = payload.roleId !== undefined && !sameOptionalString(payload.roleId, existingUser.roleId);
    const roleNameChanged = payload.role !== undefined && !sameOptionalString(payload.role, existingUser.role);
    const permissionsChanged = payload.permissions !== undefined && !samePermissionIds(payload.permissions, existingUser.permissions);
    const activeChanged = payload.active !== undefined && !sameOptionalBoolean(payload.active, existingUser.active);

    if (roleIdChanged || roleNameChanged || permissionsChanged || activeChanged) {
      return forbiddenSecurity('لا يمكن تعديل دورك أو صلاحياتك أو حالة حسابك من نفس الجلسة.');
    }
  }

  return null;
}

async function readAssignableRole(principal: AuthPrincipal, roleId: unknown) {
  const id = String(roleId ?? '').trim();
  if (!id) return { role: null, error: validationError('الدور مطلوب') };
  const role = await db.role.findUnique({
    where: { id },
    select: { id: true, name: true, permissions: true },
  });
  if (!role) return { role: null, error: validationError('الدور غير موجود أو تم حذفه.', 404) };
  if (!isOwner(principal) && includesSensitivePermission(role.permissions)) {
    return { role: null, error: forbiddenSecurity('لا يمكن تعيين دور يحتوي صلاحيات حساسة إلا من حساب admin الرئيسي.') };
  }
  return { role, error: null };
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
  const authError = await requireAnyPermission(req, ['accounts.view', 'accounts.users.view']);
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
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.users.add');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const body = await req.json();
    const validationMessage = validateUserPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const securityError = validateSensitiveUserChanges(principal, body);
    if (securityError) return securityError;
    const roleAssignment = await readAssignableRole(principal, body.roleId);
    if (roleAssignment.error) return roleAssignment.error;
    const assignedRole = roleAssignment.role;

    const password = readPasswordInput(body);
    if (!password) return validationError('يرجى إدخال رمز المرور');

    // Q98 FIX: Enforce password strength policy on user creation.
    const passwordCheck = validatePasswordPolicy(password);
    if (!passwordCheck.ok) {
      return validationError(passwordCheck.reason);
    }

    const user = await db.appUser.create({
      data: {
        username: String(body.username ?? '').trim(),
        name: String(body.name ?? '').trim(),
        passwordHash: await normalizePasswordForStorage(password),
        role: assignedRole?.name || '',
        roleId: assignedRole?.id || null,
        permissions: normalizePermissions(body.permissions),
        active: body.active ?? true,
      },
      select: safeUserSelect(),
    });
    await writeSecurityAudit(principal, 'إنشاء مستخدم', {
      targetUserId: user.id,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
      active: user.active,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر إنشاء المستخدم حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.users.edit');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const body = await req.json();
    const { id, password, passwordHash, ...data } = body;
    if (!id) return validationError('تعذر تحديد المستخدم المطلوب');

    const existingUser = await db.appUser.findUnique({
      where: { id },
      select: { id: true, username: true, name: true, role: true, roleId: true, permissions: true, active: true },
    });
    if (!existingUser) return validationError('المستخدم غير موجود', 404);
    const securityError = validateSensitiveUserChanges(principal, { id, ...data }, existingUser);
    if (securityError) return securityError;
    const roleAssignment = data.roleId !== undefined ? await readAssignableRole(principal, data.roleId) : { role: null, error: null };
    if (roleAssignment.error) return roleAssignment.error;

    const updateData: Record<string, unknown> = { ...data };
    delete updateData.role;
    if (isPrimaryAdminUser(existingUser)) {
      delete updateData.username;
      delete updateData.roleId;
      delete updateData.role;
      delete updateData.permissions;
      delete updateData.active;
      updateData.active = true;
      updateData.roleId = ADMIN_ROLE_ID;
      updateData.role = ADMIN_ROLE_NAME;
    }
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
    if (!isPrimaryAdminUser(existingUser) && roleAssignment.role) {
      updateData.roleId = roleAssignment.role.id;
      updateData.role = roleAssignment.role.name;
    }
    if (updateData.permissions !== undefined) updateData.permissions = normalizePermissions(updateData.permissions);

    const passwordInput = typeof password === 'string' ? password.trim() : typeof passwordHash === 'string' ? passwordHash.trim() : '';
    if (passwordInput) {
      // Q98 FIX: Enforce password strength policy on password change.
      const passwordCheck = validatePasswordPolicy(passwordInput);
      if (!passwordCheck.ok) {
        return validationError(passwordCheck.reason);
      }
      updateData.passwordHash = await normalizePasswordForStorage(passwordInput);
    }

    const user = await db.appUser.update({ where: { id }, data: updateData, select: safeUserSelect() });
    await writeSecurityAudit(principal, 'تعديل مستخدم', {
      targetUserId: user.id,
      username: user.username,
      before: {
        name: existingUser.name,
        role: existingUser.role,
        roleId: existingUser.roleId,
        permissions: existingUser.permissions,
        active: existingUser.active,
      },
      after: {
        name: user.name,
        role: user.role,
        roleId: user.roleId,
        permissions: user.permissions,
        active: user.active,
      },
      passwordChanged: Boolean(passwordInput),
    });
    return NextResponse.json({ user });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث المستخدم حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.users.delete');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد المستخدم المطلوب');
    if (id === principal.id) return validationError('لا يمكن حذف حسابك الحالي من نفس الجلسة.', 403);
    const user = await db.appUser.findUnique({ where: { id }, select: { id: true, username: true, name: true, role: true, roleId: true, permissions: true, active: true } });
    if (!user) return validationError('المستخدم غير موجود', 404);
    if (isPrimaryAdminUser(user) || isAdminRoleUser(user)) {
      return validationError('لا يمكن حذف حساب مدير النظام. عطّل أو عدّل حسابات المستخدمين العادية فقط.', 403);
    }
    const linkedSheets = await db.correctionSheet.count({ where: { correctorId: id } });
    if (linkedSheets > 0) {
      return validationError('لا يمكن حذف المستخدم لأنه مرتبط بأوراق تصحيح. عطّل الحساب بدلاً من حذفه.', 409);
    }
    await db.appUser.delete({ where: { id } });
    await writeSecurityAudit(principal, 'حذف مستخدم', {
      targetUserId: id,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف المستخدم حالياً.');
  }
}
