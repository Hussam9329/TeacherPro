export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthPrincipal, oversees, type AuthPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { writeAuditLog } from "@/lib/audit-log-server";
import { TEXT_SHORTCUTS_MAX, readTextShortcutInput } from "@/lib/text-shortcuts";

const LOG_MODULE = "الاختصارات";
const SELECT = { id: true, label: true, text: true, sortOrder: true, updatedByName: true, updatedAt: true } as const;
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** «اختصارات» is for the admin («مدير عام») and the supervisors. */
async function requireOverseer(req: NextRequest) {
  const principal = await getAuthPrincipal(req);
  if (!principal) return NextResponse.json({ error: "سجّل الدخول أولاً." }, { status: 401 });
  if (!oversees(principal)) return NextResponse.json({ error: "الاختصارات للمدير العام والمشرفين فقط." }, { status: 403 });
  return principal;
}

const actorName = (principal: AuthPrincipal) => principal.name || principal.username || "مستخدم";

const readId = (value: unknown) => (typeof value === "string" && ID_PATTERN.test(value) ? value : "");

const listShortcuts = () =>
  db.textShortcut.findMany({ select: SELECT, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function GET(req: NextRequest) {
  const principal = await requireOverseer(req);
  if (principal instanceof NextResponse) return principal;
  try {
    const shortcuts = await withDatabaseSchema(listShortcuts, "TextShortcut");
    return NextResponse.json({ shortcuts }, { headers: NO_STORE });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل الاختصارات.");
  }
}

/**
 * Adds a button at the end. The window sends its own id, so a request sent
 * again after a lost answer returns the same button instead of a second one.
 */
export async function POST(req: NextRequest) {
  const principal = await requireOverseer(req);
  if (principal instanceof NextResponse) return principal;
  const body = await req.json().catch(() => null);
  const input = readTextShortcutInput(body);
  if ("error" in input) return validationError(input.error);
  const id = readId((body as Record<string, unknown> | null)?.id) || undefined;
  try {
    const result = await withDatabaseSchema(async () => {
      try {
        return await db.$transaction(async (tx) => {
          if (id) {
            const existing = await tx.textShortcut.findUnique({ where: { id }, select: SELECT });
            if (existing) return { shortcut: existing };
          }
          if ((await tx.textShortcut.count()) >= TEXT_SHORTCUTS_MAX) {
            return { error: `وصلت للحد (${TEXT_SHORTCUTS_MAX} زر). احذف زر قبل ما تضيف.` };
          }
          const last = await tx.textShortcut.aggregate({ _max: { sortOrder: true } });
          const shortcut = await tx.textShortcut.create({
            data: {
              ...(id ? { id } : {}),
              ...input,
              sortOrder: (last._max.sortOrder ?? -1) + 1,
              createdById: principal.id,
              createdByName: actorName(principal),
              updatedById: principal.id,
              updatedByName: actorName(principal),
            },
            select: SELECT,
          });
          await writeAuditLog(principal, LOG_MODULE, "اضافة اختصار", input, { tx });
          return { shortcut };
        });
      } catch (error) {
        // The same request arrived twice at once: the first one saved it.
        if (!id || !isUniqueViolation(error)) throw error;
        const shortcut = await db.textShortcut.findUnique({ where: { id }, select: SELECT });
        if (!shortcut) throw error;
        return { shortcut };
      }
    }, "TextShortcut");
    if ("error" in result) return validationError(result.error ?? "", 409);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ الزر.");
  }
}

/**
 * `{ id, label, text, expectedUpdatedAt }` edits one button; a button someone
 * else changed after this window loaded it is refused instead of overwritten.
 * `{ order: [ids], expectedRevision }` saves the order of every button, only
 * while the saved order is still the one the window shows (its ids, joined).
 */
export async function PUT(req: NextRequest) {
  const principal = await requireOverseer(req);
  if (principal instanceof NextResponse) return principal;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const rawOrder = body?.order;
    if (Array.isArray(rawOrder)) {
      const order = rawOrder.map(readId);
      if (order.some((id) => !id) || new Set(order).size !== order.length) return validationError("ترتيب الأزرار غير صحيح.");
      const expectedRevision = typeof body?.expectedRevision === "string" ? body.expectedRevision : "";
      const result = await withDatabaseSchema(() => db.$transaction(async (tx) => {
        const saved = await tx.textShortcut.findMany({
          select: { id: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });
        const savedIds = new Set(saved.map((row) => row.id));
        if (saved.map((row) => row.id).join(",") !== expectedRevision) return { changed: true };
        if (saved.length !== order.length || order.some((id) => !savedIds.has(id))) return { changed: true };
        // Raw, so «آخر تعديل» stays the last change of the text itself and an
        // open edit elsewhere is not refused because of a new order.
        for (const [index, id] of order.entries()) {
          await tx.$executeRaw`UPDATE "TextShortcut" SET "sortOrder" = ${index} WHERE "id" = ${id}`;
        }
        await writeAuditLog(principal, LOG_MODULE, "ترتيب الاختصارات", { count: order.length }, { tx });
        return { changed: false };
      }, { timeout: 15_000 }), "TextShortcut");
      if (result.changed) return validationError("شخص ثاني غيّر الأزرار قبلك. حدّث القائمة ورتّب مرة ثانية.", 409);
      return NextResponse.json({ shortcuts: await listShortcuts() }, { headers: NO_STORE });
    }

    const id = readId(body?.id);
    if (!id) return validationError("الزر غير محدد.");
    const input = readTextShortcutInput(body);
    if ("error" in input) return validationError(input.error);
    const loadedAt = typeof body?.expectedUpdatedAt === "string" ? Date.parse(body.expectedUpdatedAt) : NaN;
    const result = await withDatabaseSchema(() => db.$transaction(async (tx) => {
      const before = await tx.textShortcut.findUnique({ where: { id }, select: SELECT });
      if (!before) return { status: 404 as const };
      // Nothing to change, e.g. the same save sent again after a lost answer.
      if (before.label === input.label && before.text === input.text) return { status: 200 as const, shortcut: before };
      if (Number.isFinite(loadedAt) && before.updatedAt.getTime() !== loadedAt) return { status: 409 as const };
      const changed = await tx.textShortcut.updateMany({
        where: { id, updatedAt: before.updatedAt },
        data: { ...input, updatedById: principal.id, updatedByName: actorName(principal) },
      });
      if (!changed.count) return { status: 409 as const };
      const shortcut = await tx.textShortcut.findUniqueOrThrow({ where: { id }, select: SELECT });
      await writeAuditLog(principal, LOG_MODULE, "تعديل اختصار", { before: { label: before.label, text: before.text }, after: input }, { tx });
      return { status: 200 as const, shortcut };
    }), "TextShortcut");
    if (result.status === 404) return validationError("الزر انحذف. حدّث القائمة.", 404);
    if (result.status === 409) return validationError("شخص ثاني عدّل هذا الزر قبلك. حدّث القائمة وعدّله مرة ثانية.", 409);
    return NextResponse.json({ shortcut: result.shortcut }, { headers: NO_STORE });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ التعديل.");
  }
}

/** Deleting a button that is already gone is not an error. */
export async function DELETE(req: NextRequest) {
  const principal = await requireOverseer(req);
  if (principal instanceof NextResponse) return principal;
  const id = readId(new URL(req.url).searchParams.get("id"));
  if (!id) return validationError("الزر غير محدد.");
  try {
    await withDatabaseSchema(() => db.$transaction(async (tx) => {
      const before = await tx.textShortcut.findUnique({ where: { id }, select: SELECT });
      if (!before) return;
      const removed = await tx.textShortcut.deleteMany({ where: { id } });
      if (removed.count) await writeAuditLog(principal, LOG_MODULE, "حذف اختصار", { label: before.label, text: before.text }, { tx });
    }), "TextShortcut");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حذف الزر.");
  }
}
