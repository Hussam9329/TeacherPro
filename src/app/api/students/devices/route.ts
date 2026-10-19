export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requirePermission } from "@/lib/server-auth";

const PERMISSION = "students.edit";

/** Devices signed in to the student app for one student, newest first. */
export async function GET(req: NextRequest) {
  const denied = await requirePermission(req, PERMISSION);
  if (denied) return denied;
  try {
    const studentId = (new URL(req.url).searchParams.get("studentId") || "").trim();
    if (!studentId) return validationError("معرف الطالب مطلوب.");
    const devices = await db.studentDevice.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      devices: devices.map((d) => ({
        id: d.id,
        deviceName: d.deviceName,
        platform: d.platform,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        revokedAt: d.revokedAt,
        active: d.revokedAt === null,
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل أجهزة الطالب حالياً.");
  }
}

/** Revoke one device. Repeating the call is harmless. */
export async function POST(req: NextRequest) {
  const denied = await requirePermission(req, PERMISSION);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const deviceId = String(body.deviceId ?? "").trim();
    if (!deviceId) return validationError("معرف الجهاز مطلوب.");
    const result = await db.studentDevice.updateMany({
      where: { id: deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return NextResponse.json({ ok: true, revoked: result.count > 0 });
  } catch (error) {
    return routeErrorResponse(error, "تعذر إلغاء الجهاز حالياً.");
  }
}
