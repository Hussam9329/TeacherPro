export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import {
  isMissingDatabaseObjectError,
  routeErrorResponse,
} from "@/lib/route-helpers";
import {
  ensureTelegramSubmissionSchema,
  resetTelegramSubmissionSchemaEnsureCache,
  telegramSubmissionSchemaMessage,
} from "@/lib/telegram-submission-schema";

/**
 * إحصائيات مستلمات البوت من قاعدة البيانات مباشرة.
 * لا تعتمد على قائمة submissions المعروضة في الصفحة.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "correction.view");
  if (authError) return authError;

  try {
    const schemaReady = await ensureTelegramSubmissionSchema();
    if (!schemaReady.ok) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json({
        total: 0,
        pending: 0,
        inReview: 0,
        done: 0,
        manualReview: 0,
        totalPages: 0,
        migrationRequired: true,
        message: telegramSubmissionSchemaMessage,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }

    const [total, pending, inReview, done, manualReview, pages] =
      await Promise.all([
        db.telegramExamSubmission.count(),
        db.telegramExamSubmission.count({
          where: { status: "بانتظار التصحيح" },
        }),
        db.telegramExamSubmission.count({ where: { status: "قيد التصحيح" } }),
        db.telegramExamSubmission.count({ where: { status: "مكتمل" } }),
        db.telegramExamSubmission.count({
          where: { matchType: "manual_review" },
        }),
        db.telegramExamSubmission.aggregate({ _sum: { pageCount: true } }),
      ]);

    return NextResponse.json({
      total,
      pending,
      inReview,
      done,
      manualReview,
      totalPages: Number(pages._sum.pageCount || 0),
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isMissingDatabaseObjectError(error)) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json({
        total: 0,
        pending: 0,
        inReview: 0,
        done: 0,
        manualReview: 0,
        totalPages: 0,
        migrationRequired: true,
        message: telegramSubmissionSchemaMessage,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات مستلمات البوت من قاعدة البيانات.",
    );
  }
}
