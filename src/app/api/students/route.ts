import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPhoneValidationError, sanitizePhoneInput } from "@/lib/format";
import {
  getStudentDuplicateMessage,
  getStudentUniqueKeys,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import { getRequiredTextError } from "@/lib/validation";
import { normalizeArabicText } from "@/lib/route-helpers";
import {
  validateStudentCourseChoices,
  resolveSubSite,
} from '@/lib/course-config';

function normalizeGraceDays(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(30, Math.max(0, Math.trunc(numeric)));
}

function validateGraceDays(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 30) {
    return 'فترة السماح يجب أن تكون رقماً من 0 إلى 30 يوم';
  }
  return null;
}


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

export async function GET(req: NextRequest) {
  const query = new URL(req.url).searchParams.get("q") || "";
  const students = await db.student.findMany({
    orderBy: { createdAt: "desc" },
    include: { course: true },
  });
  const normalizedQuery = normalizeArabicText(query);
  const filteredStudents = normalizedQuery
    ? students.filter((student) =>
        [student.name, student.phone, student.parentPhone, student.telegram, student.code]
          .some((field) => normalizeArabicText(field).includes(normalizedQuery)),
      )
    : students;
  return NextResponse.json({ students: filteredStudents });
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
    ["courseId", "الدورة مطلوبة"],
    ["createdAt", "تاريخ إضافة الطالب مطلوب"],
  ] as const;
  const missingField = requiredFields.find(
    ([key]) => !String(body[key] ?? "").trim(),
  );
  if (missingField)
    return NextResponse.json({ error: missingField[1] }, { status: 400 });

  const nameError = getRequiredTextError(String(body.name ?? ""), "اسم الطالب");
  if (nameError)
    return NextResponse.json({ error: nameError }, { status: 400 });

  const graceDaysError = validateGraceDays(body.accountingGraceDays);
  if (graceDaysError)
    return NextResponse.json({ error: graceDaysError }, { status: 400 });

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


  const uniqueKeys = getStudentUniqueKeys({
    name: body.name,
    phone: body.phone,
    telegram: body.telegram,
  });

  // Validate student course choices against course settings
  const course = await db.course.findUnique({ where: { id: String(body.courseId ?? '') } });
  if (!course) {
    return NextResponse.json({ error: 'الدورة المحددة غير موجودة' }, { status: 400 });
  }

  const courseChoices = {
    courseProgram: body.courseProgram,
    courseTerm: body.courseProgram === 'كورسات' ? body.courseTerm : null,
    studyType: body.studyType,
    locationScope: body.locationScope,
    baghdadMode: body.baghdadMode,
    subSite: body.subSite,
  };

  const choiceValidation = validateStudentCourseChoices(course, courseChoices);
  if (!choiceValidation.ok) {
    return NextResponse.json({ error: choiceValidation.error }, { status: 400 });
  }

  // Auto-resolve subSite based on course settings
  const resolvedSubSite = resolveSubSite(course, String(body.studyType ?? ''), String(body.locationScope ?? ''), String(body.baghdadMode ?? ''), String(body.subSite ?? ''));

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
      courseProgram: body.courseProgram || null,
      courseTerm: body.courseProgram === 'كورسات' ? (body.courseTerm || null) : null,
      studyType: body.studyType || null,
      locationScope: body.locationScope || null,
      baghdadMode: body.baghdadMode || null,
      mainSite: body.locationScope || body.mainSite,
      subSite: resolvedSubSite || body.subSite,
      code: body.code,
      status: body.status || "نشط",
      dismissalType: body.dismissalType,
      dismissalReason: body.dismissalReason,
      dismissalNotes: body.dismissalNotes ? String(body.dismissalNotes) : null,
      createdAt: body.createdAt ? new Date(body.createdAt) : new Date(),
      opportunities: Number(body.opportunities || 0),
      baseOpportunities: Number(body.baseOpportunities || 0),
      accountingGraceDays: normalizeGraceDays(body.accountingGraceDays),
      courseId: body.courseId,
        ...uniqueKeys,
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
  for (const obsoleteKey of ["receiptNo", "codeSequence", "totalAmount", "paidAmount", "installments", "accountingStart", "groupId"]) {
    delete data[obsoleteKey];
  }
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
  if (data.accountingGraceDays !== undefined) {
    const graceDaysError = validateGraceDays(data.accountingGraceDays);
    if (graceDaysError)
      return NextResponse.json({ error: graceDaysError }, { status: 400 });
    data.accountingGraceDays = normalizeGraceDays(data.accountingGraceDays);
  }
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
  if (data.opportunities !== undefined)
    data.opportunities = Number(data.opportunities);
  if (data.baseOpportunities !== undefined)
    data.baseOpportunities = Number(data.baseOpportunities);

  // If course-related fields are being updated, validate against course settings
  if (data.courseProgram !== undefined || data.studyType !== undefined || 
      data.locationScope !== undefined || data.baghdadMode !== undefined || 
      data.courseId !== undefined) {
    const targetCourseId = data.courseId !== undefined ? data.courseId : 
      (await db.student.findUnique({ where: { id }, select: { courseId: true } }))?.courseId;
    
    if (targetCourseId) {
      const course = await db.course.findUnique({ where: { id: targetCourseId } });
      if (course) {
        const current = await db.student.findUnique({ where: { id }, select: { 
          courseProgram: true, courseTerm: true, studyType: true, 
          locationScope: true, baghdadMode: true, subSite: true 
        }});
        
        const courseChoices = {
          courseProgram: data.courseProgram ?? current?.courseProgram,
          courseTerm: data.courseProgram === 'كورسات' ? (data.courseTerm ?? current?.courseTerm) : null,
          studyType: data.studyType ?? current?.studyType,
          locationScope: data.locationScope ?? current?.locationScope,
          baghdadMode: data.baghdadMode ?? current?.baghdadMode,
          subSite: data.subSite ?? current?.subSite,
        };
        
        const choiceValidation = validateStudentCourseChoices(course, courseChoices);
        if (!choiceValidation.ok) {
          return NextResponse.json({ error: choiceValidation.error }, { status: 400 });
        }
        
        // Auto-resolve subSite
        const resolvedSubSite = resolveSubSite(
          course, 
          String(courseChoices.studyType ?? ''), 
          String(courseChoices.locationScope ?? ''), 
          String(courseChoices.baghdadMode ?? ''), 
          String(courseChoices.subSite ?? '')
        );
        if (resolvedSubSite) data.subSite = resolvedSubSite;
      }
    }
  }

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
