export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import {
  requireText,
  routeErrorResponse,
  validationError,
} from "@/lib/route-helpers";
import {
  parseJsonArray,
  parseJsonRecord,
  stringifyJson,
  getAvailablePrograms,
  getAvailableStudyTypes,
  getAvailableStudyTypesForProgram,
  getCourseLocationConfig,
  type CourseLocationConfig,
  type StudyTypesByProgram,
  type StudyType,
  COURSE_PROGRAMS,
  STUDY_TYPES,
  LOCATION_SCOPES,
  BAGHDAD_MODES,
  OUT_OF_COUNTRY_LOCATION_SCOPE,
  resolveSubSite,
  validateStudentCourseChoices,
} from "@/lib/course-config";
import { IRAQI_PROVINCES, normalizeIraqiProvinceName } from "@/lib/iraq";
import {
  ensureExamCourseLinksSchema,
  parseCourseIds,
} from "@/lib/exam-course-links";

function formatLinkedStudentCount(count: number): string {
  return `${count} طالب`;
}

class CourseConfigIntegrityError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "CourseConfigIntegrityError";
    this.status = status;
  }
}

type CourseLinkedStudent = {
  id?: string;
  status?: string | null;
  courseProgram: string | null;
  courseTerm: string | null;
  studyType: string | null;
  locationScope: string | null;
  baghdadMode: string | null;
  mainSite?: string | null;
  subSite: string | null;
};

type StudentSnapshotUpdate = {
  id: string;
  data: {
    courseTerm: string | null;
    baghdadMode: string | null;
    mainSite: string | null;
    subSite: string | null;
  };
};

function nullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function buildStudentSnapshotSyncPlan(
  draftCourse: Record<string, unknown>,
  students: CourseLinkedStudent[],
) {
  const fieldChanges = {
    courseTerm: 0,
    baghdadMode: 0,
    mainSite: 0,
    subSite: 0,
  };
  const blockerSamples: string[] = [];
  const updates: StudentSnapshotUpdate[] = [];
  let skippedArchived = 0;
  let compatibleStudents = 0;

  for (const student of students) {
    if (!student.id) continue;
    if (student.status === "مؤرشف") {
      skippedArchived += 1;
      continue;
    }

    const locationScope = nullableText(student.locationScope);
    const nextCourseTerm =
      student.courseProgram === "كورسات"
        ? nullableText(student.courseTerm)
        : null;
    const locationConfig = getCourseLocationConfig(draftCourse);
    const configuredBaghdadMode = student.studyType
      ? locationConfig[student.studyType as StudyType]?.baghdadMode
      : undefined;
    const nextBaghdadMode =
      locationScope === "بغداد"
        ? nullableText(configuredBaghdadMode || student.baghdadMode)
        : null;
    const nextMainSite = locationScope;
    const nextSubSite = nullableText(
      resolveSubSite(
        draftCourse,
        String(student.studyType || ""),
        String(student.locationScope || ""),
        nextBaghdadMode || undefined,
        String(student.subSite || ""),
      ),
    );

    const validation = validateStudentCourseChoices(draftCourse, {
      courseProgram: student.courseProgram,
      courseTerm: nextCourseTerm,
      studyType: student.studyType,
      locationScope: student.locationScope,
      baghdadMode: nextBaghdadMode,
      subSite: nextSubSite,
    });
    if (!validation.ok) {
      if (blockerSamples.length < 5) blockerSamples.push(validation.error);
      continue;
    }
    compatibleStudents += 1;

    const data = {
      courseTerm: nextCourseTerm,
      baghdadMode: nextBaghdadMode,
      mainSite: nextMainSite,
      subSite: nextSubSite,
    };
    let changed = false;
    for (const key of Object.keys(data) as Array<keyof typeof data>) {
      if (nullableText(student[key]) !== data[key]) {
        fieldChanges[key] += 1;
        changed = true;
      }
    }
    if (changed) updates.push({ id: student.id, data });
  }

  const eligibleStudents = students.length - skippedArchived;
  const blockedStudents = Math.max(0, eligibleStudents - compatibleStudents);
  return {
    totalStudents: students.length,
    eligibleStudents,
    compatibleStudents,
    blockedStudents,
    skippedArchived,
    studentsToUpdate: updates.length,
    unchangedStudents: Math.max(0, compatibleStudents - updates.length),
    fieldChanges,
    blockerSamples: Array.from(new Set(blockerSamples)),
    canSync: blockedStudents === 0,
    updates,
    source: "database" as const,
  };
}

function chunkIds(values: string[], size = 500): string[][] {
  const result: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function applyStudentSnapshotPlan(
  tx: Prisma.TransactionClient,
  updates: StudentSnapshotUpdate[],
): Promise<number> {
  const groups = new Map<
    string,
    { data: StudentSnapshotUpdate["data"]; ids: string[] }
  >();
  for (const update of updates) {
    const key = JSON.stringify(update.data);
    const group = groups.get(key) || { data: update.data, ids: [] };
    group.ids.push(update.id);
    groups.set(key, group);
  }

  let updated = 0;
  for (const group of groups.values()) {
    for (const ids of chunkIds(group.ids)) {
      const result = await tx.student.updateMany({
        where: { id: { in: ids }, status: { not: "مؤرشف" } },
        data: group.data,
      });
      updated += result.count;
    }
  }
  return updated;
}

function countByUsageKey(
  students: CourseLinkedStudent[],
  getKey: (student: CourseLinkedStudent) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const student of students) {
    const key = getKey(student);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function firstUsageBlockMessage(
  courseName: string,
  draftCourse: Record<string, unknown>,
  linkedStudents: CourseLinkedStudent[],
): string | null {
  const newPrograms = getAvailablePrograms(draftCourse);
  const newLocationConfig = getCourseLocationConfig(draftCourse);

  const removedProgramCounts = countByUsageKey(linkedStudents, (student) =>
    student.courseProgram &&
    !(newPrograms as readonly string[]).includes(student.courseProgram)
      ? student.courseProgram
      : "",
  );
  const firstRemovedProgram = Array.from(removedProgramCounts.entries())[0];
  if (firstRemovedProgram) {
    const [program, count] = firstRemovedProgram;
    return `لا يمكن حذف نوع الدورة "${program}" لأن ${formatLinkedStudentCount(count)} مرتبطين به في دورة "${courseName}". انقل الطلاب أو غيّر نوعهم أولاً.`;
  }

  const removedStudyTypeCounts = countByUsageKey(linkedStudents, (student) => {
    if (!student.courseProgram || !student.studyType) return "";
    const newStudyTypesForProgram = getAvailableStudyTypesForProgram(
      draftCourse,
      student.courseProgram,
    );
    return (newStudyTypesForProgram as readonly string[]).includes(
      student.studyType,
    )
      ? ""
      : `${student.courseProgram}|||${student.studyType}`;
  });
  const firstRemovedStudyType = Array.from(removedStudyTypeCounts.entries())[0];
  if (firstRemovedStudyType) {
    const [key, count] = firstRemovedStudyType;
    const [program, studyType] = key.split("|||");
    return `لا يمكن حذف نوع البرنامج "${studyType}" من نوع الدورة "${program}" لأن ${formatLinkedStudentCount(count)} مرتبطين به في دورة "${courseName}". انقل الطلاب أو غيّر نوع دراستهم أولاً.`;
  }

  const removedScopeCounts = countByUsageKey(linkedStudents, (student) => {
    if (
      !student.studyType ||
      !student.locationScope ||
      student.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE
    )
      return "";
    const studyConfig = newLocationConfig[student.studyType as StudyType];
    return (studyConfig?.scopes as readonly string[] | undefined)?.includes(
      student.locationScope,
    )
      ? ""
      : `${student.studyType}|||${student.locationScope}`;
  });
  const firstRemovedScope = Array.from(removedScopeCounts.entries())[0];
  if (firstRemovedScope) {
    const [key, count] = firstRemovedScope;
    const [studyType, scope] = key.split("|||");
    return `لا يمكن حذف الموقع "${scope}" من نوع البرنامج "${studyType}" لأن ${formatLinkedStudentCount(count)} مرتبطين به في دورة "${courseName}". انقل الطلاب أو غيّر مواقعهم أولاً.`;
  }

  const removedBaghdadSiteCounts = countByUsageKey(
    linkedStudents,
    (student) => {
      if (
        student.locationScope !== "بغداد" ||
        !student.studyType ||
        !student.subSite
      )
        return "";
      const studyConfig = newLocationConfig[student.studyType as StudyType];
      if (studyConfig?.baghdadMode !== "بغداد - مخصص") return "";
      return studyConfig.baghdadSites?.includes(student.subSite)
        ? ""
        : `${student.studyType}|||${student.subSite}`;
    },
  );
  const firstRemovedBaghdadSite = Array.from(
    removedBaghdadSiteCounts.entries(),
  )[0];
  if (firstRemovedBaghdadSite) {
    const [key, count] = firstRemovedBaghdadSite;
    const [studyType, site] = key.split("|||");
    return `لا يمكن حذف موقع بغداد "${site}" من نوع البرنامج "${studyType}" لأن ${formatLinkedStudentCount(count)} مرتبطين به في دورة "${courseName}". انقل الطلاب أو غيّر موقعهم أولاً.`;
  }

  const removedProvinceCounts = countByUsageKey(linkedStudents, (student) => {
    if (
      student.locationScope !== "محافظات" ||
      !student.studyType ||
      !student.subSite
    )
      return "";
    const studyConfig = newLocationConfig[student.studyType as StudyType];
    if (!studyConfig?.provinces || studyConfig.provinces.length === 0)
      return "";
    const nextProvinces = studyConfig.provinces.map(normalizeIraqiProvinceName);
    const normalizedStudentProvince = normalizeIraqiProvinceName(
      student.subSite,
    );
    return nextProvinces.includes(normalizedStudentProvince)
      ? ""
      : `${student.studyType}|||${student.subSite}`;
  });
  const firstRemovedProvince = Array.from(removedProvinceCounts.entries())[0];
  if (firstRemovedProvince) {
    const [key, count] = firstRemovedProvince;
    const [studyType, province] = key.split("|||");
    return `لا يمكن حذف المحافظة "${province}" من نوع البرنامج "${studyType}" لأن ${formatLinkedStudentCount(count)} مرتبطين بها في دورة "${courseName}". انقل الطلاب أو غيّر محافظاتهم أولاً.`;
  }

  return null;
}

function validateCoursePayload(
  body: Record<string, unknown>,
  isUpdate = false,
): string | null {
  if (!isUpdate) {
    const nameError = requireText(body.name, "اسم الدورة");
    if (nameError) return nameError;
  }

  // Validate availablePrograms
  const programs = parseJsonArray<string>(body.availablePrograms);
  if (programs.length === 0)
    return "يجب اختيار خيار واحد على الأقل من نوع الدورة";
  for (const p of programs) {
    if (!(COURSE_PROGRAMS as readonly string[]).includes(p))
      return `نوع الدورة "${p}" غير صالح`;
  }

  // Validate study types per course program
  const studyTypesByProgram = parseJsonRecord<StudyTypesByProgram>(
    body.studyTypesByProgram,
    {},
  );
  const studyTypesSet = new Set<string>();
  for (const program of programs) {
    const studyTypes = parseJsonArray<string>(
      studyTypesByProgram[program as keyof StudyTypesByProgram],
    );
    if (studyTypes.length === 0)
      return `يجب اختيار نوع دراسة واحد على الأقل لنوع الدورة "${program}"`;
    for (const st of studyTypes) {
      if (!(STUDY_TYPES as readonly string[]).includes(st))
        return `نوع البرنامج "${st}" غير صالح`;
      studyTypesSet.add(st);
    }
  }

  // Keep availableStudyTypes as the normalized union for backward compatibility.
  const studyTypes = Array.from(studyTypesSet);
  if (studyTypes.length === 0)
    return "يجب اختيار خيار واحد على الأقل من نوع البرنامج";

  // Validate locationConfig
  const locationConfig = parseJsonRecord<CourseLocationConfig>(
    body.locationConfig,
    {},
  );
  for (const studyType of studyTypes) {
    const config = locationConfig[studyType as StudyType];
    if (!config)
      return `يجب تحديد إعدادات المواقع لنوع البرنامج "${studyType}"`;
    if (!config.scopes || config.scopes.length === 0)
      return `يجب اختيار بغداد أو محافظات لنوع البرنامج "${studyType}"`;
    for (const scope of config.scopes) {
      if (!(LOCATION_SCOPES as readonly string[]).includes(scope))
        return `الموقع "${scope}" غير صالح`;
    }
    if (config.scopes.includes("بغداد")) {
      if (
        !config.baghdadMode ||
        !(BAGHDAD_MODES as readonly string[]).includes(config.baghdadMode)
      )
        return `يجب اختيار نوع بغداد لنوع البرنامج "${studyType}"`;
      if (studyType === "حضوري" && config.baghdadMode !== "بغداد - مخصص")
        return "نوع بغداد للدراسة الحضورية يجب أن يكون بغداد - مخصص";
      if (config.baghdadMode === "بغداد - مخصص") {
        if (!config.baghdadSites || config.baghdadSites.length === 0)
          return `يجب اختيار موقع واحد على الأقل من مواقع بغداد لنوع البرنامج "${studyType}"`;
      }
    }
    if (config.scopes.includes("محافظات")) {
      if (!config.provinces || config.provinces.length === 0) {
        return `يجب اختيار محافظة واحدة على الأقل لنوع البرنامج "${studyType}"`;
      }
      for (const prov of config.provinces) {
        const normalizedProvince = normalizeIraqiProvinceName(prov);
        if (
          !(IRAQI_PROVINCES as readonly string[]).includes(normalizedProvince)
        )
          return `المحافظة "${prov}" غير صالحة`;
      }
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "courses.view");
  if (authError) return authError;

  try {
    const { isPaginatedRequest, parsePagination } =
      await import("@/lib/pagination");
    if (isPaginatedRequest(req)) {
      const { page, limit, skip } = parsePagination(req);
      const [courses, total] = await Promise.all([
        db.course.findMany({
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        db.course.count(),
      ]);
      return NextResponse.json({
        courses,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    }
    const courses = await db.course.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ courses });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل الدورات حالياً.");
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "courses.add");
  if (authError) return authError;

  try {
    const body = await req.json();

    const validationMessage = validateCoursePayload(body);
    if (validationMessage) return validationError(validationMessage);

    const studyTypes = getAvailableStudyTypes(body);
    const course = await db.course.create({
      data: {
        name: String(body.name ?? "").trim(),
        active: body.active ?? true,
        availablePrograms: stringifyJson(body.availablePrograms || []),
        availableStudyTypes: stringifyJson(studyTypes),
        studyTypesByProgram: stringifyJson(body.studyTypesByProgram || {}),
        locationConfig: stringifyJson(body.locationConfig || {}),
      },
    });
    return NextResponse.json({ course }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ الدورة حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "courses.edit");
  if (authError) return authError;

  try {
    const body = await req.json();
    const {
      id,
      previewOnly: rawPreviewOnly,
      syncStudentSnapshots: rawSyncStudentSnapshots,
      ...data
    } = body;
    const previewOnly = rawPreviewOnly === true;
    const syncStudentSnapshots = rawSyncStudentSnapshots === true;
    if (!id) return validationError("تعذر تحديد الدورة المطلوبة");
    if (data.name !== undefined) {
      const nameError = requireText(data.name, "اسم الدورة");
      if (nameError) return validationError(nameError);
      data.name = String(data.name ?? "").trim();
    }

    const existingCourse = await db.course.findUnique({
      where: { id: String(id) },
    });
    if (!existingCourse) return validationError("الدورة غير موجودة", 404);

    const configTouched =
      data.availablePrograms !== undefined ||
      data.availableStudyTypes !== undefined ||
      data.studyTypesByProgram !== undefined ||
      data.locationConfig !== undefined;

    let snapshotPlan: ReturnType<typeof buildStudentSnapshotSyncPlan> | null =
      null;
    let usageBlockMessage: string | null = null;
    let draftCourse: Record<string, unknown> | null = null;

    if (configTouched) {
      draftCourse = {
        availablePrograms:
          data.availablePrograms ?? existingCourse.availablePrograms,
        availableStudyTypes:
          data.availableStudyTypes ?? existingCourse.availableStudyTypes,
        studyTypesByProgram:
          data.studyTypesByProgram ?? existingCourse.studyTypesByProgram,
        locationConfig: data.locationConfig ?? existingCourse.locationConfig,
      };

      const validationMessage = validateCoursePayload(
        { ...draftCourse, name: data.name ?? existingCourse.name },
        true,
      );
      if (validationMessage) return validationError(validationMessage);

      const existingStudents = await db.student.findMany({
        where: { courseId: String(id) },
        select: {
          id: true,
          status: true,
          courseProgram: true,
          courseTerm: true,
          studyType: true,
          locationScope: true,
          baghdadMode: true,
          mainSite: true,
          subSite: true,
        },
      });
      const nonArchivedStudents = existingStudents.filter(
        (student) => student.status !== "مؤرشف",
      );
      usageBlockMessage = firstUsageBlockMessage(
        existingCourse.name,
        draftCourse,
        nonArchivedStudents,
      );
      snapshotPlan = buildStudentSnapshotSyncPlan(
        draftCourse,
        existingStudents,
      );
    }

    if (previewOnly) {
      return NextResponse.json({
        preview: {
          configTouched,
          ...(snapshotPlan || {
            totalStudents: 0,
            eligibleStudents: 0,
            compatibleStudents: 0,
            blockedStudents: 0,
            skippedArchived: 0,
            studentsToUpdate: 0,
            unchangedStudents: 0,
            fieldChanges: {
              courseTerm: 0,
              baghdadMode: 0,
              mainSite: 0,
              subSite: 0,
            },
            blockerSamples: [],
            canSync: true,
            source: "database" as const,
          }),
          canSave: !usageBlockMessage,
          blockingMessage: usageBlockMessage,
        },
      });
    }

    if (usageBlockMessage) {
      return NextResponse.json(
        {
          error: usageBlockMessage,
          studentConfigImpact: snapshotPlan
            ? {
                ...snapshotPlan,
                updates: undefined,
                canSave: false,
                blockingMessage: usageBlockMessage,
              }
            : null,
        },
        { status: 409 },
      );
    }

    const updateData = { ...data };
    if (updateData.studyTypesByProgram !== undefined) {
      updateData.studyTypesByProgram = stringifyJson(
        updateData.studyTypesByProgram,
      );
    }
    if (updateData.availablePrograms !== undefined) {
      updateData.availablePrograms = stringifyJson(
        updateData.availablePrograms,
      );
    }
    if (
      updateData.studyTypesByProgram !== undefined ||
      updateData.availableStudyTypes !== undefined ||
      updateData.availablePrograms !== undefined
    ) {
      updateData.availableStudyTypes = stringifyJson(
        getAvailableStudyTypes({
          availablePrograms:
            updateData.availablePrograms ?? existingCourse.availablePrograms,
          availableStudyTypes:
            updateData.availableStudyTypes ??
            existingCourse.availableStudyTypes,
          studyTypesByProgram:
            updateData.studyTypesByProgram ??
            existingCourse.studyTypesByProgram,
        }),
      );
    }
    if (updateData.locationConfig !== undefined) {
      updateData.locationConfig = stringifyJson(updateData.locationConfig);
    }

    const result = await withSerializableTransaction(async (tx) => {
      const course = await tx.course.update({
        where: { id: String(id) },
        data: updateData,
      });

      let executionPlan: ReturnType<
        typeof buildStudentSnapshotSyncPlan
      > | null = null;
      if (configTouched) {
        // The preview is informative only. Re-read every linked student after
        // the course update inside the same transaction so a concurrent
        // registration/transfer cannot be omitted from the actual sync.
        const freshStudents = await tx.student.findMany({
          where: { courseId: String(id) },
          select: {
            id: true,
            status: true,
            courseProgram: true,
            courseTerm: true,
            studyType: true,
            locationScope: true,
            baghdadMode: true,
            mainSite: true,
            subSite: true,
          },
        });
        const freshNonArchivedStudents = freshStudents.filter(
          (student) => student.status !== "مؤرشف",
        );
        const freshDraftCourse: Record<string, unknown> = {
          availablePrograms: course.availablePrograms,
          availableStudyTypes: course.availableStudyTypes,
          studyTypesByProgram: course.studyTypesByProgram,
          locationConfig: course.locationConfig,
        };
        const freshUsageBlockMessage = firstUsageBlockMessage(
          course.name,
          freshDraftCourse,
          freshNonArchivedStudents,
        );
        if (freshUsageBlockMessage) {
          throw new CourseConfigIntegrityError(freshUsageBlockMessage);
        }

        executionPlan = buildStudentSnapshotSyncPlan(
          freshDraftCourse,
          freshStudents,
        );
        if (syncStudentSnapshots && !executionPlan.canSync) {
          throw new CourseConfigIntegrityError(
            executionPlan.blockerSamples[0] ||
              "تعذر مزامنة بعض الطلاب مع الإعدادات الجديدة. لم يتم حفظ التعديل.",
          );
        }
      }

      const syncedStudents =
        syncStudentSnapshots && executionPlan
          ? await applyStudentSnapshotPlan(tx, executionPlan.updates)
          : 0;
      return { course, syncedStudents, snapshotPlan: executionPlan };
    });

    const finalSnapshotPlan = result.snapshotPlan;
    const publicPlan = finalSnapshotPlan
      ? {
          totalStudents: finalSnapshotPlan.totalStudents,
          eligibleStudents: finalSnapshotPlan.eligibleStudents,
          compatibleStudents: finalSnapshotPlan.compatibleStudents,
          blockedStudents: finalSnapshotPlan.blockedStudents,
          skippedArchived: finalSnapshotPlan.skippedArchived,
          studentsToUpdate: finalSnapshotPlan.studentsToUpdate,
          unchangedStudents: finalSnapshotPlan.unchangedStudents,
          fieldChanges: finalSnapshotPlan.fieldChanges,
          blockerSamples: finalSnapshotPlan.blockerSamples,
          canSync: finalSnapshotPlan.canSync,
          source: finalSnapshotPlan.source,
        }
      : null;

    return NextResponse.json({
      course: result.course,
      studentConfigImpact: configTouched
        ? {
            ...publicPlan,
            affectedStudents: finalSnapshotPlan?.eligibleStudents ?? 0,
            syncedStudents: result.syncedStudents,
            autoSynced: syncStudentSnapshots,
            message: syncStudentSnapshots
              ? result.syncedStudents > 0
                ? `تم تحديث إعدادات الدورة ومزامنة ${result.syncedStudents} طالب متأثر. المؤرشفون بقوا كسجل تاريخي.`
                : "تم تحديث إعدادات الدورة، ولا توجد Snapshot طلاب تحتاج تغييراً."
              : (finalSnapshotPlan?.eligibleStudents ?? 0) > 0
                ? "تم تحديث إعدادات الدورة فقط. بيانات الطلاب القدامى بقيت Snapshot، ويمكن مزامنتها اختيارياً من المعاينة."
                : "لا يوجد طلاب حاليون متأثرون بإعدادات هذه الدورة.",
          }
        : null,
    });
  } catch (error) {
    if (error instanceof CourseConfigIntegrityError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return routeErrorResponse(error, "تعذر تحديث الدورة حالياً.");
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, "courses.delete");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return validationError("تعذر تحديد الدورة المطلوبة");

    const course = await db.course.findUnique({
      where: { id },
      select: { name: true },
    });
    if (!course) return validationError("الدورة غير موجودة", 404);

    const studentCount = await db.student.count({ where: { courseId: id } });
    if (studentCount > 0) {
      return validationError(
        `لا يمكن حذف الدورة "${course.name}" لأن ${formatLinkedStudentCount(studentCount)} مرتبطين بها. استخدم تعطيل الدورة إذا تريد إيقافها بدون حذف بياناتها.`,
        409,
      );
    }

    await ensureExamCourseLinksSchema();
    const relatedExamLink = await db.examCourse.findFirst({
      where: { courseId: id },
      include: { exam: { select: { id: true, name: true } } },
    });
    const relatedExam =
      relatedExamLink?.exam ||
      (
        await db.exam.findMany({
          select: { id: true, name: true, courseIds: true },
        })
      ).find((exam) => parseCourseIds(exam.courseIds).includes(id));
    if (relatedExam) {
      return validationError(
        `لا يمكن حذف الدورة "${course.name}" لأنها مرتبطة بامتحان "${relatedExam.name}". استخدم تعطيل الدورة أو عدّل ربط الامتحان أولاً.`,
        409,
      );
    }

    await db.$transaction(async (tx) => {
      await tx.courseChapter.deleteMany({ where: { courseId: id } });
      await tx.course.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حذف الدورة حالياً.");
  }
}
