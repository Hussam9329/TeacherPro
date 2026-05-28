import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPhoneValidationError, sanitizePhoneInput } from "@/lib/format";
import {
  getStudentDuplicateMessage,
  getStudentUniqueKeys,
  isValidAccountingGraceDays,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import { getRequiredTextError } from "@/lib/validation";


function getPrismaStudentErrorResponse(error: unknown) {
  const prismaError = error as { code?: string; meta?: { target?: unknown } };
  if (prismaError.code === "P2002") {
    const targetValue = prismaError.meta?.target;
    const target = Array.isArray(targetValue) ? targetValue.join(",") : String(targetValue ?? "");
    if (target.includes("telegramKey")) {
      return NextResponse.json({ error: "معرف التليكرام مسجل مسبقاً لطالب آخر" }, { status: 409 });
    }
    if (target.includes("phoneKey")) {
      return NextResponse.json({ error: "رقم الهاتف مسجل مسبقاً لطالب آخر" }, { status: 409 });
    }
    if (target.includes("nameKey")) {
      return NextResponse.json({ error: "اسم الطالب مسجل مسبقاً لطالب آخر" }, { status: 409 });
    }
    return NextResponse.json({ error: "توجد بيانات فريدة مسجلة مسبقاً" }, { status: 409 });
  }

  console.error("[API] /api/students error:", error);
  return NextResponse.json({ error: "تعذر حفظ بيانات الطالب حالياً. تحقق من الاتصال ثم حاول مرة أخرى." }, { status: 500 });
}

export async function GET() {
  const students = await db.student.findMany({
    orderBy: { createdAt: "desc" },
    include: { course: true, group: true },
  });
  return NextResponse.json({ students });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const phoneError = getPhoneValidationError(
    String(body.phone ?? ""),
    "رقم الطالب",
    true,
  );
  if (phoneError)
    return NextResponse.json({ error: phoneError }, { status: 400 });

  const parentPhoneError = getPhoneValidationError(
    String(body.parentPhone ?? ""),
    "رقم ولي الأمر",
    true,
  );
  if (parentPhoneError)
    return NextResponse.json({ error: parentPhoneError }, { status: 400 });

  const requiredFields = [
    ["name", "اسم الطالب مطلوب"],
    ["school", "اسم المدرسة مطلوب"],
    ["gender", "الجنس مطلوب"],
    ["courseType", "نوع الدورة مطلوب"],
    ["courseId", "الدورة مطلوبة"],
    ["groupId", "المجموعة الإلكترونية مطلوبة"],
    ["mainSite", "الموقع الرئيسي مطلوب"],
    ["createdAt", "تاريخ إضافة الطالب مطلوب"],
    ["accountingStart", "فترة السماح مطلوبة"],
  ] as const;
  const missingField = requiredFields.find(
    ([key]) => !String(body[key] ?? "").trim(),
  );
  if (missingField)
    return NextResponse.json({ error: missingField[1] }, { status: 400 });

  const nameError = getRequiredTextError(String(body.name ?? ""), "اسم الطالب");
  if (nameError)
    return NextResponse.json({ error: nameError }, { status: 400 });

  const requiresSubSite =
    body.courseType === "خاصة" || body.mainSite === "محافظات";
  if (requiresSubSite && !String(body.subSite ?? "").trim()) {
    return NextResponse.json({ error: "الموقع الفرعي مطلوب" }, { status: 400 });
  }

  if (body.courseType === "خاصة") {
    if (!String(body.receiptNo ?? "").trim())
      return NextResponse.json({ error: "رقم الوصل مطلوب" }, { status: 400 });
    if (!String(body.codeSequence ?? "").trim())
      return NextResponse.json({ error: "تسلسل الكود مطلوب" }, { status: 400 });
    if (String(body.totalAmount ?? "").trim() === "")
      return NextResponse.json(
        { error: "المبلغ الكلي مطلوب" },
        { status: 400 },
      );
    if (String(body.paidAmount ?? "").trim() === "")
      return NextResponse.json(
        { error: "المبلغ المدفوع مطلوب" },
        { status: 400 },
      );
    if (Number(body.paidAmount || 0) > Number(body.totalAmount || 0))
      return NextResponse.json(
        { error: "المبلغ المدفوع لا يمكن أن يكون أكبر من المبلغ الكلي" },
        { status: 400 },
      );
    if (!Array.isArray(body.installments) || body.installments.length === 0)
      return NextResponse.json(
        { error: "بيانات الدفعة الأولى مطلوبة" },
        { status: 400 },
      );
  }

  const duplicateSource = await db.student.findMany({
    select: { id: true, name: true, phone: true, telegram: true },
  });
  const duplicateMessage = getStudentDuplicateMessage(duplicateSource, {
    name: body.name,
    phone: body.phone,
    telegram: body.telegram,
  });
  if (duplicateMessage)
    return NextResponse.json({ error: duplicateMessage }, { status: 409 });

  if (!isValidAccountingGraceDays(String(body.accountingStart ?? ""))) {
    return NextResponse.json(
      { error: "فترة السماح يجب أن تكون رقماً من 0 إلى 30" },
      { status: 400 },
    );
  }

  const uniqueKeys = getStudentUniqueKeys({
    name: body.name,
    phone: body.phone,
    telegram: body.telegram,
  });

  try {
    const student = await db.student.create({
      data: {
      id: body.id,
      name: String(body.name ?? "").trim(),
      school: String(body.school ?? "").trim(),
      gender: body.gender,
      phone: sanitizePhoneInput(String(body.phone ?? "")),
      parentPhone: sanitizePhoneInput(String(body.parentPhone ?? "")),
      telegram: sanitizeTelegramInput(String(body.telegram ?? "")),
      courseType: body.courseType,
      mainSite: body.mainSite,
      subSite: body.subSite,
      receiptNo: body.receiptNo,
      codeSequence: body.codeSequence,
      code: body.code,
      totalAmount: Number(body.totalAmount || 0),
      paidAmount: Number(body.paidAmount || 0),
      installments: JSON.stringify(body.installments || []),
      status: body.status || "نشط",
      dismissalType: body.dismissalType,
      dismissalReason: body.dismissalReason,
      createdAt: body.createdAt ? new Date(body.createdAt) : new Date(),
      accountingStart: body.accountingStart
        ? Number(body.accountingStart)
        : undefined,
      opportunities: Number(body.opportunities || 0),
      baseOpportunities: Number(body.baseOpportunities || 0),
      courseId: body.courseId,
        ...uniqueKeys,
        groupId: body.groupId || undefined,
      },
    });
    return NextResponse.json({ student }, { status: 201 });
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id)
    return NextResponse.json({ error: "تعذر تحديد الطالب المطلوب" }, { status: 400 });
  if (data.name !== undefined) {
    const nameError = getRequiredTextError(
      String(data.name ?? ""),
      "اسم الطالب",
    );
    if (nameError)
      return NextResponse.json({ error: nameError }, { status: 400 });
    data.name = String(data.name ?? "").trim();
  }
  if (data.phone !== undefined) {
    const phoneError = getPhoneValidationError(
      String(data.phone ?? ""),
      "رقم الطالب",
      true,
    );
    if (phoneError)
      return NextResponse.json({ error: phoneError }, { status: 400 });
    data.phone = sanitizePhoneInput(String(data.phone ?? ""));
  }
  if (data.parentPhone !== undefined) {
    const parentPhoneError = getPhoneValidationError(
      String(data.parentPhone ?? ""),
      "رقم ولي الأمر",
      true,
    );
    if (parentPhoneError)
      return NextResponse.json({ error: parentPhoneError }, { status: 400 });
    data.parentPhone = sanitizePhoneInput(String(data.parentPhone ?? ""));
  }
  if (data.telegram !== undefined)
    data.telegram = sanitizeTelegramInput(String(data.telegram ?? ""));
  if (
    data.name !== undefined ||
    data.phone !== undefined ||
    data.telegram !== undefined
  ) {
    const duplicateSource = await db.student.findMany({
      select: { id: true, name: true, phone: true, telegram: true },
    });
    const current = await db.student.findUnique({
      where: { id },
      select: { name: true, phone: true, telegram: true },
    });
    const duplicateMessage = getStudentDuplicateMessage(
      duplicateSource,
      {
        id,
        name: data.name ?? current?.name,
        phone: data.phone ?? current?.phone,
        telegram: data.telegram ?? current?.telegram,
      },
      id,
    );
    if (duplicateMessage)
      return NextResponse.json({ error: duplicateMessage }, { status: 409 });
  }
  const updateUniqueKeys = getStudentUniqueKeys({
    name: data.name ?? undefined,
    phone: data.phone ?? undefined,
    telegram: data.telegram ?? undefined,
  });
  if (data.name !== undefined) data.nameKey = updateUniqueKeys.nameKey;
  if (data.phone !== undefined) data.phoneKey = updateUniqueKeys.phoneKey;
  if (data.telegram !== undefined) data.telegramKey = updateUniqueKeys.telegramKey;

  if (data.createdAt !== undefined)
    data.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
  if (data.totalAmount !== undefined)
    data.totalAmount = Number(data.totalAmount || 0);
  if (data.paidAmount !== undefined)
    data.paidAmount = Number(data.paidAmount || 0);
  if (data.installments !== undefined)
    data.installments = JSON.stringify(data.installments || []);
  if (data.accountingStart !== undefined) {
    if (!isValidAccountingGraceDays(String(data.accountingStart ?? ""))) {
      return NextResponse.json(
        { error: "فترة السماح يجب أن تكون رقماً من 0 إلى 30" },
        { status: 400 },
      );
    }
    data.accountingStart = data.accountingStart
      ? Number(data.accountingStart)
      : null;
  }
  if (data.opportunities !== undefined)
    data.opportunities = Number(data.opportunities);
  if (data.baseOpportunities !== undefined)
    data.baseOpportunities = Number(data.baseOpportunities);
  try {
    const student = await db.student.update({ where: { id }, data });
    return NextResponse.json({ student });
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "تعذر تحديد الطالب المطلوب" }, { status: 400 });
  try {
    await db.student.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}
