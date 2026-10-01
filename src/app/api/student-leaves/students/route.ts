export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { buildStudentRegistrySearchWhere } from "@/lib/student-registry-filters-server";
import { studentLeaveListWhere } from "@/lib/student-leave-query-server";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import {
  normalizeStudentLeaveListFilter,
  summarizeStudentLeaves,
  summaryMatchesFilter,
  type StudentLeaveSummary,
} from "@/lib/student-leave-status";

const LIST_LIMIT = 60;
const SEARCH_STUDENT_LIMIT = 200;

const EMPTY_SUMMARY: StudentLeaveSummary = { total: 0, active: 0, upcoming: 0, ended: 0, latestDay: "", state: null };

/**
 * GET /api/student-leaves/students?filter=past|current|all&q=&studentId=
 * Student cards for «إدارة الإجازات»: every student with leaves, newest leave
 * first. A search (2+ letters) also finds students without any leave, so a
 * first leave can be added, and matches a leave's exam, reason or note.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;
  try {
    const params = new URL(req.url).searchParams;
    const filter = normalizeStudentLeaveListFilter(params.get("filter"));
    const studentId = String(params.get("studentId") || "").trim();
    const rawQuery = String(params.get("q") || "").trim().slice(0, 200);
    const query = rawQuery.length >= 2 ? rawQuery : "";
    const today = baghdadTodayKey();

    const result = await withDatabaseSchema(async () => {
      // Which students the list may show. null = every student with a leave.
      let candidateIds: string[] | null = null;
      if (studentId) {
        candidateIds = [studentId];
      } else if (query) {
        const studentWhere = buildStudentRegistrySearchWhere(query);
        const [byStudent, byLeave] = await Promise.all([
          db.student.findMany({
            where: studentWhere || undefined,
            select: { id: true },
            orderBy: [{ name: "asc" }, { code: "asc" }],
            take: SEARCH_STUDENT_LIMIT,
          }),
          db.studentLeave.findMany({
            where: await studentLeaveListWhere(new URLSearchParams({ q: query })),
            select: { studentId: true },
            distinct: ["studentId"],
            take: SEARCH_STUDENT_LIMIT,
          }),
        ]);
        candidateIds = Array.from(new Set([
          ...byStudent.map((row) => row.id),
          ...byLeave.map((row) => row.studentId),
        ]));
      }

      const leaves = candidateIds && candidateIds.length === 0
        ? []
        : await db.studentLeave.findMany({
            where: candidateIds ? { studentId: { in: candidateIds } } : {},
            select: {
              studentId: true,
              leaveType: true,
              date: true,
              dateFrom: true,
              dateTo: true,
              exam: { select: { date: true } },
            },
          });

      const leavesByStudent = new Map<string, typeof leaves>();
      for (const leave of leaves) {
        const list = leavesByStudent.get(leave.studentId) || [];
        list.push(leave);
        leavesByStudent.set(leave.studentId, list);
      }
      const summaries = new Map<string, StudentLeaveSummary>();
      for (const [id, studentLeaves] of leavesByStudent) {
        summaries.set(id, summarizeStudentLeaves(
          studentLeaves.map((leave) => ({ ...leave, examDate: leave.exam?.date || null })),
          today,
        ));
      }
      // A search or a direct student lookup also lists students with no leave yet.
      for (const id of candidateIds || []) {
        if (!summaries.has(id)) summaries.set(id, EMPTY_SUMMARY);
      }

      const rows = Array.from(summaries, ([id, summary]) => ({ id, summary }));
      const counts = {
        past: rows.filter((row) => summaryMatchesFilter(row.summary, "past")).length,
        current: rows.filter((row) => summaryMatchesFilter(row.summary, "current")).length,
        all: rows.length,
      };
      const matching = (studentId ? rows : rows.filter((row) => summaryMatchesFilter(row.summary, filter)))
        .sort((a, b) => b.summary.latestDay.localeCompare(a.summary.latestDay));
      const page = matching.slice(0, LIST_LIMIT);

      const students = page.length
        ? await db.student.findMany({
            where: { id: { in: page.map((row) => row.id) } },
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              telegram: true,
              username: true,
              studyType: true,
              courseId: true,
              opportunities: true,
              baseOpportunities: true,
              course: { select: { name: true } },
            },
          })
        : [];
      const withSnapshots = await attachStudentOpportunitySnapshots(students);
      const byId = new Map(withSnapshots.map((student) => [student.id, student]));
      return {
        counts,
        truncated: matching.length > page.length,
        rows: page.flatMap((row) => {
          const student = byId.get(row.id);
          if (!student) return [];
          return [{
            id: student.id,
            name: student.name,
            code: student.code,
            status: student.status,
            telegram: student.telegram || "",
            username: student.username || "",
            studyType: student.studyType || "",
            courseName: student.course?.name || "",
            opportunities: student.opportunities,
            opportunityLimit: student.opportunityLimit,
            leaves: row.summary,
          }];
        }),
      };
    }, "StudentLeave");

    return NextResponse.json(
      { today, filter, query, counts: result.counts, truncated: result.truncated, students: result.rows },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل قائمة الإجازات.");
  }
}
