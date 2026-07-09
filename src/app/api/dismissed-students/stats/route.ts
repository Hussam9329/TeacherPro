export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const PLEDGE_NOTE_KIND = "تعهد ولي الأمر";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function buildSearchWhere(rawQuery: string): Prisma.StudentWhereInput | null {
  const q = cleanText(rawQuery);
  if (!q) return null;
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { parentPhone: { contains: q, mode: "insensitive" } },
      { telegram: { contains: q, mode: "insensitive" } },
      { dismissalReason: { contains: q, mode: "insensitive" } },
      { dismissalNotes: { contains: q, mode: "insensitive" } },
    ],
  };
}

function composeAnd(parts: Prisma.StudentWhereInput[]): Prisma.StudentWhereInput {
  const filtered = parts.filter(Boolean);
  return filtered.length ? { AND: filtered } : {};
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  const searchParams = new URL(req.url).searchParams;
  const q = cleanText(searchParams.get("q"));
  const courseId = cleanText(searchParams.get("courseId"));
  const dismissalType = cleanText(searchParams.get("dismissalType"));
  const notesFilter = cleanText(searchParams.get("notesFilter"));
  const pledgeFilter = cleanText(searchParams.get("pledgeFilter"));

  const baseParts: Prisma.StudentWhereInput[] = [{ status: "مفصول" }];
  const searchWhere = buildSearchWhere(q);
  if (searchWhere) baseParts.push(searchWhere);
  if (courseId) baseParts.push({ courseId });
  if (dismissalType) baseParts.push({ dismissalType });
  if (notesFilter === "with-notes") {
    baseParts.push({ dismissalNotes: { not: "" } });
  } else if (notesFilter === "without-notes") {
    baseParts.push({
      OR: [{ dismissalNotes: null }, { dismissalNotes: "" }],
    });
  }

  const baseWhere = composeAnd(baseParts);

  const pledgeRows = await db.studentNote.findMany({
    where: {
      kind: PLEDGE_NOTE_KIND,
      student: baseWhere,
    },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  const pledgedStudentIds = pledgeRows.map((row) => row.studentId);

  const finalParts = [...baseParts];
  if (pledgeFilter === "with-pledge") {
    finalParts.push({ id: { in: pledgedStudentIds.length ? pledgedStudentIds : ["__none__"] } });
  } else if (pledgeFilter === "without-pledge") {
    finalParts.push({ id: { notIn: pledgedStudentIds } });
  }
  const where = composeAnd(finalParts);

  const [total, temporary, final, withNotes, filteredPledgeRows] = await db.$transaction([
    db.student.count({ where }),
    db.student.count({ where: composeAnd([where, { dismissalType: "فصل مؤقت" }]) }),
    db.student.count({ where: composeAnd([where, { dismissalType: "فصل نهائي" }]) }),
    db.student.count({ where: composeAnd([where, { dismissalNotes: { not: "" } }]) }),
    db.studentNote.findMany({
      where: { kind: PLEDGE_NOTE_KIND, student: where },
      select: { studentId: true },
      distinct: ["studentId"],
    }),
  ]);

  const withPledge = filteredPledgeRows.length;

  return NextResponse.json({
    source: "database",
    stats: {
      total,
      temporary,
      final,
      withNotes,
      withPledge,
      withoutPledge: Math.max(0, total - withPledge),
    },
  });
}
