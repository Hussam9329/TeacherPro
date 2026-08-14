export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { db } from "@/lib/db";
import { buildMutationPreviewToken } from "@/lib/mutation-preview-token";
import {
  normalizeArabicText,
  routeErrorResponse,
  validationError,
} from "@/lib/route-helpers";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { requirePermission } from "@/lib/server-auth";
import {
  SECOND_CHAPTER_REACTIVATION_REASON,
  SECOND_CHAPTER_SETTLEMENT_REASON,
  SECOND_CHAPTER_TRANSITION_MARKER_ACTION,
  SECOND_CHAPTER_TRANSITION_MARKER_ID,
  SECOND_CHAPTER_TRANSITION_NOTE_SOURCE,
} from "@/lib/second-chapter-transition";

type TransitionClient = typeof db | Prisma.TransactionClient;

const COURSE_TARGETS = [
  {
    key: "summer",
    label: "الدورة الصيفية",
    aliases: ["الدورة الصيفية"],
  },
  {
    key: "exemption",
    label: "دورة الإعفاء",
    aliases: ["طلاب الاعفاء", "دورة الاعفاء", "دورة طلاب الاعفاء"],
  },
] as const;
const TARGET_CHAPTER_NAME = "الفصل الثاني - الانسجة";
const TARGET_OPPORTUNITIES = 3;

class SecondChapterTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecondChapterTransitionError";
  }
}

function transitionErrorResponse(error: unknown) {
  if (error instanceof SecondChapterTransitionError) {
    return validationError(error.message, 409);
  }
  return routeErrorResponse(
    error,
    "تعذر نقل الدورتين إلى الفصل الثاني. أُلغيت العملية ولم يُحفظ تعديل جزئي.",
  );
}

async function buildTransitionPreview(client: TransitionClient = db) {
  const [allCourses, allChapters] = await Promise.all([
    client.course.findMany({
      select: { id: true, name: true, active: true },
      orderBy: { id: "asc" },
    }),
    client.chapter.findMany({
      select: { id: true, name: true, opportunities: true },
      orderBy: { id: "asc" },
    }),
  ]);

  const courseMatches = COURSE_TARGETS.map((target) => {
    const normalizedAliases = new Set(
      target.aliases.map((alias) => normalizeArabicText(alias)),
    );
    return {
      targetKey: target.key,
      targetLabel: target.label,
      aliases: target.aliases,
      matches: allCourses.filter((course) =>
        normalizedAliases.has(normalizeArabicText(course.name)),
      ),
    };
  });
  const chapterMatches = allChapters.filter(
    (chapter) =>
      normalizeArabicText(chapter.name) ===
      normalizeArabicText(TARGET_CHAPTER_NAME),
  );

  const blockers: string[] = [];
  for (const match of courseMatches) {
    if (match.matches.length === 0) {
      blockers.push(
        `لم تُوجد ${match.targetLabel} في قاعدة البيانات ضمن الأسماء المعتمدة: ${match.aliases.map((alias) => `«${alias}»`).join("، ")}.`,
      );
    } else if (match.matches.length > 1) {
      const resolvedMatches = match.matches
        .map((course) => `«${course.name}» (${course.id})`)
        .join("، ");
      blockers.push(
        `طابقت ${match.targetLabel} أكثر من دورة فعلية: ${resolvedMatches}. أُوقف التنفيذ لمنع توسيع النطاق أو اختيار دورة خاطئة.`,
      );
    }
  }
  if (chapterMatches.length === 0) {
    blockers.push(`لم يوجد فصل باسم «${TARGET_CHAPTER_NAME}».`);
  } else if (chapterMatches.length > 1) {
    blockers.push(
      `يوجد أكثر من فصل باسم «${TARGET_CHAPTER_NAME}»؛ أُوقف التنفيذ لمنع اختيار فصل خاطئ.`,
    );
  }

  const targetCourses = courseMatches.flatMap((match) =>
    match.matches.length === 1 ? match.matches : [],
  );
  const targetCourseIdsAreUnique =
    new Set(targetCourses.map((course) => course.id)).size ===
    targetCourses.length;
  if (!targetCourseIdsAreUnique) {
    blockers.push(
      "طابق سجل دورة واحد أكثر من هدف؛ أُوقف التنفيذ لمنع تكرار أو توسيع نطاق الطلاب.",
    );
  }
  const targetChapter = chapterMatches.length === 1 ? chapterMatches[0] : null;
  const targetCourseIds = targetCourses.map((course) => course.id);

  const [
    links,
    students,
    externalTargetLinks,
    existingTransitionMarker,
    existingTransitionNote,
  ] = await Promise.all([
    client.courseChapter.findMany({
      where: { courseId: { in: targetCourseIds } },
      select: {
        id: true,
        courseId: true,
        chapterId: true,
        active: true,
        archived: true,
        archive: true,
        chapter: { select: { name: true, opportunities: true } },
      },
      orderBy: { id: "asc" },
    }),
    client.student.findMany({
      where: { courseId: { in: targetCourseIds } },
      select: {
        id: true,
        name: true,
        code: true,
        courseId: true,
        status: true,
        opportunities: true,
        baseOpportunities: true,
        dismissalType: true,
        dismissalReason: true,
        dismissalNotes: true,
      },
      orderBy: { id: "asc" },
    }),
      targetChapter
        ? client.courseChapter.findMany({
            where: {
              chapterId: targetChapter.id,
              courseId: { notIn: targetCourseIds },
            },
            select: {
              id: true,
              courseId: true,
              active: true,
              archived: true,
              course: { select: { name: true } },
            },
            orderBy: { id: "asc" },
          })
        : Promise.resolve([]),
      client.auditLog.findUnique({
        where: { id: SECOND_CHAPTER_TRANSITION_MARKER_ID },
        select: { id: true, time: true },
      }),
      client.studentNote.findFirst({
        where: {
          sourceType: SECOND_CHAPTER_TRANSITION_NOTE_SOURCE,
          sourceId: SECOND_CHAPTER_TRANSITION_MARKER_ID,
        },
        select: { id: true, date: true },
      }),
    ]);

  if (existingTransitionMarker || existingTransitionNote) {
    const executedAt =
      existingTransitionMarker?.time || existingTransitionNote?.date;
    blockers.push(
      `تم تنفيذ انتقال الدورتين مسبقاً${executedAt ? ` بتاريخ ${executedAt.toISOString()}` : ""}. مُنع تكراره حتى لا تُمسح خصومات أو حالات الفصل الثاني.`,
    );
  }

  if (
    targetChapter &&
    targetChapter.opportunities !== TARGET_OPPORTUNITIES &&
    externalTargetLinks.length > 0
  ) {
    blockers.push(
      `الفصل المطلوب مرتبط بدورات أخرى وقيمته الحالية ${targetChapter.opportunities}. أُوقف تغيير القيمة إلى ${TARGET_OPPORTUNITIES} حتى لا تتأثر دورة خارج النطاق.`,
    );
  }

  if (targetChapter) {
    for (const course of targetCourses) {
      const targetLinks = links.filter(
        (link) =>
          link.courseId === course.id && link.chapterId === targetChapter.id,
      );
      if (targetLinks.length > 1) {
        blockers.push(
          `دورة «${course.name}» تملك أكثر من ربط للفصل المطلوب؛ أُوقف التنفيذ حتى لا يتكرر الربط.`,
        );
      }
    }
  }

  const perCourse = targetCourses.map((course) => {
    const courseStudents = students.filter(
      (student) => student.courseId === course.id,
    );
    const courseLinks = links.filter((link) => link.courseId === course.id);
    return {
      courseId: course.id,
      courseName: course.name,
      courseCurrentlyActive: course.active,
      students: {
        total: courseStudents.length,
        active: courseStudents.filter((student) => student.status === "نشط")
          .length,
        dismissed: courseStudents.filter(
          (student) => student.status === "مفصول",
        ).length,
        archived: courseStudents.filter(
          (student) => student.status === "مؤرشف",
        ).length,
        otherStatus: courseStudents.filter(
          (student) =>
            !["نشط", "مفصول", "مؤرشف"].includes(student.status),
        ).length,
        balancesToReset: courseStudents.filter(
          (student) =>
            student.opportunities !== TARGET_OPPORTUNITIES ||
            student.baseOpportunities !== TARGET_OPPORTUNITIES,
        ).length,
      },
      activeLinksToDeactivate: courseLinks.filter(
        (link) =>
          link.active &&
          (!targetChapter || link.chapterId !== targetChapter.id),
      ).length,
      currentActiveChapters: courseLinks
        .filter((link) => link.active && !link.archived)
        .map((link) => link.chapter.name),
      targetLinkExists: Boolean(
        targetChapter &&
          courseLinks.some((link) => link.chapterId === targetChapter.id),
      ),
    };
  });

  const snapshot = {
    courseMatches: courseMatches.map((match) => ({
      targetKey: match.targetKey,
      targetLabel: match.targetLabel,
      aliases: match.aliases,
      matches: match.matches,
    })),
    chapterMatches,
    links: links.map((link) => ({
      id: link.id,
      courseId: link.courseId,
      chapterId: link.chapterId,
      active: link.active,
      archived: link.archived,
      archive: link.archive,
    })),
    students: students.map((student) => ({
      id: student.id,
      courseId: student.courseId,
      status: student.status,
      opportunities: student.opportunities,
      baseOpportunities: student.baseOpportunities,
      dismissalType: student.dismissalType,
      dismissalReason: student.dismissalReason,
      dismissalNotes: student.dismissalNotes,
    })),
    externalTargetLinks,
    existingTransitionMarker,
    existingTransitionNote,
  };

  const totalStudents = perCourse.reduce(
    (sum, course) => sum + course.students.total,
    0,
  );
  const studentsToReactivate = perCourse.reduce(
    (sum, course) =>
      sum +
      course.students.dismissed +
      course.students.archived +
      course.students.otherStatus,
    0,
  );

  return {
    canExecute:
      blockers.length === 0 &&
      targetCourses.length === COURSE_TARGETS.length &&
      targetCourseIdsAreUnique &&
      Boolean(targetChapter),
    blockers,
    target: {
      courseNames: targetCourses.map((course) => course.name),
      chapterId: targetChapter?.id || null,
      chapterName: targetChapter?.name || TARGET_CHAPTER_NAME,
      currentChapterOpportunities: targetChapter?.opportunities ?? null,
      nextChapterOpportunities: TARGET_OPPORTUNITIES,
    },
    impact: {
      courses: perCourse.length,
      totalStudents,
      studentsToReactivate,
      dismissedToReactivate: perCourse.reduce(
        (sum, course) => sum + course.students.dismissed,
        0,
      ),
      archivedToRestore: perCourse.reduce(
        (sum, course) => sum + course.students.archived,
        0,
      ),
      balancesToReset: perCourse.reduce(
        (sum, course) => sum + course.students.balancesToReset,
        0,
      ),
      activeLinksToDeactivate: perCourse.reduce(
        (sum, course) => sum + course.activeLinksToDeactivate,
        0,
      ),
      externalChapterLinks: externalTargetLinks.length,
    },
    perCourse,
    sampleStudentsToReactivate: students
      .filter((student) => student.status !== "نشط")
      .slice(0, 12)
      .map((student) => ({
        id: student.id,
        name: student.name,
        code: student.code,
        previousStatus: student.status,
      })),
    message:
      blockers.length > 0
        ? "المعاينة وجدت مانعاً، لذلك لن يسمح النظام بالتنفيذ."
        : `سيتم تفعيل الفصل الثاني بثلاث فرص لدورتي ${targetCourses.map((course) => `«${course.name}»`).join(" و")} وإعادة ${studentsToReactivate} طالب إلى نشط، داخل عملية ذرية واحدة.`,
    previewToken: buildMutationPreviewToken(
      "second-chapter-transition-summer-exemption",
      snapshot,
    ),
    source: "database" as const,
    generatedAt: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
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
        buildTransitionPreview(tx),
      );
      return NextResponse.json({ preview });
    }

    if (!confirmImpact || !previewToken) {
      return validationError(
        "يجب مراجعة المعاينة الحالية وتأكيدها قبل تنفيذ انتقال الدورتين.",
        409,
      );
    }

    const result = await withSerializableTransaction(async (tx) => {
      const preview = await buildTransitionPreview(tx);
      if (preview.previewToken !== previewToken) {
        throw new SecondChapterTransitionError(
          "تغيرت بيانات الدورتين أو الطلاب بعد المعاينة. أُوقف التنفيذ قبل أي تعديل؛ أعد تحميل المعاينة.",
        );
      }
      if (!preview.canExecute || !preview.target.chapterId) {
        throw new SecondChapterTransitionError(
          preview.blockers[0] || "لا يمكن تنفيذ الانتقال حسب المعاينة الحالية.",
        );
      }

      const now = new Date();
      const chapterId = preview.target.chapterId;
      await tx.auditLog.create({
        data: {
          id: SECOND_CHAPTER_TRANSITION_MARKER_ID,
          module: "الفصول والطلاب",
          action: SECOND_CHAPTER_TRANSITION_MARKER_ACTION,
          details: JSON.stringify({
            previewToken,
            courses: preview.perCourse,
            target: preview.target,
            executedAt: now.toISOString(),
          }),
          userName: "TeacherPro emergency transition",
        },
      });
      await tx.chapter.update({
        where: { id: chapterId },
        data: { opportunities: TARGET_OPPORTUNITIES },
      });

      let updatedStudents = 0;
      let reactivatedStudents = 0;
      let disabledLinks = 0;
      for (const coursePreview of preview.perCourse) {
        const courseStudents = await tx.student.findMany({
          where: { courseId: coursePreview.courseId },
          select: {
            id: true,
            status: true,
            opportunities: true,
            baseOpportunities: true,
            dismissalType: true,
            dismissalReason: true,
            dismissalNotes: true,
          },
          orderBy: { id: "asc" },
        });
        if (courseStudents.length !== coursePreview.students.total) {
          throw new SecondChapterTransitionError(
            `تغير عدد طلاب دورة «${coursePreview.courseName}» أثناء التنفيذ. أُلغيت العملية بالكامل.`,
          );
        }

        const archive = JSON.stringify(
          courseStudents.map((student) => ({
            studentId: student.id,
            opportunities: student.opportunities,
            baseOpportunities: student.baseOpportunities,
            status: student.status,
            dismissalType: student.dismissalType,
            dismissalReason: student.dismissalReason,
            dismissalNotes: student.dismissalNotes,
            date: now.toISOString(),
          })),
        );
        const disabled = await tx.courseChapter.updateMany({
          where: {
            courseId: coursePreview.courseId,
            chapterId: { not: chapterId },
            active: true,
          },
          data: { active: false, archive },
        });
        disabledLinks += disabled.count;

        const targetLinks = await tx.courseChapter.findMany({
          where: { courseId: coursePreview.courseId, chapterId },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        if (targetLinks.length > 1) {
          throw new SecondChapterTransitionError(
            `ظهر ربط مكرر للفصل المطلوب في دورة «${coursePreview.courseName}». أُلغيت العملية بالكامل.`,
          );
        }
        const targetLink = targetLinks[0]
          ? await tx.courseChapter.update({
              where: { id: targetLinks[0].id },
              data: { active: true, archived: false },
              select: { id: true },
            })
          : await tx.courseChapter.create({
              data: {
                courseId: coursePreview.courseId,
                chapterId,
                active: true,
                archived: false,
                archive: "[]",
              },
              select: { id: true },
            });
        void targetLink;

        await tx.course.update({
          where: { id: coursePreview.courseId },
          data: { active: true },
        });

        const restoredStudents = courseStudents.filter(
          (student) => student.status !== "نشط",
        );
        const restoredStudentIds = restoredStudents.map(
          (student) => student.id,
        );
        const update = await tx.student.updateMany({
          where: {
            id: { in: courseStudents.map((student) => student.id) },
            courseId: coursePreview.courseId,
          },
          data: {
            status: "نشط",
            opportunities: TARGET_OPPORTUNITIES,
            baseOpportunities: TARGET_OPPORTUNITIES,
            dismissalType: null,
            dismissalReason: null,
            dismissalNotes: null,
          },
        });
        if (update.count !== courseStudents.length) {
          throw new SecondChapterTransitionError(
            `تعذر تحديث كل طلاب دورة «${coursePreview.courseName}». أُلغيت العملية بالكامل.`,
          );
        }
        updatedStudents += update.count;
        reactivatedStudents += restoredStudentIds.length;

        if (courseStudents.length > 0) {
          await tx.studentNote.createMany({
            data: courseStudents.map((student) => ({
              studentId: student.id,
              kind: "إجراء",
              text: `${student.status === "نشط" ? "بدء رصيد فصل جديد" : "استعادة وإعادة تفعيل"} عند الانتقال إلى ${preview.target.chapterName} بثلاث فرص. الحالة السابقة: ${student.status}، الرصيد السابق: ${student.opportunities}/${student.baseOpportunities}${student.dismissalType ? `، نوع الفصل السابق: ${student.dismissalType}` : ""}${student.dismissalReason ? `، السبب السابق: ${student.dismissalReason}` : ""}${student.dismissalNotes ? `، الملاحظات السابقة: ${student.dismissalNotes}` : ""}.`,
              date: now,
              sourceType: SECOND_CHAPTER_TRANSITION_NOTE_SOURCE,
              sourceId: SECOND_CHAPTER_TRANSITION_MARKER_ID,
            })),
          });
        }

        if (courseStudents.length > 0) {
          await tx.opportunityLog.createMany({
            data: courseStudents.map((student) => ({
              studentId: student.id,
              action: "إعادة تعيين",
              amount: TARGET_OPPORTUNITIES,
              reason: SECOND_CHAPTER_SETTLEMENT_REASON,
              date: now,
              chapterId,
              chapterNameSnapshot: preview.target.chapterName,
            })),
          });
        }
        if (restoredStudentIds.length > 0) {
          await tx.opportunityLog.createMany({
            data: restoredStudentIds.map((studentId) => ({
              studentId,
              action: "إعادة تفعيل",
              amount: 0,
              reason: SECOND_CHAPTER_REACTIVATION_REASON,
              date: now,
              chapterId,
              chapterNameSnapshot: preview.target.chapterName,
            })),
          });
        }
      }

      return {
        updatedStudents,
        reactivatedStudents,
        disabledLinks,
        courses: preview.perCourse.map((course) => ({
          courseId: course.courseId,
          courseName: course.courseName,
          students: course.students.total,
        })),
        chapterId,
        chapterName: preview.target.chapterName,
        opportunities: TARGET_OPPORTUNITIES,
      };
    });

    await writeRequestAuditLog(
      req,
      "الفصول والطلاب",
      "انتقال الدورتين إلى الفصل الثاني وإعادة تفعيل جميع الطلاب",
      result,
    );

    return NextResponse.json({
      ok: true,
      message: `تم تفعيل ${result.chapterName} بثلاث فرص لدورتي ${result.courses.map((course) => `«${course.courseName}»`).join(" و")}، وإعادة تفعيل ${result.reactivatedStudents} طالب، وضبط ${result.updatedStudents} طالب على 3/3.`,
      ...result,
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return transitionErrorResponse(error);
  }
}
