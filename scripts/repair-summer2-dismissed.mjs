/**
 * One-shot DB repair script — restores the dismissed students of the
 * "الدورة الصيفية الثانية - 1-7-2026" course after the second-chapter transition bug.
 *
 * What it does, transactionally:
 *  1. Targets the course "الدورة الصيفية الثانية - 1-7-2026" and the active
 *     chapter "الفصل الثاني - الانسجة" (opportunities = 3).
 *  2. For every student currently in status "مفصول" in that course:
 *     - Sets status = "نشط"
 *     - Sets opportunities = 3, baseOpportunities = 3
 *     - Clears dismissalReason and dismissalNotes
 *     - Creates an OpportunityLog with action="إعادة تعيين" amount=3
 *       reason="تسوية تاريخية: ..." so the academic engine skips all exam
 *       grades whose exam date is on or before this restoration moment.
 *     - Creates a StudentNote documenting the restoration.
 *  3. Records a single AuditLog entry summarizing the batch.
 *
 * Idempotency: the AuditLog uses a fixed unique id, so re-running the script
 * after a successful run will fail loudly at the AuditLog insert step
 * (P2002 unique constraint violation) without having modified any data first.
 * That is intentional — we never want this repair to silently run twice.
 */
import { PrismaClient } from "@prisma/client";

const SETTLEMENT_REASON =
  "تسوية تاريخية: إصلاح طوارئ لانتقال طلاب الدورة الصيفية الثانية - 1-7-2026 إلى الفصل الثاني - الانسجة؛ تجاهل آثار امتحانات الفصل السابق وبدء رصيد جديد بثلاث فرص";

const AUDIT_LOG_ID =
  "emergency_repair_summer2_chapter2_transition_20260830";

const COURSE_NAME = "الدورة الصيفية الثانية - 1-7-2026";
const CHAPTER_NAME = "الفصل الثاني - الانسجة";

const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

console.log("=== EMERGENCY REPAIR: Summer-2 dismissed students → active + 3/3 ===\n");

try {
  const result = await db.$transaction(
    async (tx) => {
      // 0. Idempotency: refuse to run twice.
      const existing = await tx.auditLog.findUnique({
        where: { id: AUDIT_LOG_ID },
        select: { id: true, time: true },
      });
      if (existing) {
        throw new Error(
          `Repair already ran at ${existing.time}. Aborting to prevent duplicate execution.`,
        );
      }

      // 1. Resolve course + chapter by name (Arabic exact match).
      const course = await tx.course.findFirst({
        where: { name: COURSE_NAME },
        select: { id: true, name: true, active: true },
      });
      if (!course) {
        throw new Error(`Course "${COURSE_NAME}" not found.`);
      }

      const chapter = await tx.chapter.findFirst({
        where: { name: CHAPTER_NAME },
        select: { id: true, name: true, opportunities: true },
      });
      if (!chapter) {
        throw new Error(`Chapter "${CHAPTER_NAME}" not found.`);
      }

      const baseOpportunities = Math.max(
        0,
        Math.trunc(Number(chapter.opportunities || 0)),
      );
      console.log(
        `Course: ${course.name} (id=${course.id}, active=${course.active})`,
      );
      console.log(
        `Chapter: ${chapter.name} (id=${chapter.id}, opportunities=${chapter.opportunities})`,
      );

      // 2. Verify the chapter is actually the active one for this course.
      const activeLink = await tx.courseChapter.findFirst({
        where: {
          courseId: course.id,
          chapterId: chapter.id,
          active: true,
          archived: false,
        },
        select: { id: true },
      });
      if (!activeLink) {
        throw new Error(
          `Chapter "${CHAPTER_NAME}" is not the active chapter for course "${COURSE_NAME}". Refusing to repair.`,
        );
      }

      // 3. Snapshot the dismissed students we are about to restore.
      const dismissedStudents = await tx.student.findMany({
        where: { courseId: course.id, status: "مفصول" },
        select: {
          id: true,
          code: true,
          name: true,
          opportunities: true,
          baseOpportunities: true,
          dismissalReason: true,
          dismissalNotes: true,
        },
        orderBy: { id: "asc" },
      });

      console.log(
        `\nDismissed students in "${course.name}": ${dismissedStudents.length}\n`,
      );
      if (dismissedStudents.length === 0) {
        console.log("Nothing to repair — no dismissed students.");
        return { repaired: 0, skipped: 0 };
      }

      const now = new Date();
      const ids = dismissedStudents.map((s) => s.id);

      // 4. Reset status + opportunities + clear dismissal fields.
      const updateResult = await tx.student.updateMany({
        where: { id: { in: ids }, courseId: course.id, status: "مفصول" },
        data: {
          status: "نشط",
          opportunities: baseOpportunities,
          baseOpportunities,
          dismissalReason: null,
          dismissalNotes: null,
        },
      });
      if (updateResult.count !== dismissedStudents.length) {
        throw new Error(
          `Race condition: only ${updateResult.count} of ${dismissedStudents.length} dismissed students were updated. Aborting.`,
        );
      }
      console.log(`✅ Reactivated ${updateResult.count} students.`);

      // 5. Mint a historical-settlement OpportunityLog per student.
      //    Action "إعادة تعيين" with reason starting "تسوية تاريخية:" makes
      //    the academic engine treat this moment as a settlement boundary, so
      //    all prior exam grades are ignored on every future recalculation.
      await tx.opportunityLog.createMany({
        data: dismissedStudents.map((s) => ({
          studentId: s.id,
          action: "إعادة تعيين",
          amount: baseOpportunities,
          reason: SETTLEMENT_REASON,
          date: now,
          chapterId: chapter.id,
          chapterNameSnapshot: chapter.name,
        })),
      });
      console.log(`✅ Created ${dismissedStudents.length} settlement opportunity logs.`);

      // 6. Mint a StudentNote documenting the restoration for each student.
      await tx.studentNote.createMany({
        data: dismissedStudents.map((s) => ({
          studentId: s.id,
          kind: "إجراء",
          text: `إصلاح طوارئ: إعادة تفعيل الطالب بعد خلل تحويل الفصل إلى «${chapter.name}». الحالة السابقة: مفصول. الرصيد السابق: ${s.opportunities}/${s.baseOpportunities}. السبب السابق: ${s.dismissalReason || "(بدون سبب مسجل)"}. تم ضبط الرصيد على ${baseOpportunities}/${baseOpportunities} فرص من فصل «${chapter.name}» النشط، مع تجاهل آثار امتحانات الفصل السابق.`,
          date: now,
        })),
      });
      console.log(`✅ Created ${dismissedStudents.length} student notes.`);

      // 7. AuditLog summary so the repair is traceable and idempotent.
      await tx.auditLog.create({
        data: {
          id: AUDIT_LOG_ID,
          module: "الفصول والطلاب",
          action:
            "إصلاح طوارئ: إعادة تفعيل طلاب الدورة الصيفية الثانية - 1-7-2026 المفصولين بسبب خلل تحويل الفصل وإعطائهم 3/3 فرص من الفصل الثاني - الانسجة",
          details: JSON.stringify({
            courseId: course.id,
            courseName: course.name,
            chapterId: chapter.id,
            chapterName: chapter.name,
            baseOpportunities,
            repairedStudentIds: ids,
            repairedCount: dismissedStudents.length,
            executedAt: now.toISOString(),
            settlementReason: SETTLEMENT_REASON,
            previousStatuses: dismissedStudents.map((s) => ({
              id: s.id,
              code: s.code,
              name: s.name,
              opportunities: s.opportunities,
              baseOpportunities: s.baseOpportunities,
              dismissalReason: s.dismissalReason,
              dismissalNotes: s.dismissalNotes,
            })),
          }),
          userName: "TeacherPro emergency repair — summer-2 chapter-2 transition",
        },
      });
      console.log(`✅ Wrote audit log ${AUDIT_LOG_ID}.`);

      return {
        repaired: dismissedStudents.length,
        skipped: 0,
      };
    },
    {
      timeout: 120000,
      isolationLevel: "Serializable",
    },
  );

  console.log(
    `\n=== DONE: repaired=${result.repaired} skipped=${result.skipped} ===`,
  );
} catch (err) {
  console.error("\n=== REPAIR FAILED ===");
  console.error(err);
  process.exit(1);
} finally {
  await db.$disconnect();
}
