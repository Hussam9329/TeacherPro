import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const correctionSheets = await db.correctionSheet.findMany({
    orderBy: { startedAt: 'desc' },
    include: { student: true, exam: true, corrector: true },
  });
  return NextResponse.json({ correctionSheets });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const correctionSheet = await db.correctionSheet.create({
    data: {
      id: body.id,
      status: body.status,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      finishedAt: body.finishedAt ? new Date(body.finishedAt) : undefined,
      correctionErrors: Number(body.correctionErrors || 0),
      sumErrors: Number(body.sumErrors || 0),
      studentId: body.studentId,
      examId: body.examId,
      correctorId: body.correctorId,
    },
  });
  return NextResponse.json({ correctionSheet }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (data.startedAt !== undefined) data.startedAt = data.startedAt ? new Date(data.startedAt) : null;
  if (data.finishedAt !== undefined) data.finishedAt = data.finishedAt ? new Date(data.finishedAt) : null;
  if (data.correctionErrors !== undefined) data.correctionErrors = Number(data.correctionErrors);
  if (data.sumErrors !== undefined) data.sumErrors = Number(data.sumErrors);
  const correctionSheet = await db.correctionSheet.update({ where: { id }, data });
  return NextResponse.json({ correctionSheet });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.correctionSheet.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
