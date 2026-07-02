export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthPrincipal, requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';

/**
 * Whitelist of (module, action) pairs the CLIENT is allowed to write.
 *
 * Only NON-SENSITIVE user actions are here — adding/editing records,
 * viewing exports, etc. Sensitive actions (delete, dismiss, reactivate,
 * bulk operations, backup import/export) are SERVER-ONLY: the client
 * logs them locally for immediate feedback, but the server-side handler
 * writes the authoritative audit entry after the DB mutation succeeds.
 *
 * Security-sensitive modules (أمان الحسابات, النظام, تصفير الlog, etc.)
 * are NEVER in this list.
 *
 * Rationale: even with a whitelist, allowing the client to write
 * 'حذف طالب' or 'فصل الطالب' entries means a compromised session could
 * plant fake audit entries that look like legitimate admin actions.
 * Server-only logging for sensitive actions ensures the audit trail
 * reflects what actually happened in the DB, not what the client
 * claims happened.
 */
const ALLOWED_CLIENT_LOG_ENTRIES: Record<string, Set<string>> = {
  'تسجيل الدخول': new Set([
    'دخول للنظام',
    'تسجيل خروج',
  ]),
  'الدورات': new Set([
    'إضافة دورة',
    'تعديل دورة',
    'تفعيل دورة',
    'تعطيل دورة',
    // 'حذف دورة' → server-only (delete is sensitive)
    // 'رفض حذف دورة' → server-only
  ]),
  'الفصول والفرص': new Set([
    'إضافة فصل',
    'تعديل فصل',
    'ربط فصل بدورة',
    // 'حذف فصل' → server-only
    // 'رفض حذف فصل' → server-only
    // 'حذف ربط فصل بدورة' → server-only
    // 'تفعيل فصل ومنح فرص جديدة' → server-only (affects opportunities)
    // 'تفعيل فصل واسترجاع أرشيف الفرص' → server-only
    // 'إلغاء تفعيل فصل' → server-only (affects opportunities)
  ]),
  'تسجيل الطلاب': new Set([
    'تسجيل طالب',
    // 'تراجع تسجيل طالب' → server-only (triggered by sync failure)
    // 'رفض تسجيل طالب مكرر' → server-only (validation result)
  ]),
  'سجل الطلاب': new Set([
    'تعديل بيانات طالب',
    // 'رفض تعديل طالب مكرر' → server-only
    // 'حذف طالب مع سجلاته التابعة' → server-only (delete is sensitive)
  ]),
  // 'الطلاب' module (فصل/إعادة تفعيل) → ENTIRELY server-only
  // These are dismissal/reactivation events that affect academic status.
  'الامتحانات': new Set([
    'إضافة امتحان',
    'تعديل امتحان',
    'تفعيل امتحان',
    'تعطيل امتحان',
    // 'حذف امتحان...' → server-only (delete is sensitive)
  ]),
  'الدرجات': new Set([
    'إدخال درجة',
    'تعديل درجة',
    // 'حذف درجة' → server-only
    // 'رفض إدخال درجة لطالب مجاز' → server-only
    // 'إضافة درجات جماعية' → server-only (bulk is sensitive)
    // 'إلغاء حالة غائب جماعي' → server-only (bulk is sensitive)
    // 'تسجيل الصفحة كغائب' → server-only (bulk is sensitive)
  ]),
  'إدارة الفرص': new Set([
    // All opportunity operations affect academic status → server-only
    // 'إضافة فرص جماعية' → server-only
    // 'خصم فرص جماعي' → server-only
    // 'تعديل فرص طالب' → server-only
    // 'إعادة تعيين فرص طالب' → server-only
  ]),
  'المتابعة': new Set([
    'تسجيل مكالمة',
    'تحديث حالة مكالمة',
    'تسجيل إجازة',
    'تثبيت تعهد',
    // 'حذف إجازة' → server-only (delete is sensitive)
  ]),
  'التصحيح الإلكتروني': new Set([
    'إضافة ورقة تصحيح',
    'بدء تصحيح',
    'إنهاء تصحيح',
  ]),
  // 'النسخ الاحتياطي' → ENTIRELY server-only (export may contain PII,
  //   import overwrites data — both are sensitive)
  'تصدير': new Set([
    'تصدير CSV',
    'تصدير Excel',
    'تصدير PDF',
    'تصدير HTML',
  ]),
};

// Remove empty sets (modules where all actions are server-only) so
// isAllowedClientLogEntry correctly rejects them.
for (const key of Object.keys(ALLOWED_CLIENT_LOG_ENTRIES)) {
  if (ALLOWED_CLIENT_LOG_ENTRIES[key].size === 0) {
    delete ALLOWED_CLIENT_LOG_ENTRIES[key];
  }
}

function isAllowedClientLogEntry(module: string, action: string): boolean {
  const actions = ALLOWED_CLIENT_LOG_ENTRIES[module.trim()];
  if (!actions) return false;
  return actions.has(action.trim());
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'logs.view');
  if (authError) return authError;

  try {
    const { isPaginatedRequest, parsePagination } = await import('@/lib/pagination');
    if (isPaginatedRequest(req)) {
      const { page, limit, skip } = parsePagination(req);
      const [logs, total] = await Promise.all([
        db.auditLog.findMany({ orderBy: { time: 'desc' }, skip, take: limit }),
        db.auditLog.count(),
      ]);
      return NextResponse.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    const logs = await db.auditLog.findMany({ orderBy: { time: 'desc' }, take: 500 });
    return NextResponse.json({ logs });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل السجلات حالياً.');
  }
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
