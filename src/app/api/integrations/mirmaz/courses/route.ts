export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireMirmazToken } from "@/lib/mirmaz-integration-auth";
import { nameWords, wordsMatch } from "@/lib/mirmaz-name-match";

/**
 * Which TeacherPro course each student of a Mirmaz exam is in, for «Mirmaz
 * Pro» (through its own server) to show an exam course by course: Mirmaz
 * itself keeps no courses. Read-only.
 *
 * A paper whose grade was already placed is the student it went to. Any other
 * is found by name exactly as «أداة مرماز» finds one (every compared word of
 * the first four matches, at least two): when every such student is in the
 * same course, that is its course; none, or several courses, and it is left
 * without one (never guessed).
 *
 * Body: { answers: [{ answerId, name }] }
 * Reply: { ok, courses: [{ id, name }], matches: { answerId: courseId | null } }
 */

const MAX_ANSWERS = 3000;
const MAX_BODY_BYTES = 400_000;

type Words = string[];

// wordsMatch, with a quick no first: words whose lengths differ by more than
// one can only match through «ال» (the same result, far fewer comparisons).
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 && a.replace(/^ال/, "") !== b.replace(/^ال/, "")) return false;
  return wordsMatch(a, b);
}

// «الاسم مطابق», as compareNames(...).full: every compared word matches, at least two.
function fullMatch(wanted: Words, candidate: Words): boolean {
  const of = Math.min(wanted.length, candidate.length, 4);
  if (of < 2) return false;
  for (let i = 0; i < of; i += 1) if (!sameWord(wanted[i], candidate[i])) return false;
  return true;
}

export async function POST(req: NextRequest) {
  const tokenError = requireMirmazToken(req);
  if (tokenError) return tokenError;
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "الطلب كبير أكثر من اللازم." }, { status: 413 });
  }
  try {
    const body = (await req.json().catch(() => null)) as { answers?: unknown } | null;
    const answers = (Array.isArray(body?.answers) ? body!.answers : [])
      .slice(0, MAX_ANSWERS)
      .map((item) => item as { answerId?: unknown; name?: unknown })
      .map((item) => ({ answerId: String(item?.answerId ?? ""), name: String(item?.name ?? "").slice(0, 200) }))
      .filter((item) => /^\d{1,20}$/.test(item.answerId));
    if (!answers.length) return validationError("ماكو أوراق.");

    const [students, courses, placed] = await Promise.all([
      db.student.findMany({ where: { status: { not: "مؤرشف" } }, select: { id: true, name: true, courseId: true } }),
      db.course.findMany({ select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
      db.mirmazHold.findMany({
        where: { answerId: { in: answers.map((a) => a.answerId) }, status: { in: ["SAVED", "RESOLVED"] }, resolvedStudentId: { not: null } },
        select: { answerId: true, resolvedStudentId: true },
      }),
    ]);
    const courseOfStudent = new Map(students.map((student) => [student.id, student.courseId]));
    const placedCourse = new Map(placed.map((hold) => [hold.answerId, courseOfStudent.get(hold.resolvedStudentId!) ?? null]));
    const roster = students.map((student) => ({ words: nameWords(student.name), courseId: student.courseId }));

    const matches: Record<string, string | null> = {};
    for (const { answerId, name } of answers) {
      if (placedCourse.has(answerId)) {
        matches[answerId] = placedCourse.get(answerId) ?? null;
        continue;
      }
      const wanted = nameWords(name);
      const found = new Set<string>();
      for (const student of roster) {
        if (fullMatch(wanted, student.words)) found.add(student.courseId);
        if (found.size > 1) break; // several courses: left without one
      }
      matches[answerId] = found.size === 1 ? [...found][0] : null;
    }

    const used = new Set(Object.values(matches).filter(Boolean));
    return NextResponse.json({
      ok: true,
      courses: courses.filter((course) => course.active || used.has(course.id)).map((course) => ({ id: course.id, name: course.name })),
      matches,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر قراءة دورات الطلاب.");
  }
}
