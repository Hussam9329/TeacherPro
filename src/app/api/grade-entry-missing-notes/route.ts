export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthPrincipal, requireAnyPermission, requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { routeErrorResponse, validationError } from '@/lib/route-helpers';
import {
  ensureGradeEntryMissingNoteSchema,
  gradeEntryMissingNoteSchemaMessage,
  withGradeEntryMissingNoteSchema,
} from '@/lib/grade-entry-missing-note-schema';

type NoteRow = {
  id: string;
  examId: string;
  examName: string;
  examDate: string;
  text: string;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function normalize(row: NoteRow) {
  return {
    id: row.id,
    examId: row.examId,
    examName: row.examName || '',
    examDate: row.examDate || '',
    text: row.text,
    userId: row.userId || null,
    userName: row.userName || null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.view');
  if (authError) return authError;

  try {
    const notes = await withGradeEntryMissingNoteSchema(async () =>
      db.gradeEntryMissingNote.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
    );
    return NextResponse.json({ notes: notes.map(normalize) });
  } catch (error) {
    return routeErrorResponse(error, gradeEntryMissingNoteSchemaMessage);
  }
}

/**
 * POST requires grades.add OR grades.edit (the user must be able to
 * enter or edit grades to also leave a note about missing students).
 * Admins always pass.
 */
export async function POST(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['grades.add', 'grades.edit']);
  if (authError) return authError;

  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const examId = String(body?.examId ?? '').trim();
    const text = String(body?.text ?? '').trim();
    if (!examId) return validationError('examId مطلوب');
    if (!text) return validationError('نص الملاحظة مطلوب');

    const exam = await db.exam.findUnique({
      where: { id: examId },
      select: { id: true, name: true, date: true },
    });
    if (!exam) return validationError('لا يمكن حفظ ملاحظة على امتحان محذوف أو غير موجود.', 404);

    const examName = (String(body?.examName ?? '').trim() || exam.name).slice(0, 200);
    const examDate = (String(body?.examDate ?? '').trim() || exam.date.toISOString()).slice(0, 30);
    const note = await withGradeEntryMissingNoteSchema(() =>
      db.gradeEntryMissingNote.upsert({
        where: { examId },
        create: {
          examId,
          examName,
          examDate,
          text,
          userId: principal.id,
          userName: principal.name || principal.username,
        },
        update: {
          examName,
          examDate,
          text,
          userId: principal.id,
          userName: principal.name || principal.username,
        },
      }),
    );
    return NextResponse.json({ note: normalize(note as NoteRow) }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الملاحظة حالياً.');
  }
}

/**
 * تعديل ملاحظة موجودة من لوحة التحكم. نربط الحفظ بـ updatedAt الذي شاهدته
 * الواجهة حتى لا يكتب مستخدم فوق تعديل أحدث لمستخدم آخر بصمت.
 */
export async function PATCH(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.edit');
  if (authError) return authError;

  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const id = String(body?.id ?? '').trim();
    const text = String(body?.text ?? '').trim();
    const expectedUpdatedAt = String(body?.updatedAt ?? '').trim();
    if (!id) return validationError('معرّف الملاحظة مطلوب');
    if (!text) return validationError('نص الملاحظة مطلوب');
    if (!expectedUpdatedAt || Number.isNaN(new Date(expectedUpdatedAt).getTime())) {
      return validationError('نسخة الملاحظة غير صالحة. حدّث الصفحة ثم حاول مجدداً.');
    }

    const note = await withGradeEntryMissingNoteSchema(async () =>
      db.$transaction(async (tx) => {
        const updated = await tx.gradeEntryMissingNote.updateMany({
          where: { id, updatedAt: new Date(expectedUpdatedAt) },
          data: {
            text,
            userId: principal.id,
            userName: principal.name || principal.username,
          },
        });
        if (updated.count !== 1) return null;
        return tx.gradeEntryMissingNote.findUnique({ where: { id } });
      }),
    );

    if (!note) {
      return NextResponse.json(
        { error: 'تغيرت الملاحظة أو حُذفت بعد فتحها. حدّث البيانات ثم أعد التعديل.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ note: normalize(note as NoteRow) });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تعديل الملاحظة حالياً.');
  }
}

/**
 * DELETE requires grades.delete OR admin. The previous check
 * (grades.view) let any user with read access delete notes, which
 * could erase a colleague's record of missing students.
 */
export async function DELETE(req: NextRequest) {
  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
  }

  const hasDeletePermission = principal.isAdmin || principal.permissions.includes('grades.delete');
  if (!hasDeletePermission) {
    return NextResponse.json(
      { error: 'حذف الملاحظات يتطلب صلاحية حذف الدرجات أو حساب مدير النظام.' },
      { status: 403 },
    );
  }

  try {
    await ensureGradeEntryMissingNoteSchema();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const examId = searchParams.get('examId');
    if (id) {
      await db.gradeEntryMissingNote.delete({ where: { id } }).catch(() => null);
    } else if (examId) {
      await db.gradeEntryMissingNote.deleteMany({ where: { examId } });
    } else {
      return validationError('id أو examId مطلوب');
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الملاحظة.');
  }
}
