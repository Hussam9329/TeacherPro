export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, requirePermissionPrincipal, type AuthPrincipal } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { normalizePasswordForStorage } from '@/lib/passwords';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

const ADMIN_USERNAME = 'admin';
const ADMIN_ROLE_ID = 'role_admin';
const ADMIN_ROLE_NAME = 'مدير عام';
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

function includesSensitivePermission(value: unknown): boolean {
  return parsePermissionIds(value).some((permission) => SENSITIVE_PERMISSION_IDS.has(permission));
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

function validateSensitiveUserChanges(principal: AuthPrincipal, payload: Record<string, unknown>, existingUser?: { username?: string | null; roleId?: string | null }) {
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

  if (principal.id === String(payload.id || '') && (payload.roleId !== undefined || payload.permissions !== undefined || payload.active !== undefined)) {
    return forbiddenSecurity('لا يمكن تعديل دورك أو صلاحياتك أو حالة حسابك من نفس الجلسة.');
  }

  return null;
}

async function validateRoleAssignment(principal: AuthPrincipal, roleId: unknown) {
  if (isOwner(principal) || !roleId) return null;
  const role = await db.role.findUnique({
    where: { id: String(roleId) },
    select: { permissions: true },
  });
  if (role && includesSensitivePermission(role.permissions)) {
    return forbiddenSecurity('لا يمكن تعيين دور يحتوي صلاحيات حساسة إلا من حساب admin الرئيسي.');
  }
  return null;
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
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.manage');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const body = await req.json();
    const validationMessage = validateUserPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const securityError = validateSensitiveUserChanges(principal, body);
    if (securityError) return securityError;
    const roleAssignmentError = await validateRoleAssignment(principal, body.roleId);
    if (roleAssignmentError) return roleAssignmentError;

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
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.manage');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const body = await req.json();
    const { id, password, passwordHash, ...data } = body;
    if (!id) return validationError('تعذر تحديد المستخدم المطلوب');

    const existingUser = await db.appUser.findUnique({
      where: { id },
      select: { id: true, username: true, roleId: true },
    });
    if (!existingUser) return validationError('المستخدم غير موجود', 404);
    const securityError = validateSensitiveUserChanges(principal, { id, ...data }, existingUser);
    if (securityError) return securityError;
    const roleAssignmentError = data.roleId !== undefined ? await validateRoleAssignment(principal, data.roleId) : null;
    if (roleAssignmentError) return roleAssignmentError;

    const updateData: Record<string, unknown> = { ...data };
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
  const principalOrError = await requirePermissionPrincipal(req, 'accounts.manage');
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد المستخدم المطلوب');
    if (id === principal.id) return validationError('لا يمكن حذف حسابك الحالي من نفس الجلسة.', 403);
    const user = await db.appUser.findUnique({ where: { id }, select: { username: true, roleId: true } });
    if (!user) return validationError('المستخدم غير موجود', 404);
    if (isPrimaryAdminUser(user) || isAdminRoleUser(user)) {
      return validationError('لا يمكن حذف حساب مدير النظام. عطّل أو عدّل حسابات المستخدمين العادية فقط.', 403);
    }
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
