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

  // Special endpoint: seed missing default courses without touching existing records.
  if (body._action === 'seed-defaults') {
    await Promise.all(DEFAULT_COURSES.map((course) => db.course.upsert({
      where: { id: course.id },
      update: { name: course.name, type: course.type },
      create: course,
    })));
    const courses = await db.course.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json({ courses });
  }

  const course = await db.course.create({
    data: {
      id: body.id,
      name: body.name,
      type: body.type,
      active: body.active ?? true,
    },
  });
  return NextResponse.json({ course }, { status: 201 });
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
