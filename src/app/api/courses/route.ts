import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEFAULT_COURSES = [
  { id: 'c_batch27_k1_elec', name: 'دفعة 2027 - الكورس الاول - امتحان الكتروني', type: 'عامة', active: true },
  { id: 'c_batch27_full_elec', name: 'دفعة 2027 - منهج كامل - امتحان الكتروني', type: 'عامة', active: true },
  { id: 'c_batch27_k1_att', name: 'دفعة 2027 - الكورس الاول - امتحان حضوري', type: 'عامة', active: true },
  { id: 'c_batch27_full_att', name: 'دفعة 2027 - منهج كامل - امتحان حضوري', type: 'عامة', active: true },
  { id: 'c_batch27_exempt_elec', name: 'دفعة 2027 - منهج كامل (طلاب الاعفاء) - امتحان الكتروني', type: 'عامة', active: true },
];

export async function GET() {
  const courses = await db.course.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ courses });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Special endpoint: reset courses to defaults
  if (body._action === 'seed-defaults') {
    try {
      // Delete dependent records first (Student has onDelete: Restrict on courseId)
      await db.whatsAppMessage.deleteMany({});
      await db.correctionSheet.deleteMany({});
      await db.opportunityLog.deleteMany({});
      await db.grade.deleteMany({});
      await db.student.deleteMany({});
      await db.site.deleteMany({});
      await db.courseChapter.deleteMany({});
      await db.group.deleteMany({});
      await db.exam.deleteMany({});
      await db.course.deleteMany({});

      for (const c of DEFAULT_COURSES) {
        await db.course.create({ data: { ...c, createdAt: '2026-06-01T00:00:00.000Z' } });
      }
      const courses = await db.course.findMany({ orderBy: { createdAt: 'desc' } });
      return NextResponse.json({ courses });
    } catch (e) {
      console.error('[seed-defaults] Error:', e);
      return NextResponse.json({ error: 'Failed to seed defaults' }, { status: 500 });
    }
  }

  try {
    // Use upsert to avoid errors if course already exists
    const course = await db.course.upsert({
      where: { id: body.id },
      update: { name: body.name, type: body.type, active: body.active ?? true },
      create: {
        id: body.id,
        name: body.name,
        type: body.type,
        active: body.active ?? true,
      },
    });
    return NextResponse.json({ course }, { status: 201 });
  } catch (e) {
    console.error('[courses POST] Error:', e);
    return NextResponse.json({ error: 'Failed to create course' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const course = await db.course.update({ where: { id }, data });
  return NextResponse.json({ course });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.course.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
