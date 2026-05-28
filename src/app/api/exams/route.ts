import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const exams = await db.exam.findMany({ orderBy: { date: 'desc' }, include: { grades: true } });
  return NextResponse.json({ exams });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const exam = await db.exam.create({
    data: {
      id: body.id,
      name: body.name,
      type: body.type,
      courseIds: JSON.stringify(body.courseIds || []),
      mainSite: body.mainSite,
      groupId: body.groupId || undefined,
      date: body.date ? new Date(body.date) : new Date(),
      fullMark: Number(body.fullMark || 100),
      passMark: Number(body.passMark || 50),
      discountMark: Number(body.discountMark || 0),
      opportunitiesPenalty: String(body.opportunitiesPenalty ?? 1),
      dismissalGrade: body.dismissalGrade === null || body.dismissalGrade === undefined ? null : Number(body.dismissalGrade),
      active: body.active ?? true,
      attendanceClosed: body.attendanceClosed ?? false,
      attendance: JSON.stringify(body.attendance || []),
    },
  });
  return NextResponse.json({ exam }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (data.courseIds !== undefined) data.courseIds = JSON.stringify(data.courseIds || []);
  if (data.date !== undefined) data.date = data.date ? new Date(data.date) : new Date();
  if (data.fullMark !== undefined) data.fullMark = Number(data.fullMark);
  if (data.passMark !== undefined) data.passMark = Number(data.passMark);
  if (data.discountMark !== undefined) data.discountMark = Number(data.discountMark);
  if (data.opportunitiesPenalty !== undefined) data.opportunitiesPenalty = String(data.opportunitiesPenalty);
  if (data.dismissalGrade !== undefined) data.dismissalGrade = data.dismissalGrade === null ? null : Number(data.dismissalGrade);
  if (data.attendance !== undefined) data.attendance = JSON.stringify(data.attendance || []);
  const exam = await db.exam.update({ where: { id }, data });
  return NextResponse.json({ exam });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    await db.$transaction(async (tx) => {
      // Delete correction sheets first
      await tx.correctionSheet.deleteMany({ where: { examId: id } });
      // Delete opportunity logs
      await tx.opportunityLog.deleteMany({ where: { examId: id } });
      // Delete grades
      await tx.grade.deleteMany({ where: { examId: id } });
      // Finally delete the exam
      await tx.exam.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API] DELETE /api/exams error:', message);
    return NextResponse.json({ error: `فشل حذف الامتحان: ${message}` }, { status: 500 });
  }
}
