import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const grades = await db.grade.findMany({ orderBy: { updatedAt: 'desc' }, include: { student: true, exam: true } });
  return NextResponse.json({ grades });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const grade = await db.grade.upsert({
    where: { studentId_examId: { studentId: body.studentId, examId: body.examId } },
    update: {
      status: body.status,
      score: body.score === null || body.score === undefined ? null : Number(body.score),
      accountingChecked: Boolean(body.accountingChecked),
      notes: body.notes,
    },
    create: {
      id: body.id,
      studentId: body.studentId,
      examId: body.examId,
      status: body.status,
      score: body.score === null || body.score === undefined ? null : Number(body.score),
      accountingChecked: Boolean(body.accountingChecked),
      notes: body.notes,
    },
  });
  return NextResponse.json({ grade }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (data.score !== undefined) data.score = data.score === null ? null : Number(data.score);
  if (data.accountingChecked !== undefined) data.accountingChecked = Boolean(data.accountingChecked);
  const grade = await db.grade.update({ where: { id }, data });
  return NextResponse.json({ grade });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const studentId = searchParams.get('studentId');
  const examId = searchParams.get('examId');

  // Support deletion by id (frontend sends id) or by studentId+examId
  if (id) {
    await db.grade.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }
  if (studentId && examId) {
    await db.grade.delete({ where: { studentId_examId: { studentId, examId } } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'id or (studentId and examId) are required' }, { status: 400 });
}
