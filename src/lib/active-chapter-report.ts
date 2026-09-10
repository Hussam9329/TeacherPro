import type { Prisma } from "@prisma/client";
// استيراد نسبي (مثل academic-engine.ts) حتى يبقى الملف قابلاً للاستيراد
// من اختبارات node --experimental-strip-types مباشرة.
import { baghdadDateKey } from "./baghdad-time";
import { CHAPTER_TRANSITION_SETTLEMENT_REASON_PREFIX } from "./second-chapter-transition";

/**
 * سياق «الفصل النشط الحالي» لتقارير إدارة الفرص.
 *
 * القاعدة (حسب طلب المالك): التقرير يعرض فقط درجات امتحانات الفصل النشط
 * الحالي — نحدد شوكت بده الفصل النشط (لحظة انتقال الدورة إليه)، ثم نبدأ من
 * أول امتحان انصنع بعد تلك اللحظة مباشرة.
 *
 * مصدر لحظة الانتقال باليوم: أرشيف الروابط غير المفعلة للدورة. عند تحويل
 * فصل يدوي يُخزَّن على رابط الفصل القديم أرشيف رصيد الطلاب بتاريخ التنفيذ
 * (نفس الآلية في /api/course-chapters/activate)، لذا آخر تاريخ أرشفة عبر
 * الروابط غير المفعلة = يوم تسلّم الفصل النشط الحالي للدورة.
 *
 * مصدر لحظة الانتقال الدقيقة (ضمن نفس اليوم): أقدم حركة تسوية تاريخية
 * (سببها يبدأ بـ"تسوية تاريخية:") موسومة بمعرّف الفصل النشط. الانتقال نفسه
 * يكتب تسوية جماعية بلحظة تنفيذ دقيقة، وكل تسويات ما بعده (تعهدات فاينل
 * الفصل السابق، إعادة التفعيل) تحدث بعد الانتقال بالضرورة — لذلك أقدم
 * طابع زمني موسوم بالفصل النشط هو لحظة الانتقال الفعلية. هذا يحل الالتباس
 * داخل يوم الانتقال: فاينل أُدخل بعد التحويل بقليل يدخل التقرير، وفاينل
 * الفصل السابق المُدخل قبل التحويل بنفس اليوم يبقى مستبعداً.
 *
 * مصدر لحظة إنشاء الامتحان: أقدم درجة مسجلة له (MIN(Grade.createdAt)) —
 * سجل الدرجات يُنشأ بذات العملية التي تنشئ الامتحان (أقدم إدخال = لحظة
 * الإنشاء تقريباً). إن لم توجد درجات نرجع لتاريخ الامتحان نفسه.
 *
 * المقارنة: الامتحان الذي يوم أقدم أثره بعد يوم الانتقال يدخل دائماً،
 * والذي يقع بنفس يوم الانتقال يُحسم بطابع اللحظة الدقيقة (للدرجات فقط —
 * الامتحان بلا درجات يبقى مستبعداً ويوم الانتقال حماية من تسريب فاينل
 * الفصل السابق). ويُعتمد الطابع الدقيق فقط إذا كان ضمن يوم حد الأرشيف
 * نفسه اتساقاً مع حد اليوم.
 */

export type ActiveChapterReportLink = {
  active: boolean;
  archived: boolean;
  archive: string | null;
  chapter: { id: string; name: string };
};

export type ActiveChapterReportExam = {
  id: string;
  date: Date | string | null;
  createdAt?: Date | string | null;
  chapterId?: string | null;
};

export type ActiveChapterReportContext = {
  /** معرف الفصل النشط. */
  id: string;
  /** اسم الفصل النشط (يظهر في عنوان قسم الامتحانات داخل التقرير). */
  name: string;
  /**
   * آخر لحظة انتقال معروفة للفصل النشط (كما وردت في الأرشيف: ISO كامل أو
   * مفتاح يوم) — null إذا لم يحدث أي انتقال بعد (الفصل الأول ما زال نشطاً
   * منذ بداية الدورة، فكل امتحانات الدورة من الفصل النشط).
   */
  since: string | null;
  /**
   * امتحانات الدورة التي انصنعت بعد بداية الفصل النشط فقط — هذه هي
   * الامتحانات التي يُسمح لتقرير HTML ورسالة تيليجرام بعرض درجاتها.
   */
  examIds: string[];
};

/** يستخرج تواريخ مداخل أرشيف ربط فصل (JSON نصي) كما خُزنت. */
export function parseArchiveEntryDates(archive: unknown): string[] {
  const source = typeof archive === "string" ? archive.trim() : "";
  if (!source) return [];
  try {
    const parsed: unknown = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) =>
        String((entry as { date?: unknown })?.date ?? "").trim(),
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * يحسب سياق الفصل النشط من روابط الدورة وامتحاناتها وأقدم أثر لكل امتحان.
 *
 * يعيد null (بلا فلترة — يبقى سلوك التقرير القديم) عندما لا توجد حالة فصل
 * نشط وحيدة معتمدة للدورة، حتى لا يخفي التقرير بيانات بسبب تعارض أو غياب
 * الفصل النشط.
 */
export function computeActiveChapterReportContext(
  links: readonly ActiveChapterReportLink[],
  courseExams: readonly ActiveChapterReportExam[],
  examFirstEvidenceAt: ReadonlyMap<string, Date | string | null>,
  /**
   * لحظة الانتقال الدقيقة (اختيارية): أقدم تسوية تاريخية موسومة بالفصل
   * النشط. تُعتمد فقط إذا كانت ضمن يوم حد الأرشيف نفسها، وتُستخدم لحسم
   * امتحانات أول درجة لها بنفس يوم الانتقال (درجات فقط).
   */
  preciseBoundaryAt?: Date | string | null,
): ActiveChapterReportContext | null {
  const activeLinks = links.filter((link) => link.active && !link.archived);
  if (activeLinks.length !== 1) return null;
  const activeLink = activeLinks[0];

  // حد بداية الفصل النشط = آخر يوم أرشفة عبر الروابط غير المفعلة.
  let boundaryDay = "";
  let since: string | null = null;
  for (const link of links) {
    if (link.active) continue;
    for (const rawDate of parseArchiveEntryDates(link.archive)) {
      const day = baghdadDateKey(rawDate);
      if (day && day > boundaryDay) {
        boundaryDay = day;
        since = rawDate;
      }
    }
  }

  // اللحظة الدقيقة للانتقال داخل يوم الحد: تُعتمد فقط إذا طابقت يوم حد
  // الأرشيف — وإلا فالبيانات غير متسقة ويبقى حسم نفس اليوم على القاعدة
  // اليومية الصارمة (السلوك المحافظ السابق).
  let boundaryTimestamp: Date | null = null;
  if (preciseBoundaryAt) {
    const parsed =
      preciseBoundaryAt instanceof Date
        ? preciseBoundaryAt
        : new Date(preciseBoundaryAt);
    if (
      Number.isFinite(parsed.getTime()) &&
      baghdadDateKey(parsed) === boundaryDay
    ) {
      boundaryTimestamp = parsed;
    }
  }

  const examIds: string[] = [];
  for (const exam of courseExams) {
    // Explicit metadata (including an unresolved assignment) takes precedence
    // over date inference, just as it does in the accounting engine.
    if (exam.chapterId !== undefined) {
      if (exam.chapterId === activeLink.chapter.id) examIds.push(exam.id);
      continue;
    }
    // أقدم أثر لوجود الامتحان: أول درجة له (طابع دقيق)، وإلا تاريخ
    // الامتحان نفسه (بلا دقة زمنية موثوقة).
    const gradeEvidence = exam.createdAt ?? examFirstEvidenceAt.get(exam.id) ?? null;
    const firstEvidence = gradeEvidence ?? exam.date;
    const evidenceDay = baghdadDateKey(firstEvidence ?? null);
    // بلا حد انتقال → كل امتحانات الدورة من الفصل النشط الحالي.
    // بعد يوم الانتقال → يدخل. بنفس يوم الانتقال → يُحسم باللحظة الدقيقة
    // فقط عند وجود طابع درجة (فاينل أُدخل بعد التحويل يدخل، وما دُخل
    // قبله يبقى مستبعداً)، والامتحان بلا درجات يبقى مستبعداً حماية
    // من تسريب فاينل الفصل السابق المؤرخ يوم التحويل.
    let include =
      !boundaryDay || (evidenceDay && evidenceDay > boundaryDay);
    if (
      !include &&
      gradeEvidence &&
      boundaryTimestamp &&
      evidenceDay === boundaryDay
    ) {
      const evidenceTimestamp =
        gradeEvidence instanceof Date
          ? gradeEvidence
          : new Date(gradeEvidence);
      include =
        Number.isFinite(evidenceTimestamp.getTime()) &&
        evidenceTimestamp.getTime() >= boundaryTimestamp.getTime();
    }
    if (include) {
      examIds.push(exam.id);
    }
  }

  return {
    id: activeLink.chapter.id,
    name: activeLink.chapter.name,
    since,
    examIds,
  };
}

export type ActiveChapterOpportunityLogLike = {
  examId?: unknown;
  date?: unknown;
};

/**
 * يقرر هل تنتمي حركة فرص لعرض «الفصل النشط الحالي» في تقرير HTML ورسالة
 * تيليجرام (نفس قاعدة الدرجات — حسب طلب المالك):
 *
 * - حركة مرتبطة بامتحان: تُعرض فقط إذا كان الامتحان من امتحانات الفصل
 *   النشط، مهما كان تاريخ تسجيل الحركة (حتى لو أعاد المحرك توليدها لاحقاً
 *   بسبب تعديل درجة).
 * - حركة بلا امتحان (تسوية انتقال الفصول، تعديل يدوي): تُعرض فقط إذا
 *   وقعت بيوم لحظة الانتقال أو بعدها؛ خصومات الفصل السابق أثرها انمحى
 *   بالتسوية فلا معنى لعرضها داخل تقرير الفصل النشط. بلا انتقال (الفصل
 *   الأول منذ بداية الدورة) تُعرض كلها لأنها كلها ضمن الفصل النشط.
 * - غياب سياق الفصل النشط كلياً: يُعرض كل شيء (السلوك القديم) حتى لا
 *   يخفي التقرير بيانات بسبب غياب الفصل النشط أو تعارضه.
 *
 * مقارنة اليوم بغداد (baghdadDateKey) حتى تعمل الحدود المخزنة كمفتاح يوم
 * أو كطابع زمني كامل بنفس الدقة. التسوية تُسك بلحظة الانتقال نفسها،
 * فيومها يساوي يوم الحد ويدخل بالشرط «>=» المتعمد.
 */
export function opportunityLogWithinActiveChapter(
  log: ActiveChapterOpportunityLogLike | null | undefined,
  context:
    | Pick<ActiveChapterReportContext, "examIds" | "since">
    | null
    | undefined,
): boolean {
  if (!context || !Array.isArray(context.examIds)) return true;
  const examId = String(log?.examId ?? "")
    .trim();
  if (examId) return context.examIds.includes(examId);
  if (!context.since) return true;
  const boundaryDay = baghdadDateKey(context.since);
  const logDay = baghdadDateKey(
    log?.date instanceof Date
      ? log.date
      : typeof log?.date === "string" && log.date.trim()
        ? log.date
        : null,
  );
  return Boolean(boundaryDay && logDay && logDay >= boundaryDay);
}

type ActiveChapterReportDbClient = Pick<
  Prisma.TransactionClient,
  "courseChapter" | "exam" | "grade" | "opportunityLog"
>;

/**
 * يحمل سياق الفصل النشط من قاعدة البيانات بثلاث قراءات مجمعة (بلا N+1):
 * روابط الدورة، امتحانات الدورة (مفعلة وغير مفعلة — الفلترة على الإنشاء لا
 * على التفعيل)، وأقدم درجة لكل امتحان عبر groupBy.
 */
export async function loadActiveChapterReportContext(
  client: ActiveChapterReportDbClient,
  courseId: string,
): Promise<ActiveChapterReportContext | null> {
  const courseIdKey = String(courseId || "").trim();
  if (!courseIdKey) return null;

  const [links, courseExams] = await Promise.all([
    client.courseChapter.findMany({
      where: { courseId: courseIdKey },
      select: {
        active: true,
        archived: true,
        archive: true,
        chapter: { select: { id: true, name: true } },
      },
    }),
    client.exam.findMany({
      where: { courseIds: { contains: `"${courseIdKey}"` } },
      select: { id: true, date: true, createdAt: true, examCourses: { where: { courseId: courseIdKey }, select: { chapterId: true } } },
    }),
  ]);

  // بلا فصل نشط وحيد لا نرجع سياقاً (التقرير يبقى بلا فلترة).
  const activeLinks = links.filter((link) => link.active && !link.archived);
  if (activeLinks.length !== 1) {
    return null;
  }
  const activeLink = activeLinks[0];

  const examIds = courseExams.map((exam) => exam.id);
  const gradeMinRows = examIds.length
    ? await client.grade.groupBy({
        by: ["examId"],
        where: { examId: { in: examIds } },
        _min: { createdAt: true },
      })
    : [];
  const firstEvidenceByExamId = new Map<string, Date | null>(
    gradeMinRows.map((row) => [row.examId, row._min.createdAt ?? null]),
  );

  // اللحظة الدقيقة لانتقال الدورة إلى الفصل النشط: أقدم حركة تسوية تاريخية
  // موسومة بالفصل النشط. الانتقال يكتب تسوية جماعية بلحظة تنفيذه، وكل
  // تسويات ما بعده (تعهدات فاينل الفصل السابق، إعادة التفعيل) لاحقة له
  // بالضرورة — لذلك أقدم طابع زمني هو لحظة الانتقال الفعلية.
  const transitionSettlement = await client.opportunityLog.findFirst({
    where: {
      student: { courseId: courseIdKey },
      chapterId: activeLink.chapter.id,
      reason: { startsWith: CHAPTER_TRANSITION_SETTLEMENT_REASON_PREFIX },
    },
    orderBy: { date: "asc" },
    select: { date: true },
  });

  return computeActiveChapterReportContext(
    links,
    courseExams.map(exam => ({ ...exam, chapterId: exam.examCourses?.[0]?.chapterId ?? null })),
    firstEvidenceByExamId,
    transitionSettlement?.date ?? null,
  );
}
