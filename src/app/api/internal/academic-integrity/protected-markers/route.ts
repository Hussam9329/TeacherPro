export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { buildMutationPreviewToken } from "@/lib/mutation-preview-token";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import {
  ensureProtectedGradeMarkers,
  reconcileProtectedGradeMarkersForExamEdit,
} from "@/lib/protected-grade-markers-server";
import { repairProtectedAbsencesForStudents } from "@/lib/grace-period-repair-server";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import {
  getExamEntryAvailability,
  isExamOnOrAfterStudentRegistration,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";
import { parseCourseIds } from "@/lib/exam-course-links";
import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";
import { studentLeaveAppliesToExam } from "@/lib/grade-classification";

type IntegrityCandidate = {
  gradeId: string;
  studentId: string;
  examId: string;
  currentStatus: string;
  expectedStatus: string;
};

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const authorization = String(req.headers.get("authorization") || "").trim();
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice("Bearer ".length), secret);
}

async function inspectCandidates(client: typeof db | Prisma.TransactionClient) {
  const grades = await client.grade.findMany({
    where: {
      status: { in: ["قبل تسجيل الطالب", "ضمن فترة السماح", "مجاز", "غائب"] },
      student: { status: { not: "مؤرشف" } },
    },
    orderBy: [{ examId: "asc" }, { studentId: "asc" }],
    select: {
      id: true,
      studentId: true,
      examId: true,
      status: true,
      student: {
        select: {
          courseId: true,
          mainSite: true,
          subSite: true,
          locationScope: true,
          createdAt: true,
          accountingGraceDays: true,
          gracePeriodStartDate: true,
          gracePeriodEndedAt: true,
        },
      },
      exam: {
        select: {
          id: true,
          courseIds: true,
          mainSite: true,
          date: true,
          fullMark: true,
          active: true,
          scheduledActivateAt: true,
        },
      },
    },
  });
  const studentIds = Array.from(new Set(grades.map((grade) => grade.studentId)));
  const leaves = studentIds.length
    ? await client.studentLeave.findMany({
        where: { studentId: { in: studentIds } },
        select: {
          id: true,
          studentId: true,
          examId: true,
          leaveType: true,
          date: true,
          dateFrom: true,
          dateTo: true,
        },
      })
    : [];
  const leavesByStudent = new Map<string, typeof leaves>();
  for (const leave of leaves) {
    const rows = leavesByStudent.get(leave.studentId) || [];
    rows.push(leave);
    leavesByStudent.set(leave.studentId, rows);
  }

  const candidates: IntegrityCandidate[] = [];
  for (const grade of grades) {
    const exam = grade.exam;
    const student = grade.student;
    const eligible =
      parseCourseIds(exam.courseIds).includes(student.courseId) &&
      studentMatchesExamMainSites(student, splitSelection(String(exam.mainSite || "")));
    const hasLeave = eligible && (leavesByStudent.get(grade.studentId) || []).some((leave) =>
      studentLeaveAppliesToExam(leave, exam),
    );
    const registered = eligible && isExamOnOrAfterStudentRegistration(student, exam);
    const withinGrace = registered && isExamWithinStudentGraceWindow(student, exam);
    let expectedStatus = grade.status;

    if (!eligible) {
      // Historical real absences are retained but ignored by the academic engine.
      // System-owned protected placeholders no longer belong to this exam scope.
      expectedStatus = grade.status === "غائب" ? "غائب" : "بدون سجل محمي";
    } else if (hasLeave) {
      expectedStatus = "مجاز";
    } else if (!registered) {
      expectedStatus = "قبل تسجيل الطالب";
    } else if (withinGrace) {
      expectedStatus = "ضمن فترة السماح";
    } else if (grade.status !== "غائب") {
      expectedStatus =
        getExamEntryAvailability(exam).available &&
        baghdadDateKey(exam.date) < baghdadTodayKey()
          ? "غائب"
          : "بدون سجل محمي";
    }

    if (expectedStatus !== grade.status) {
      candidates.push({
        gradeId: grade.id,
        studentId: grade.studentId,
        examId: grade.examId,
        currentStatus: grade.status,
        expectedStatus,
      });
    }
  }

  const previewToken = buildMutationPreviewToken("protected-grade-integrity", {
    candidates,
  });
  const byTransition: Record<string, number> = {};
  for (const candidate of candidates) {
    const key = `${candidate.currentStatus} -> ${candidate.expectedStatus}`;
    byTransition[key] = (byTransition[key] || 0) + 1;
  }
  return {
    candidates,
    previewToken,
    byTransition,
    studentIds: Array.from(new Set(candidates.map((row) => row.studentId))),
    examIds: Array.from(new Set(candidates.map((row) => row.examId))),
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "غير مصرح بفحص سلامة الحالات المحمية." }, { status: 401 });
  }
  try {
    const preview = await inspectCandidates(db);
    return NextResponse.json({
      ok: true,
      dryRun: true,
      candidateCount: preview.candidates.length,
      affectedStudents: preview.studentIds.length,
      affectedExams: preview.examIds.length,
      byTransition: preview.byTransition,
      previewToken: preview.previewToken,
      sample: preview.candidates.slice(0, 50),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر فحص سلامة الحالات المحمية.");
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "غير مصرح بإصلاح الحالات المحمية." }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const suppliedToken = String(body.previewToken || "").trim();
    if (!suppliedToken) {
      return NextResponse.json(
        { error: "يجب تشغيل المعاينة أولاً وإرسال previewToken نفسه قبل الإصلاح." },
        { status: 409 },
      );
    }

    const result = await withSerializableTransaction(async (tx) => {
      const preview = await inspectCandidates(tx);
      if (preview.previewToken !== suppliedToken) {
        return { stalePreview: true, preview } as const;
      }
      if (!preview.candidates.length) {
        return { stalePreview: false, preview, repaired: 0, recalculatedStudents: 0 } as const;
      }

      let repaired = 0;
      let recalculatedStudents = 0;
      for (const examId of preview.examIds) {
        const examStudentIds = Array.from(
          new Set(
            preview.candidates
              .filter((candidate) => candidate.examId === examId)
              .map((candidate) => candidate.studentId),
          ),
        );
        if (!examStudentIds.length) continue;
        const reconciliation = await reconcileProtectedGradeMarkersForExamEdit(tx, examId, {
          studentIds: examStudentIds,
        });
        repaired +=
          reconciliation.convertedToExcused +
          reconciliation.restoredFromLeaveBackup +
          reconciliation.removedStaleMarkers;
        await ensureProtectedGradeMarkers(tx, {
          examIds: [examId],
          studentIds: examStudentIds,
          includeAbsent: true,
        });
      }
      await repairProtectedAbsencesForStudents(tx, preview.studentIds);
      const recalculation = await recalculateStudentsAcademicState(preview.studentIds, { tx });
      recalculatedStudents = recalculation.students.length;
      await tx.auditLog.create({
        data: {
          module: "الامتحانات",
          action: "إصلاح سلامة الحالات المحمية بعد التدقيق",
          details: `مرشحون ${preview.candidates.length} - امتحانات ${preview.examIds.length} - طلاب ${preview.studentIds.length}`,
          userName: "TeacherPro - Academic Integrity Repair",
        },
      });
      return { stalePreview: false, preview, repaired, recalculatedStudents } as const;
    });

    if (result.stalePreview) {
      return NextResponse.json(
        {
          error: "تغيرت البيانات بعد المعاينة. لم يُطبق أي إصلاح؛ شغّل GET مجدداً ثم أكد بالرمز الجديد.",
          requiresFreshPreview: true,
          candidateCount: result.preview.candidates.length,
          previewToken: result.preview.previewToken,
          byTransition: result.preview.byTransition,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      repaired: result.repaired,
      candidateCount: result.preview.candidates.length,
      affectedStudents: result.preview.studentIds.length,
      affectedExams: result.preview.examIds.length,
      recalculatedStudents: result.recalculatedStudents,
      byTransition: result.preview.byTransition,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر إصلاح سلامة الحالات المحمية.");
  }
}
