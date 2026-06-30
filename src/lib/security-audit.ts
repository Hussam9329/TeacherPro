import { db } from '@/lib/db';
import type { AuthPrincipal } from '@/lib/server-auth';

type AuditDetails = Record<string, unknown> | string | undefined | null;

function toSafeDetails(details: AuditDetails): string {
  if (!details) return '';
  if (typeof details === 'string') return details;
  return JSON.stringify(details, (_key, value) => {
    if (typeof value === 'string' && /password|secret|token|hash/i.test(_key)) return '[محجوب]';
    return value;
  });
}

export async function writeSecurityAudit(principal: AuthPrincipal, action: string, details?: AuditDetails) {
  try {
    await db.auditLog.create({
      data: {
        module: 'أمان الحسابات',
        action,
        details: toSafeDetails(details),
        userId: principal.id,
        userName: principal.name || principal.username,
      },
    });
  } catch (error) {
    console.warn('[security-audit] failed to write audit log:', error);
  }
}
