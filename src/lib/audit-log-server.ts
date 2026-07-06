import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthPrincipal, type AuthPrincipal } from "@/lib/server-auth";

type AuditClient = typeof db | Prisma.TransactionClient;
type AuditDetails = Record<string, unknown> | string | number | boolean | null | undefined;

const SENSITIVE_KEY_PATTERN = /password|secret|token|hash|cookie|authorization|otp|pin/i;

function safeStringify(value: AuditDetails): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value.slice(0, 1200);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(
      value,
      (key, item) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) return "[محجوب]";
        if (typeof item === "string" && item.length > 500) return `${item.slice(0, 500)}…`;
        return item;
      },
      0,
    ).slice(0, 1200);
  } catch {
    return "تعذر تحويل تفاصيل العملية إلى نص آمن.";
  }
}

function principalName(principal: AuthPrincipal): string {
  return principal.name || principal.username || "مستخدم";
}

export async function writeAuditLog(
  principal: AuthPrincipal | null | undefined,
  module: string,
  action: string,
  details?: AuditDetails,
  options: { tx?: Prisma.TransactionClient } = {},
) {
  if (!principal) return null;
  const client: AuditClient = options.tx || db;
  try {
    return await client.auditLog.create({
      data: {
        module: module.trim().slice(0, 60),
        action: action.trim().slice(0, 120),
        details: safeStringify(details),
        userId: principal.id,
        userName: principalName(principal),
      },
    });
  } catch (error) {
    console.warn("[audit-log-server] failed to write audit log:", error);
    return null;
  }
}

export async function writeRequestAuditLog(
  req: NextRequest,
  module: string,
  action: string,
  details?: AuditDetails,
  options: { tx?: Prisma.TransactionClient } = {},
) {
  const principal = await getAuthPrincipal(req);
  return writeAuditLog(principal, module, action, details, options);
}

export async function writeSystemAuditLog(
  module: string,
  action: string,
  details?: AuditDetails,
  options: { tx?: Prisma.TransactionClient; userName?: string } = {},
) {
  const client: AuditClient = options.tx || db;
  try {
    return await client.auditLog.create({
      data: {
        module: module.trim().slice(0, 60),
        action: action.trim().slice(0, 120),
        details: safeStringify(details),
        userId: null,
        userName: options.userName || "TeacherPro Server",
      },
    });
  } catch (error) {
    console.warn("[audit-log-server] failed to write system audit log:", error);
    return null;
  }
}

export function confirmationRequiredResponse(message: string, details?: AuditDetails) {
  return NextResponse.json(
    {
      error: message,
      requiresConfirmation: true,
      confirmationParam: "confirmImpact",
      details: safeStringify(details),
    },
    { status: 409 },
  );
}

export function isConfirmed(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1 || value === "yes";
}
