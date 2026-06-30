export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthPrincipal, requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';

/**
 * Whitelist of (module, action) pairs the client is allowed to write.
 *
 * The client calls logAction() in teacher-store for user-facing actions
 * like adding/editing/deleting records. Each allowed pair must appear
 * here; anything else is rejected with 403.
 *
 * Security-sensitive modules (أمان الحسابات, النظام, تصفير الlog, etc.)
 * are NEVER in this list — they are written exclusively by server-side
 * code (login route, security-audit lib, etc.).
 */
const ALLOWED_CLIENT_LOG_ENTRIES: Record<string, Set<string>> = {
  'تسجيل الدخول': new Set([
    'دخول للنظام',
    'تسجيل خروج',
    'محاولة دخول مرفوضة',
  ]),
  'الدورات': new Set([
    'إضافة دورة',
    'تعديل دورة',
    'تفعيل دورة',
    'تعطيل دورة',
    'حذف دورة',
    'رفض حذف دورة',
  ]),
  'الفصول والفرص': new Set([
    'إضافة فصل',
    'تعديل فصل',
    'حذف فصل',
    'رفض حذف فصل',
    'ربط فصل بدورة',
    'حذف ربط فصل بدورة',
    'تفعيل فصل ومنح فرص جديدة',
    'تفعيل فصل واسترجاع أرشيف الفرص',
    'إلغاء تفعيل فصل',
  ]),
  'تسجيل الطلاب': new Set([
    'تسجيل طالب',
    'تراجع تسجيل طالب',
    'رفض تسجيل طالب مكرر',
  ]),
  'سجل الطلاب': new Set([
    'تعديل بيانات طالب',
    'رفض تعديل طالب مكرر',
    'حذف طالب مع سجلاته التابعة',
  ]),
  'الطلاب': new Set([
    'فصل الطالب (فصل مؤقت)',
    'فصل الطالب (فصل نهائي)',
    'إعادة تفعيل طالب',
    'إعادة تفعيل بفرصة واحدة',
  ]),
  'الامتحانات': new Set([
    'إضافة امتحان',
    'تعديل امتحان',
    'تفعيل امتحان',
    'تعطيل امتحان',
    'حذف امتحان مع سجلاته وإعادة احتساب التأثيرات',
  ]),
  'الدرجات': new Set([
    'إدخال درجة',
    'تعديل درجة',
    'حذف درجة',
    'رفض إدخال درجة لطالب مجاز',
    'إضافة درجات جماعية',
    'إلغاء حالة غائب جماعي',
    'تسجيل الصفحة كغائب',
  ]),
  'إدارة الفرص': new Set([
    'إضافة فرص جماعية',
    'خصم فرص جماعي',
    'تعديل فرص طالب',
    'إعادة تعيين فرص طالب',
  ]),
  'المتابعة': new Set([
    'تسجيل مكالمة',
    'تحديث حالة مكالمة',
    'تسجيل إجازة',
    'حذف إجازة',
    'تثبيت تعهد',
  ]),
  'التصحيح الإلكتروني': new Set([
    'إضافة ورقة تصحيح',
    'بدء تصحيح',
    'إنهاء تصحيح',
  ]),
  'النسخ الاحتياطي': new Set([
    'تصدير نسخة احتياطية',
    'استيراد نسخة احتياطية',
  ]),
  'تصدير': new Set([
    'تصدير CSV',
    'تصدير Excel',
    'تصدير PDF',
    'تصدير HTML',
  ]),
};

const ALLOWED_CLIENT_MODULES = new Set(Object.keys(ALLOWED_CLIENT_LOG_ENTRIES));

function isAllowedClientLogEntry(module: string, action: string): boolean {
  const actions = ALLOWED_CLIENT_LOG_ENTRIES[module.trim()];
  if (!actions) return false;
  return actions.has(action.trim());
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'logs.view');
  if (authError) return authError;

  const logs = await db.auditLog.findMany({ orderBy: { time: 'desc' }, take: 500 });
  return NextResponse.json({ logs });
}

/**
 * Audit logs are SERVER-ONLY in principle. The client may write logs for
 * a restricted set of (module, action) pairs so the activity feed
 * reflects user actions. Security-sensitive modules (أمان الحسابات,
 * النظام, etc.) are written exclusively by server-side code.
 *
 * userId/userName are always taken from the authenticated principal.
 * The id field is ignored — the server generates it.
 * The details field is capped at 500 chars (down from 2000) since it
 * only carries short contextual hints (names, codes, counts).
 */
export async function POST(req: NextRequest) {
  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const module = String(body?.module ?? '').trim().slice(0, 60);
  const action = String(body?.action ?? '').trim().slice(0, 120);
  const details = body?.details === undefined || body?.details === null
    ? null
    : String(body.details).slice(0, 500);

  if (!module || !action) {
    return NextResponse.json({ error: 'الوحدة والإجراء مطلوبان.' }, { status: 400 });
  }

  if (!isAllowedClientLogEntry(module, action)) {
    return NextResponse.json(
      { error: 'لا يمكن كتابة سجل بهذا المركب (module/action) من العميل.' },
      { status: 403 },
    );
  }

  const log = await db.auditLog.create({
    data: {
      module,
      action,
      details,
      userId: principal.id,
      userName: principal.name || principal.username,
    },
  });
  return NextResponse.json({ log }, { status: 201 });
}

/**
 * DELETE /api/logs?id=...
 *
 * Deleting audit log entries is admin-only. The previous check
 * (logs.view) let any user with read access also delete entries, which
 * means a non-admin account manager could erase the audit trail of
 * their own suspicious actions.
 *
 * Now: requires an authenticated admin principal (username='admin' OR
 * roleId='role_admin'). Non-admins get 403.
 *
 * Bulk wipe is handled by the dedicated /api/logs/clear endpoint which
 * has its own admin + password gate.
 */
export async function DELETE(req: NextRequest) {
  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
  }
  if (!principal.isAdmin) {
    return NextResponse.json(
      { error: 'حذف السجلات متاح لمدير النظام فقط.' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Record who deleted what before we wipe it, so the audit trail
  // records the deletion itself.
  await db.auditLog.create({
    data: {
      module: 'أمان الحسابات',
      action: 'حذف سجل تدقيق',
      details: `معرف السجل: ${id}`,
      userId: principal.id,
      userName: principal.name || principal.username,
    },
  }).catch((error) => console.warn('[logs] failed to record deletion audit:', error));

  try {
    await db.auditLog.delete({ where: { id } });
  } catch {
    // P2025: record not found. Return ok so the client UI is idempotent
    // (a missing record is already 'deleted' from the user's POV).
    return NextResponse.json({ ok: true, notFound: true });
  }
  return NextResponse.json({ ok: true });
}
