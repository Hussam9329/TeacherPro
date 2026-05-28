import { NextResponse } from 'next/server';

export function validationError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function requireText(value: unknown, label: string) {
  return String(value ?? '').trim() ? null : `${label}: هذا الحقل مطلوب`;
}

export function normalizeArabicText(value: unknown): string {
  return String(value ?? '')
    .toLocaleLowerCase('ar-IQ')
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\s\-_]+/g, ' ')
    .trim();
}

export function normalizeRouteError(error: unknown, fallback = 'تعذر تنفيذ العملية حالياً. حاول مرة أخرى.') {
  const err = error as { code?: string; meta?: { target?: unknown }; message?: string };
  const message = err?.message || String(error ?? '');

  if (err?.code === 'P2002') return 'هذه البيانات مسجلة مسبقاً.';
  if (err?.code === 'P2003') return 'لا يمكن حذف السجل لأنه مرتبط ببيانات أخرى.';
  if (err?.code === 'P2025') return 'السجل المطلوب غير موجود أو تم حذفه مسبقاً.';
  if (message.toLowerCase().includes('foreign key')) return 'لا يمكن تنفيذ العملية لأن السجل مرتبط ببيانات أخرى.';
  if (message.toLowerCase().includes('unique')) return 'هذه البيانات مسجلة مسبقاً.';
  return fallback;
}

export function routeErrorResponse(error: unknown, fallback?: string, status = 500) {
  console.error('[API] route error:', error);
  return NextResponse.json({ error: normalizeRouteError(error, fallback) }, { status });
}
