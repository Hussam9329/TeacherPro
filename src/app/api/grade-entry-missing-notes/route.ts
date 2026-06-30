export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthPrincipal, requirePermission } from '@/lib/server-auth';
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
  createdAt: string;
  updatedAt: string;
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.view');
  if (authError) return authError;

  try {
    const notes = await withGradeEntryMissingNoteSchema(async () =>
      db.gradeEntryMissingNote.findMany({ orderBy: { updatedAt: 'desc' }, take: 500 }),
    );
    return NextResponse.json({ notes: notes.map(normalize) });
  } catch (error) {
    return routeErrorResponse(error, gradeEntryMissingNoteSchemaMessage);
  }
}

export async function POST(req: NextRequest) {
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

    const examName = String(body?.examName ?? '').trim().slice(0, 200);
    const examDate = String(body?.examDate ?? '').trim().slice(0, 30);
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
    return NextResponse.json({ note: normalize(note) }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الملاحظة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.view');
  if (authError) return authError;

  try {
    await ensureGradeEntryMissingNoteSchema();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const examId = searchParams.get('examId');
    if (id) {
      await db.gradeEntryMissingNote.delete({ where: { id } });
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
