import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const opportunityLogs = await db.opportunityLog.findMany({ orderBy: { date: 'desc' } });
  return NextResponse.json({ opportunityLogs });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const log = await db.opportunityLog.create({
    data: {
      id: body.id,
      action: body.action,
      amount: Number(body.amount || 0),
      reason: body.reason,
      date: body.date ? new Date(body.date) : new Date(),
      chapterId: body.chapterId || undefined,
      studentId: body.studentId,
      examId: body.examId || undefined,
    },
  });
  return NextResponse.json({ log }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.opportunityLog.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
