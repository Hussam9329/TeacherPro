export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/server-auth';
import { routeErrorResponse } from '@/lib/route-helpers';

const ADMIN_USERNAME = 'admin';
const ADMIN_ROLE_ID = 'role_admin';
const SENSITIVE_PERMISSION_IDS = new Set([
  'accounts.manage',
  'backup.view',
  'system.settings',
  'logs.view',
]);

function readEnv(name: string): string {
  return ((globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name] || '').trim();
}

function parsePermissions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function sensitivePermissions(value: unknown): string[] {
  return parsePermissions(value).filter((permission) => SENSITIVE_PERMISSION_IDS.has(permission));
}

function isAdminUser(user: { username?: string | null; roleId?: string | null; role?: string | null }): boolean {
  return String(user.username || '').trim().toLowerCase() === ADMIN_USERNAME
    || String(user.roleId || '') === ADMIN_ROLE_ID
    || String(user.role || '') === 'مدير النظام';
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.manage');
  if (authError) return authError;

  try {
    const [users, roles, logs] = await Promise.all([
      db.appUser.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          roleId: true,
          permissions: true,
          active: true,
          createdAt: true,
        },
      }),
      db.role.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isDefault: true,
          permissions: true,
          users: { select: { id: true, name: true, username: true, active: true } },
        },
      }),
      db.auditLog.findMany({
        where: {
          OR: [
            { module: 'أمان الحسابات' },
            { module: 'الحسابات' },
            { module: 'تسجيل الدخول' },
          ],
        },
        orderBy: { time: 'desc' },
        take: 80,
      }),
    ]);

    const authSecret = readEnv('TEACHERPRO_AUTH_SECRET') || readEnv('AUTH_SECRET') || readEnv('NEXTAUTH_SECRET');
    const botToken = readEnv('TEACHERPRO_BOT_INGEST_TOKEN');
    const nodeEnv = readEnv('NODE_ENV') || 'development';

    const riskyRoles = roles
      .map((role) => ({
        id: role.id,
        name: role.name,
        userCount: role.users.length,
        sensitivePermissions: role.id === ADMIN_ROLE_ID ? ['كل الصلاحيات'] : sensitivePermissions(role.permissions),
      }))
      .filter((role) => role.sensitivePermissions.length > 0);

    const riskyUsers = users
      .map((user) => {
        const role = roles.find((item) => item.id === user.roleId);
        const directSensitive = sensitivePermissions(user.permissions);
        const roleSensitive = role ? sensitivePermissions(role.permissions) : [];
        return {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          roleId: user.roleId,
          active: user.active,
          isAdmin: isAdminUser(user),
          sensitivePermissions: isAdminUser(user)
            ? ['كل الصلاحيات']
            : Array.from(new Set([...directSensitive, ...roleSensitive])),
        };
      })
      .filter((user) => user.isAdmin || user.sensitivePermissions.length > 0);

    const checks = [
      {
        id: 'auth-secret',
        title: 'سر الجلسات',
        ok: Boolean(authSecret) && authSecret.length >= 32,
        severity: Boolean(authSecret) && authSecret.length >= 32 ? 'ok' : 'danger',
        message: Boolean(authSecret)
          ? authSecret.length >= 32
            ? 'مفعّل وبطول مناسب.'
            : 'مفعّل لكنه قصير. الأفضل 32 حرفاً أو أكثر.'
          : 'غير مفعّل. يجب ضبط TEACHERPRO_AUTH_SECRET في السيرفر.',
      },
      {
        id: 'bot-token',
        title: 'توكن استقبال البوت',
        ok: Boolean(botToken) && botToken.length >= 32,
        severity: Boolean(botToken) ? (botToken.length >= 32 ? 'ok' : 'warn') : 'warn',
        message: Boolean(botToken)
          ? 'مفعّل في متغيرات البيئة. لا يتم كشف قيمته في الواجهة.'
          : 'غير مضبوط. سيُرفض استقبال مستلمات البوت حتى تضبط TEACHERPRO_BOT_INGEST_TOKEN.',
      },
      {
        id: 'admin-account',
        title: 'حساب admin',
        ok: users.some((user) => user.username.trim().toLowerCase() === ADMIN_USERNAME && user.active),
        severity: users.some((user) => user.username.trim().toLowerCase() === ADMIN_USERNAME && user.active) ? 'ok' : 'danger',
        message: users.some((user) => user.username.trim().toLowerCase() === ADMIN_USERNAME && user.active)
          ? 'حساب المدير الرئيسي موجود وفعال.'
          : 'حساب المدير الرئيسي غير موجود أو غير فعال.',
      },
      {
        id: 'environment',
        title: 'بيئة التشغيل',
        ok: nodeEnv !== 'production' || (Boolean(authSecret) && authSecret.length >= 32),
        severity: nodeEnv === 'production' ? 'ok' : 'warn',
        message: nodeEnv === 'production' ? 'النظام يعمل بوضع الإنتاج.' : 'النظام يعمل بوضع التطوير/المحلي.',
      },
    ];

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      checks,
      summary: {
        users: users.length,
        activeUsers: users.filter((user) => user.active).length,
        disabledUsers: users.filter((user) => !user.active).length,
        roles: roles.length,
        riskyUsers: riskyUsers.length,
        riskyRoles: riskyRoles.length,
      },
      riskyUsers,
      riskyRoles,
      recentLogs: logs.map((log) => ({
        id: log.id,
        module: log.module,
        action: log.action,
        details: log.details || '',
        userName: log.userName || 'غير محدد',
        time: log.time.toISOString(),
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل لوحة أمان الحسابات حالياً.');
  }
}
