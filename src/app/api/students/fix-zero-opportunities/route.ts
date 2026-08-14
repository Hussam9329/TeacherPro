export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { validationError, routeErrorResponse } from "@/lib/route-helpers";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { buildMutationPreviewToken } from "@/lib/mutation-preview-token";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";

type RepairClient = typeof db | Prisma.TransactionClient;

class OpportunityRepairIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityRepairIntegrityError";
  }
}

function repairErrorResponse(error: unknown) {
  if (error instanceof OpportunityRepairIntegrityError) {
    return validationError(error.message, 409);
  }
  return routeErrorResponse(
    error,
    "تعذر إكمال إصلاح فرص الطلاب. لم يتم تغيير حالة أي طالب.",
  );
}

async function buildRepairPreview(client: RepairClient = db) {
  const activeLinks = await client.courseChapter.findMany({
    where: { active: true, archived: false },
    select: {
      id: true,
      courseId: true,
      chapterId: true,
      course: { select: { name: true } },
      chapter: { select: { name: true, opportunities: true } },
    },
  });

  const linksByCourse = new Map<string, typeof activeLinks>();
  for (const link of activeLinks) {
    const links = linksByCourse.get(link.courseId) || [];
    links.push(link);
    linksByCourse.set(link.courseId, links);
  }

  const eligibleLinks = Array.from(linksByCourse.values())
    .filter(
      (links) =>
        links.length === 1 &&
        Math.max(0, Math.trunc(Number(links[0].chapter.opportunities || 0))) > 0,
    )
    .map((links) => links[0]);
  const eligibleCourseIds = eligibleLinks.map((link) => link.courseId);
  const linkByCourseId = new Map(
    eligibleLinks.map((link) => [link.courseId, link]),
  );

  const [candidateRows, skippedDismissed, skippedArchived] = await Promise.all([
    client.student.findMany({
      where: {
        courseId: { in: eligibleCourseIds },
        status: "نشط",
        opportunities: 0,
        baseOpportunities: 0,
      },
      select: {
        id: true,
        name: true,
        code: true,
        courseId: true,
        status: true,
        opportunities: true,
        baseOpportunities: true,
      },
      orderBy: { id: "asc" },
    }),
    client.student.count({
      where: { courseId: { in: eligibleCourseIds }, status: "مفصول" },
    }),
    client.student.count({
      where: { courseId: { in: eligibleCourseIds }, status: "مؤرشف" },
    }),
  ]);

  const candidates = candidateRows.flatMap((student) => {
    const link = linkByCourseId.get(student.courseId);
    if (!link) return [];
    return [
      {
        studentId: student.id,
        studentName: student.name,
        studentCode: student.code,
        courseId: student.courseId,
        courseName: link.course.name,
        chapterId: link.chapterId,
        chapterName: link.chapter.name,
        currentOpportunities: student.opportunities,
        currentBaseOpportunities: student.baseOpportunities,
        nextOpportunities: Math.max(
          0,
          Math.trunc(Number(link.chapter.opportunities || 0)),
        ),
      },
    ];
  });

  const perCourse = eligibleLinks
    .map((link) => ({
      courseId: link.courseId,
      courseName: link.course.name,
      chapterId: link.chapterId,
      chapterName: link.chapter.name,
      chapterOpportunities: Math.max(
        0,
        Math.trunc(Number(link.chapter.opportunities || 0)),
      ),
      affectedStudents: candidates.filter(
        (candidate) => candidate.courseId === link.courseId,
      ).length,
    }))
    .filter((course) => course.affectedStudents > 0);

  const snapshot = {
    activeLinks: activeLinks
      .map((link) => ({
        id: link.id,
        courseId: link.courseId,
        chapterId: link.chapterId,
        opportunities: link.chapter.opportunities,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    candidates: candidateRows.map((student) => ({
      id: student.id,
      courseId: student.courseId,
      status: student.status,
      opportunities: student.opportunities,
      baseOpportunities: student.baseOpportunities,
    })),
  };

  return {
    canExecute: candidates.length > 0,
    blockingMessage:
      candidates.length > 0
        ? null
        : "لا يوجد طلاب نشطون بحالة 0/0 يحتاجون هذا الإصلاح الآمن.",
    impact: {
      eligibleCourses: eligibleLinks.length,
      conflictingCourses: Array.from(linksByCourse.values()).filter(
        (links) => links.length > 1,
      ).length,
      zeroOpportunityCourses: Array.from(linksByCourse.values()).filter(
        (links) =>
          links.length === 1 &&
          Math.max(
            0,
            Math.trunc(Number(links[0].chapter.opportunities || 0)),
          ) === 0,
      ).length,
      affectedStudents: candidates.length,
      skippedDismissed,
      skippedArchived,
    },
    perCourse,
    sampleStudents: candidates.slice(0, 12).map((candidate) => ({
      studentId: candidate.studentId,
      studentName: candidate.studentName,
      studentCode: candidate.studentCode,
      courseName: candidate.courseName,
      nextOpportunities: candidate.nextOpportunities,
    })),
    message:
      candidates.length > 0
        ? `سيُعاد رصيد ${candidates.length} طالب نشط من 0/0 إلى رصيد الفصل النشط، من دون تغيير حالتهم أو إعادة احتساب بقية النظام.`
        : "المعاينة لم تجد أي طالب نشط 0/0 يمكن إصلاحه تلقائياً بأمان.",
    previewToken: buildMutationPreviewToken(
      "safe-zero-opportunities-repair",
      snapshot,
    ),
    source: "database" as const,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Emergency-safe repair for the single unambiguous anomaly only: an active
 * student with 0/0 in a course that has exactly one active, positive chapter.
 * A database preview and matching confirmation token are mandatory. Dismissed
 * and archived students are never touched, status fields are never written,
 * and no global academic recalculation runs from this endpoint.
 */
export async function PATCH(req: NextRequest) {
  const authError = await requirePermission(req, "system.maintenance");
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(
    req,
    API_RATE_LIMITS.studentOpportunitySync,
  );
  if (rateLimitError) return rateLimitError;

  try {
    const body = await req.json().catch(() => ({}));
    const previewOnly = body.previewOnly === true;
    const confirmImpact = body.confirmImpact === true;
    const previewToken = String(body.previewToken || "").trim();

    if (previewOnly) {
      const preview = await withSerializableTransaction((tx) =>
        buildRepairPreview(tx),
      );
      return NextResponse.json({ preview });
    }

    if (!confirmImpact || !previewToken) {
      return validationError(
        "يجب فتح المعاينة الحالية وتأكيد أثرها قبل تنفيذ الإصلاح.",
        409,
      );
    }

    const result = await withSerializableTransaction(async (tx) => {
      const currentPreview = await buildRepairPreview(tx);
      if (currentPreview.previewToken !== previewToken) {
        throw new OpportunityRepairIntegrityError(
          "تغيرت بيانات الطلاب أو الفصول بعد المعاينة. أُوقف الإصلاح قبل أي تعديل؛ أعد فتح المعاينة.",
        );
      }
      if (!currentPreview.canExecute) {
        throw new OpportunityRepairIntegrityError(
          currentPreview.blockingMessage || "لا توجد بيانات قابلة للإصلاح.",
        );
      }

      let fixedTotal = 0;
      for (const course of currentPreview.perCourse) {
        const candidates = await tx.student.findMany({
          where: {
            courseId: course.courseId,
            status: "نشط",
            opportunities: 0,
            baseOpportunities: 0,
          },
          select: { id: true },
        });
        const expectedCount = course.affectedStudents;
        if (candidates.length !== expectedCount) {
          throw new OpportunityRepairIntegrityError(
            "تغيرت قائمة الطلاب أثناء التنفيذ. أُلغيت العملية بالكامل.",
          );
        }
        const update = await tx.student.updateMany({
          where: {
            id: { in: candidates.map((student) => student.id) },
            courseId: course.courseId,
            status: "نشط",
            opportunities: 0,
            baseOpportunities: 0,
          },
          data: {
            opportunities: course.chapterOpportunities,
            baseOpportunities: course.chapterOpportunities,
          },
        });
        if (update.count !== expectedCount) {
          throw new OpportunityRepairIntegrityError(
            "تغير أحد الطلاب أثناء التنفيذ. أُلغيت العملية بالكامل.",
          );
        }
        fixedTotal += update.count;
      }

      return {
        fixedTotal,
        perCourse: currentPreview.perCourse,
      };
    });

    await writeRequestAuditLog(
      req,
      "الطلاب",
      "إصلاح آمن ومؤكد لطلاب 0/0 النشطين فقط",
      {
        fixedTotal: result.fixedTotal,
        perCourse: result.perCourse,
        statusFieldsChanged: false,
        globalRecalculation: false,
      },
    );

    return NextResponse.json({
      ok: true,
      message: `تم إصلاح ${result.fixedTotal} طالب نشط فقط، من دون تغيير أي حالة أو إعادة احتساب شامل.`,
      fixedTotal: result.fixedTotal,
      perCourse: result.perCourse,
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return repairErrorResponse(error);
  }
}
