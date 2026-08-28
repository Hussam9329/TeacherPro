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
  previewStudentsAcademicState,
  recalculateStudentsAcademicState,
} from "@/lib/academic-recalculate-server";

type Client = typeof db | Prisma.TransactionClient;

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const authorization = String(req.headers.get("authorization") || "").trim();
  return Boolean(
    secret &&
      authorization.startsWith("Bearer ") &&
      safeEqual(authorization.slice("Bearer ".length), secret),
  );
}

async function inspectCandidates(
  client: Client,
  transaction?: Prisma.TransactionClient,
) {
  const stored = await client.student.findMany({
    where: {
      status: { not: "مؤرشف" },
      OR: [{ status: "مفصول" }, { opportunities: 0 }],
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      status: true,
      opportunities: true,
      dismissalType: true,
      dismissalReason: true,
    },
  });
  const projectedById = new Map<string, Awaited<ReturnType<typeof previewStudentsAcademicState>>["students"][number]>();
  for (let offset = 0; offset < stored.length; offset += 250) {
    const batch = stored.slice(offset, offset + 250);
    const preview = await previewStudentsAcademicState(
      batch.map((student) => student.id),
      { tx: transaction },
    );
    for (const student of preview.students) projectedById.set(student.id, student);
  }
  const candidates = stored.flatMap((student) => {
    const projected = projectedById.get(student.id);
    if (!projected) return [];
    const current = {
      status: student.status,
      opportunities: student.opportunities,
      dismissalType: student.dismissalType || "",
      dismissalReason: student.dismissalReason || "",
    };
    const next = {
      status: projected.status,
      opportunities: projected.opportunities,
      dismissalType: projected.dismissalType || "",
      dismissalReason: projected.dismissalReason || "",
    };
    return JSON.stringify(current) === JSON.stringify(next)
      ? []
      : [{ studentId: student.id, current, projected: next }];
  });
  return {
    candidates,
    studentIds: candidates.map((candidate) => candidate.studentId),
    previewToken: buildMutationPreviewToken("zero-balance-law", { candidates }),
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "غير مصرح بمعاينة قانون رصيد الفرص." }, { status: 401 });
  }
  try {
    const preview = await inspectCandidates(db);
    return NextResponse.json({
      ok: true,
      dryRun: true,
      candidateCount: preview.candidates.length,
      previewToken: preview.previewToken,
      sample: preview.candidates.slice(0, 50),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر معاينة تسوية قانون رصيد الفرص.");
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "غير مصرح بتطبيق قانون رصيد الفرص." }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const suppliedToken = String(body.previewToken || "").trim();
    if (!suppliedToken) {
      return NextResponse.json(
        { error: "يجب تشغيل المعاينة أولاً وإرسال previewToken نفسه قبل التطبيق." },
        { status: 409 },
      );
    }
    const result = await withSerializableTransaction(async (tx) => {
      const preview = await inspectCandidates(tx, tx);
      if (preview.previewToken !== suppliedToken) return { stale: true, preview } as const;
      const recalculation = await recalculateStudentsAcademicState(preview.studentIds, { tx });
      await tx.auditLog.create({
        data: {
          module: "الفرص",
          action: "تسوية قانون الرصيد الصفري بعد معاينة مؤكدة",
          details: `طلاب ${preview.studentIds.length}`,
          userName: "TeacherPro - Zero Balance Reconciliation",
        },
      });
      return { stale: false, preview, recalculated: recalculation.students.length } as const;
    });
    if (result.stale) {
      return NextResponse.json(
        {
          error: "تغيرت البيانات بعد المعاينة. لم يُطبق شيء؛ شغّل المعاينة مجدداً.",
          requiresFreshPreview: true,
          candidateCount: result.preview.candidates.length,
          previewToken: result.preview.previewToken,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      candidateCount: result.preview.candidates.length,
      recalculatedStudents: result.recalculated,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تطبيق تسوية قانون رصيد الفرص.");
  }
}
