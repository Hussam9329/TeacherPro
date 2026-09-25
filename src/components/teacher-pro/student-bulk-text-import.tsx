"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useTeacherStore,
  type Course,
  type Student,
} from "@/lib/teacher-store";
import {
  studentApi,
  studentRegisterApi,
  type StudentBulkPreviewResponse,
  type StudentRegisterContextResponse,
  type StudentRegisterContextRow,
} from "@/lib/api";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/lib/user-toast";
import {
  ClipboardCheck,
  Eye,
  Loader2,
  PlusCircle,
  ShieldAlert,
} from "lucide-react";
import { toLatinDigits } from "@/lib/format";
import { formatOpportunityBalance } from "@/lib/opportunity-balance";
import {
  COURSE_PROGRAMS,
  COURSE_TERMS,
  STUDY_TYPES,
  OUT_OF_COUNTRY_LOCATION_SCOPE,
  getBaghdadMode,
  getProvinceOptions,
  resolveSubSite,
  validateStudentCourseChoices,
} from "@/lib/course-config";
import { normalizeIraqiProvinceName } from "@/lib/iraq";
import {
  normalizePhoneForDuplicate,
  normalizeStudentName,
  normalizeTelegramIdentifier,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import "./student-bulk-text-import.css";

const EXPECTED_COLUMNS = 14;
// Older sheets had a «فترة السماح» column after «الفرص». It is ignored now:
// grace is managed only from «إدارة فترة السماح».
const LEGACY_GRACE_COLUMN_INDEX = 11;
const LEGACY_GRACE_CELL_PATTERN = /^[0-9٠-٩]{1,2}(?:\s*(?:يوم|يوماً|يوما|أيام|ايام))?$/;
const COLUMN_NAMES = [
  "اسم الطالب",
  "المدرسة",
  "الجنس",
  "الدورة",
  "نوع الدورة",
  "الكورس",
  "نوع البرنامج",
  "الموقع الرئيسي",
  "الموقع الفرعي",
  "الحالة",
  "الفرص",
  "رقم هاتف الطالب",
  "رقم ولي الأمر",
  "معرف التيليجرام",
];

const SAMPLE_TEXT = `مراد سلمان سرحان سلمان\tالياسمين للبنين\tذكر\tالدورة الصيفية\tمنهج كامل\t\tإلكتروني\tبغداد\tبغداد - عموم بغداد\tنشط\t0\t7505687475\t7505374138\tMorad_SS2
نور العباس فوزي عبد الحسين منصور\tثانوية الشهيد ابو مهدي المهندس للمتفوقين\tذكر\tالدورة الصيفية\tكورسات\tالكورس الأول\tمدمج\tبغداد\tبغداد - عموم بغداد\tنشط\t0\t7724959157\t7717701265\tABAAS_554
رانيا فراس خليل ابراهيم\tصفية بنت عبد المطلب\tأنثى\tالدورة الصيفية\tكورسات\tالكورس الأول\tمدمج\tبغداد\tبغداد - عموم بغداد\tنشط\t0\t7516470445\t7500948615\tra_9rr9
هبه الله سلمان لفته\tثانويه النضال\tأنثى\tالدورة الصيفية\tكورسات\tالكورس الأول\tمدمج\tبغداد\tبغداد - عموم بغداد\tنشط\t0\t7747247967\t7704768926\tHibaallha`;

type BulkStudentDraft = Omit<
  Student,
  "id" | "code" | "dismissalReason" | "dismissalNotes"
> & {
  dismissalReason?: string;
  dismissalNotes?: string;
};

type PreviewRow = {
  rowNumber: number;
  rawCells: string[];
  student: BulkStudentDraft | null;
  errors: string[];
  warnings: string[];
  activeChapterName?: string;
};

type PreviewCategory =
  "ready" | "needsEdit" | "duplicate" | "unknownCourseOrLocation";
type ImportPolicy = "valid-only" | "fail-on-error";

const PREVIEW_CATEGORY_COPY: Record<
  PreviewCategory,
  { title: string; description: string; badge: string }
> = {
  ready: {
    title: "جاهز للاستيراد",
    description: "هذه الأسطر لا تحتوي على أخطاء مانعة ويمكن استيرادها الآن.",
    badge: "صالح",
  },
  needsEdit: {
    title: "يحتاج تعديل",
    description:
      "بيانات ناقصة أو غير صحيحة مثل الاسم، الهاتف، الجنس، الحالة، أو عدد الأعمدة.",
    badge: "يحتاج تعديل",
  },
  duplicate: {
    title: "مكرر",
    description: "أسطر تتعارض مع طالب موجود أو تتكرر داخل النص نفسه.",
    badge: "مكرر",
  },
  unknownCourseOrLocation: {
    title: "غير معروف الدورة/الموقع",
    description:
      "الدورة غير موجودة، أو نوع البرنامج/الموقع غير مفعّل ضمن إعدادات الدورة.",
    badge: "دورة/موقع",
  },
};

function normalizeText(value: string): string {
  return toLatinDigits(value || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizePhone(value: string): string {
  const digits = toLatinDigits(value || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("7")) return `0${digits}`;
  if (digits.startsWith("9647") && digits.length >= 13)
    return `0${digits.slice(3, 13)}`;
  if (digits.startsWith("009647") && digits.length >= 15)
    return `0${digits.slice(5, 15)}`;
  return digits.slice(0, 11);
}

function normalizeGender(value: string): "ذكر" | "أنثى" | "" {
  const normalized = normalizeText(value);
  if (normalized === "ذكر") return "ذكر";
  if (normalized === "انثي" || normalized === "انثى" || normalized === "انثه")
    return "أنثى";
  return "";
}

function normalizeProgram(value: string): "منهج كامل" | "كورسات" | "" {
  const normalized = normalizeText(value);
  if (normalized === normalizeText("منهج كامل")) return "منهج كامل";
  if (normalized === normalizeText("كورسات")) return "كورسات";
  return "";
}

function normalizeCourseTerm(
  value: string,
): "الكورس الأول" | "الكورس الثاني" | "" {
  const normalized = normalizeText(value);
  if (
    normalized === normalizeText("الكورس الأول") ||
    normalized === normalizeText("كورس اول") ||
    normalized === normalizeText("الكورس الاول")
  ) {
    return "الكورس الأول";
  }
  if (
    normalized === normalizeText("الكورس الثاني") ||
    normalized === normalizeText("كورس ثاني")
  ) {
    return "الكورس الثاني";
  }
  return "";
}

function normalizeStudyType(value: string): "إلكتروني" | "حضوري" | "مدمج" | "" {
  const normalized = normalizeText(value).replace(/الكتروني/g, "الكتروني");
  if (normalized === normalizeText("إلكتروني") || normalized === "الكتروني")
    return "إلكتروني";
  if (normalized === normalizeText("حضوري")) return "حضوري";
  if (normalized === normalizeText("مدمج")) return "مدمج";
  return "";
}

function normalizeStatus(value: string): "نشط" | "مفصول" | "" {
  const normalized = normalizeText(value);
  if (!normalized || normalized === normalizeText("نشط")) return "نشط";
  if (normalized === normalizeText("مفصول")) return "مفصول";
  return "";
}

function normalizeLocationScope(
  value: string,
): "بغداد" | "محافظات" | "خارج القطر" | "" {
  const normalized = normalizeText(value);
  if (normalized.includes("خارج")) return OUT_OF_COUNTRY_LOCATION_SCOPE;
  if (normalized.includes("بغداد")) return "بغداد";
  if (normalized.includes("محافظ")) return "محافظات";
  if (value.trim()) return "محافظات";
  return "";
}

function normalizeSubSite(
  locationScope: string,
  rawMain: string,
  rawSub: string,
): string {
  const source = (rawSub || rawMain || "").trim();
  const normalized = normalizeText(source);
  if (locationScope === "بغداد") {
    if (!source || normalized.includes("عموم بغداد")) return "عموم بغداد";
    return source.replace(/^بغداد\s*[-–—/]\s*/i, "").trim() || "عموم بغداد";
  }
  if (locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE) {
    return source.replace(/^خارج\s*القطر\s*[-–—/]\s*/i, "").trim();
  }
  return normalizeIraqiProvinceName(source || rawMain);
}

function parseInteger(value: string, fallback = 0): number {
  const digits = toLatinDigits(value || "").replace(/[^\d-]/g, "");
  if (!digits) return fallback;
  const numeric = Number(digits);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : fallback;
}

function hasLegacyGraceColumn(cells: string[]): boolean {
  return (
    cells.length === EXPECTED_COLUMNS + 1 ||
    (cells.length === EXPECTED_COLUMNS &&
      LEGACY_GRACE_CELL_PATTERN.test(cells[LEGACY_GRACE_COLUMN_INDEX] || ""))
  );
}

function splitRows(rawText: string): string[][] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t").map((cell) => cell.trim()));
}

function findCourse(courses: Course[], courseName: string) {
  const key = normalizeText(courseName);
  return courses.find((course) => normalizeText(course.name) === key) ?? null;
}

function normalizeRegisterContextCourse(
  row: StudentRegisterContextRow,
): Course {
  return {
    ...(row.course as Record<string, unknown>),
    id: String(row.course.id || row.id),
    name: String(row.course.name || ""),
    active: row.course.active !== undefined ? Boolean(row.course.active) : true,
    createdAt: row.course.createdAt
      ? String(row.course.createdAt).slice(0, 10)
      : baghdadTodayKey(),
    availablePrograms: Array.isArray(row.course.availablePrograms)
      ? row.course.availablePrograms.map(String)
      : [],
    availableStudyTypes: Array.isArray(row.course.availableStudyTypes)
      ? row.course.availableStudyTypes.map(String)
      : [],
    studyTypesByProgram:
      row.course.studyTypesByProgram &&
      typeof row.course.studyTypesByProgram === "object"
        ? (row.course.studyTypesByProgram as Course["studyTypesByProgram"])
        : {},
    locationConfig:
      row.course.locationConfig && typeof row.course.locationConfig === "object"
        ? (row.course.locationConfig as Course["locationConfig"])
        : {},
  };
}

function getBulkCreateResponse(data: unknown): {
  count?: number;
  warnings?: string[];
  source?: string;
} {
  return data && typeof data === "object"
    ? (data as { count?: number; warnings?: string[]; source?: string })
    : {};
}

function getBulkPreviewResponse(
  data: unknown,
): StudentBulkPreviewResponse | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as Partial<StudentBulkPreviewResponse>;
  if (candidate.source !== "database" || !Array.isArray(candidate.rows)) {
    return null;
  }
  return candidate as StudentBulkPreviewResponse;
}

function phoneLabel(phone: string) {
  return phone || "—";
}

function isDuplicateIssue(message: string): boolean {
  return /مكرر|مسجل مسبق|موجود مسبق/.test(message);
}

function isUnknownCourseOrLocationIssue(message: string): boolean {
  return /الدورة غير موجودة|الدورة المحددة غير موجودة|موقوفة عن التسجيل|أكثر من فصل نشط|غير متاح|غير مفعّلة|غير مفعله|الموقع|موقع بغداد|محافظة|بغداد/.test(
    message,
  );
}

function getPreviewCategory(row: PreviewRow): PreviewCategory {
  if (row.errors.length === 0) return "ready";
  if (row.errors.some(isDuplicateIssue)) return "duplicate";
  if (row.errors.some(isUnknownCourseOrLocationIssue))
    return "unknownCourseOrLocation";
  return "needsEdit";
}

export function StudentBulkTextImportView() {
  const syncKey = useTeacherProSyncKey([
    "students",
    "courses",
    "opportunities",
    "dashboard",
    "bulk-import",
  ]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const { loadFromServer } = useTeacherStore();
  const [rawText, setRawText] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewDone, setPreviewDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importPolicy, setImportPolicy] = useState<ImportPolicy>("valid-only");
  const [registerContext, setRegisterContext] =
    useState<StudentRegisterContextResponse | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState("");

  const loadBulkContext = useCallback(async (silent = false) => {
    if (!silent) setContextLoading(true);
    if (!silent) setContextError("");
    try {
      const context = await studentRegisterApi.context();
      if (!context) {
        if (!silent) {
          setRegisterContext(null);
          setContextError("تعذر تحميل بيانات التسجيل الجماعي.");
        }
        return;
      }
      setRegisterContext(context);
    } catch {
      if (!silent) {
        setRegisterContext(null);
        setContextError("تعذر تحميل بيانات التسجيل الجماعي. حاول مجدداً.");
      }
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBulkContext(isBackgroundSync());
  }, [loadBulkContext, syncKey, isBackgroundSync]);

  const groupedPreviewRows = useMemo(() => {
    const groups: Record<PreviewCategory, PreviewRow[]> = {
      ready: [],
      needsEdit: [],
      duplicate: [],
      unknownCourseOrLocation: [],
    };

    for (const row of previewRows) {
      groups[getPreviewCategory(row)].push(row);
    }

    return groups;
  }, [previewRows]);

  const summary = useMemo(() => {
    const ready = groupedPreviewRows.ready.filter((row) => row.student).length;
    const blockingRows = previewRows.filter(
      (row) => row.errors.length > 0,
    ).length;
    const warningRows = previewRows.filter(
      (row) => row.warnings.length > 0 && row.errors.length === 0,
    ).length;
    return {
      total: previewRows.length,
      ready,
      blockingRows,
      warningRows,
      needsEdit: groupedPreviewRows.needsEdit.length,
      duplicate: groupedPreviewRows.duplicate.length,
      unknownCourseOrLocation:
        groupedPreviewRows.unknownCourseOrLocation.length,
    };
  }, [groupedPreviewRows, previewRows]);

  const canImport =
    previewDone &&
    summary.ready > 0 &&
    !isPreviewing &&
    !isImporting &&
    !contextLoading &&
    Boolean(registerContext) &&
    (importPolicy === "valid-only" || summary.blockingRows === 0);

  const contextRows = useMemo(
    () => registerContext?.rows || [],
    [registerContext],
  );
  const contextCourses = useMemo(
    () => contextRows.map(normalizeRegisterContextCourse),
    [contextRows],
  );
  const contextRowByCourseId = useMemo(
    () => new Map(contextRows.map((row) => [row.id, row])),
    [contextRows],
  );

  const buildPreview = async () => {
    if (isPreviewing) return;
    if (contextLoading) {
      toast.error("انتظر اكتمال تحميل بيانات التسجيل الجماعي");
      return;
    }
    if (!registerContext) {
      toast.error("تعذر فحص التسجيل الجماعي", {
        description:
          contextError || "تعذر تحميل الدورات.",
      });
      return;
    }

    const parsedRows = splitRows(rawText);
    if (parsedRows.length === 0) {
      toast.error("الصق بيانات الطلاب أولاً");
      setPreviewRows([]);
      setPreviewDone(false);
      return;
    }
    setPreviewRows([]);
    setPreviewDone(false);

    const result: PreviewRow[] = parsedRows.map((pastedCells, index) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const rowNumber = index + 1;
      const legacyGraceColumn = hasLegacyGraceColumn(pastedCells);
      const cells = legacyGraceColumn
        ? pastedCells.filter((_, cellIndex) => cellIndex !== LEGACY_GRACE_COLUMN_INDEX)
        : pastedCells;
      if (legacyGraceColumn) {
        warnings.push(
          "تم تجاهل عمود «فترة السماح»؛ فترة السماح تُضاف من «إدارة فترة السماح».",
        );
      }

      if (cells.length !== EXPECTED_COLUMNS) {
        errors.push(`عدد الأعمدة ${cells.length}، المطلوب ${EXPECTED_COLUMNS}`);
        return { rowNumber, rawCells: cells, student: null, errors, warnings };
      }

      const [
        nameRaw,
        schoolRaw,
        genderRaw,
        courseNameRaw,
        programRaw,
        termRaw,
        studyTypeRaw,
        locationScopeRaw,
        subSiteRaw,
        statusRaw,
        opportunitiesRaw,
        phoneRaw,
        parentPhoneRaw,
        telegramRaw,
      ] = cells;

      const course = findCourse(contextCourses, courseNameRaw);
      const courseRow = course ? contextRowByCourseId.get(course.id) : null;
      const gender = normalizeGender(genderRaw);
      const courseProgram = normalizeProgram(programRaw);
      const courseTerm = normalizeCourseTerm(termRaw);
      const studyType = normalizeStudyType(studyTypeRaw);
      const locationScope = normalizeLocationScope(locationScopeRaw);
      const subSite = normalizeSubSite(
        locationScope,
        locationScopeRaw,
        subSiteRaw,
      );
      const baghdadMode =
        locationScope === "بغداد"
          ? course && studyType
            ? (getBaghdadMode(course, studyType) ?? "عموم بغداد")
            : "عموم بغداد"
          : "";
      const status = normalizeStatus(statusRaw);
      const phone = normalizePhone(phoneRaw);
      const parentPhone = normalizePhone(parentPhoneRaw);
      const telegram = sanitizeTelegramInput(telegramRaw);
      const inputOpportunities = parseInteger(opportunitiesRaw, 0);
      const opportunities = courseRow?.activeChapter
        ? Math.max(
            0,
            Math.trunc(Number(courseRow.activeChapter.opportunities || 0)),
          )
        : 0;
      const hasActiveChapter = Boolean(
        courseRow?.activeChapter &&
          Number(courseRow.activeChapterCount || 0) === 1,
      );

      if (!nameRaw.trim()) errors.push("اسم الطالب مطلوب");
      if (!schoolRaw.trim()) errors.push("المدرسة مطلوبة");
      if (!gender) errors.push("الجنس يجب أن يكون ذكر أو أنثى");
      if (!course) errors.push(`الدورة غير موجودة: ${courseNameRaw || "—"}`);
      if (course && course.active === false)
        errors.push("هذه الدورة موقوفة عن التسجيل حالياً");
      if (courseRow?.activeChapterCount && courseRow.activeChapterCount > 1) {
        errors.push(
          "هذه الدورة تحتوي أكثر من فصل نشط. أصلح الفصول والفرص قبل التسجيل الجماعي.",
        );
      }
      if (!courseProgram || !COURSE_PROGRAMS.includes(courseProgram))
        errors.push("نوع الدورة يجب أن يكون منهج كامل أو كورسات");
      if (
        courseProgram === "كورسات" &&
        (!courseTerm || !COURSE_TERMS.includes(courseTerm))
      )
        errors.push(
          "عند اختيار كورسات يجب تحديد الكورس الأول أو الكورس الثاني",
        );
      if (!studyType || !STUDY_TYPES.includes(studyType))
        errors.push("نوع البرنامج يجب أن يكون إلكتروني أو حضوري أو مدمج");
      if (!locationScope) errors.push("الموقع الرئيسي مطلوب");
      if (!subSite) errors.push("الموقع الفرعي مطلوب");
      if (!status) errors.push("الحالة يجب أن تكون نشط أو مفصول");
      if (!/^07\d{9}$/.test(phone))
        errors.push(`رقم الطالب غير صالح: ${phoneLabel(phone)}`);
      if (!/^07\d{9}$/.test(parentPhone))
        errors.push(`رقم ولي الأمر غير صالح: ${phoneLabel(parentPhone)}`);

      if (
        courseRow &&
        course &&
        course.active !== false &&
        (courseRow.activeChapterCount || 0) === 0
      ) {
        warnings.push(
          "لا يوجد فصل نشط لهذه الدورة؛ سيُسجل الطالب بدون فرص.",
        );
      } else if (courseRow?.activeChapter && opportunities <= 0) {
        warnings.push(
          `الفصل النشط "${courseRow.activeChapter.name || "—"}" فرصه 0؛ الطالب سيبدأ بدون فرص.`,
        );
      }
      if (courseRow?.activeChapter && inputOpportunities !== opportunities) {
        warnings.push(
          `تم تجاهل عمود الفرص (${inputOpportunities}) واعتماد فرص الفصل النشط: ${opportunities}.`,
        );
      }

      if (course && courseProgram && studyType && locationScope) {
        const validation = validateStudentCourseChoices(course, {
          courseProgram,
          courseTerm: courseProgram === "كورسات" ? courseTerm : "",
          studyType,
          locationScope,
          baghdadMode,
          subSite,
        });
        if (!validation.ok) errors.push(validation.error);
      }

      if (course && studyType && locationScope === "محافظات") {
        const provinces = getProvinceOptions(course, studyType);
        if (provinces.length > 0 && !provinces.includes(subSite)) {
          errors.push(
            `المحافظة "${subSite}" غير مفعّلة لهذه الدورة/نوع البرنامج`,
          );
        }
      }

      const student: BulkStudentDraft | null =
        errors.length === 0 &&
        course &&
        gender &&
        courseProgram &&
        studyType &&
        locationScope &&
        status
          ? {
              name: nameRaw.trim(),
              school: schoolRaw.trim(),
              gender,
              phone,
              parentPhone,
              telegram,
              courseProgram,
              courseTerm: courseProgram === "كورسات" ? courseTerm : "",
              studyType,
              locationScope,
              baghdadMode,
              courseId: course.id,
              mainSite: locationScope,
              subSite: course
                ? resolveSubSite(
                    course,
                    studyType,
                    locationScope,
                    baghdadMode,
                    subSite,
                  )
                : subSite,
              status,
              dismissalReason: "",
              dismissalNotes: "",
              createdAt: baghdadTodayKey(),
              opportunities,
              baseOpportunities: opportunities,
              opportunityLimit: opportunities,
              opportunitySource: "student-record",
              opportunityLimitSource: hasActiveChapter
                ? "active-chapter"
                : "no-active-chapter",
              opportunityHealth: hasActiveChapter
                ? opportunities > 0
                  ? "ready"
                  : "zero-limit"
                : "missing-active-chapter",
              hasActiveChapter,
              activeChapterConflictCount: Number(
                courseRow?.activeChapterCount || 0,
              ),
              // Registration context intentionally exposes only the chapter
              // name and cap, not a chapter ID. The explicit opportunityLimit
              // is sufficient for the shared display formatter.
              activeChapter: null,
              isOpportunityFull: hasActiveChapter && opportunities > 0,
              isOpportunityOverLimit: false,
            }
          : null;

      return {
        rowNumber,
        rawCells: cells,
        student,
        errors,
        warnings,
        activeChapterName: courseRow?.activeChapter?.name || undefined,
      };
    });

    const nameMap = new Map<string, number>();
    const phoneMap = new Map<string, number>();
    const telegramMap = new Map<string, number>();
    const parentPhoneMap = new Map<string, number>();

    for (const row of result) {
      if (!row.student) continue;
      const nameKey = normalizeStudentName(row.student.name);
      const phoneKey = normalizePhoneForDuplicate(row.student.phone);
      const telegramKey = normalizeTelegramIdentifier(row.student.telegram);
      const parentPhoneKey = normalizePhoneForDuplicate(
        row.student.parentPhone,
      );

      if (nameKey) {
        const previous = nameMap.get(nameKey);
        if (previous)
          row.errors.push(`الاسم مكرر داخل النص مع السطر ${previous}`);
        else nameMap.set(nameKey, row.rowNumber);
      }
      if (phoneKey) {
        const previous = phoneMap.get(phoneKey);
        if (previous)
          row.errors.push(`رقم الطالب مكرر داخل النص مع السطر ${previous}`);
        else phoneMap.set(phoneKey, row.rowNumber);
      }
      if (telegramKey) {
        const previous = telegramMap.get(telegramKey);
        if (previous)
          row.errors.push(`معرف التيليجرام مكرر داخل النص مع السطر ${previous}`);
        else telegramMap.set(telegramKey, row.rowNumber);
      }
      if (parentPhoneKey) {
        const previous = parentPhoneMap.get(parentPhoneKey);
        if (previous)
          row.warnings.push(
            `رقم ولي الأمر مكرر داخل النص مع السطر ${previous}`,
          );
        else parentPhoneMap.set(parentPhoneKey, row.rowNumber);
      }
    }

    const databaseCandidates = result.filter(
      (row): row is PreviewRow & { student: BulkStudentDraft } =>
        Boolean(row.student) && row.errors.length === 0,
    );
    if (databaseCandidates.length > 0) {
      setIsPreviewing(true);
      try {
        const databaseResult = await studentApi.bulkPreview(
          databaseCandidates.map((row) => ({
            ...row.student,
            previewRowNumber: row.rowNumber,
          })) as Array<Record<string, unknown>>,
        );
        if (!databaseResult.ok) {
          toast.error("تعذر إكمال المعاينة", {
            description:
              databaseResult.error || "تحقق من الاتصال ثم حاول مرة أخرى.",
          });
          return;
        }
        const databasePreview = getBulkPreviewResponse(databaseResult.data);
        if (!databasePreview) {
          toast.error("نتيجة المعاينة غير مكتملة", {
            description: "أعد المحاولة قبل تنفيذ الإضافة.",
          });
          return;
        }

        const serverByRow = new Map(
          databasePreview.rows.map((row) => [row.rowNumber, row]),
        );
        for (const row of databaseCandidates) {
          const serverRow = serverByRow.get(row.rowNumber);
          if (!serverRow) {
            toast.error("تعذر مطابقة نتيجة المعاينة مع السطور", {
              description: "أعد المحاولة قبل تنفيذ الإضافة.",
            });
            return;
          }
          if (serverRow.duplicateMessage) {
            row.errors.push(
              serverRow.duplicateMessage.replace(
                /^لا يمكن إضافة الطالب:\s*/,
                "",
              ),
            );
          }
          for (const warning of serverRow.warnings || []) {
            if (!row.warnings.includes(warning)) row.warnings.push(warning);
          }
        }
      } catch {
        toast.error("تعذر الاتصال لإكمال المعاينة", {
          description: "لم يتم اعتماد أي نتيجة. تحقق من الاتصال وحاول مجدداً.",
        });
        return;
      } finally {
        setIsPreviewing(false);
      }
    }

    setPreviewRows(result);
    setPreviewDone(true);
    const errorsCount = result.filter((row) => row.errors.length > 0).length;
    const readyCount = result.filter(
      (row) => row.student && row.errors.length === 0,
    ).length;
    if (errorsCount > 0) {
      toast.error("المعاينة اكتملت مع أخطاء", {
        description: `جاهز ${readyCount} سطر، ويحتاج ${errorsCount} سطر إلى مراجعة`,
      });
    } else {
      toast.success("اكتملت المعاينة", {
        description: `جاهز لإضافة ${result.length} طالب بعد التأكيد`,
      });
    }
  };

  const confirmImport = async () => {
    if (!previewDone || isImporting) return;
    if (importPolicy === "fail-on-error" && summary.blockingRows > 0) {
      toast.error("تم إلغاء الاستيراد حسب السياسة المختارة", {
        description:
          "صحح كل الأسطر الخاطئة أو غيّر السياسة إلى استيراد الصحيح فقط.",
      });
      return;
    }

    const studentsToImport = previewRows
      .filter(
        (row): row is PreviewRow & { student: BulkStudentDraft } =>
          Boolean(row.student) && row.errors.length === 0,
      )
      .map((row) => row.student);

    if (studentsToImport.length === 0) {
      toast.error("لا توجد أسطر جاهزة للاستيراد");
      return;
    }

    setIsImporting(true);
    const result = await studentApi.bulkAdd(
      studentsToImport as unknown as Array<Record<string, unknown>>,
    );
    setIsImporting(false);
    setConfirmOpen(false);

    if (!result.ok) {
      toast.error("تعذرت الإضافة الجماعية", { description: result.error });
      return;
    }

    const response = getBulkCreateResponse(result.data);
    await loadFromServer();
    await loadBulkContext();
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: "إضافة جماعية للطلاب",
      scopes: ["students", "opportunities", "dashboard", "bulk-import", "logs"],
    });
    toast.success("تمت الإضافة الجماعية", {
      description: `تمت إضافة ${response.count ?? studentsToImport.length} طالب إلى سجل الطلاب${response.warnings?.length ? `، مع ${response.warnings.length} تنبيه فرص` : ""}`,
    });
    setRawText("");
    setPreviewRows([]);
    setPreviewDone(false);
  };

  const renderPreviewRow = (row: PreviewRow) => {
    const courseName = row.rawCells[3] || "—";
    const category = getPreviewCategory(row);

    return (
      <tr key={row.rowNumber} className="border-b align-top last:border-b-0">
        <td className="p-3 font-bold">{row.rowNumber}</td>
        <td className="p-3">
          <div className="font-bold">
            {row.student?.name || row.rawCells[0] || "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {row.student?.school || row.rawCells[1] || "—"}
          </div>
        </td>
        <td className="p-3">{courseName}</td>
        <td className="p-3">
          {row.student?.courseProgram || row.rawCells[4] || "—"}
        </td>
        <td className="p-3">
          {row.student?.studyType || row.rawCells[6] || "—"}
        </td>
        <td className="p-3">
          {row.student
            ? `${row.student.locationScope} - ${row.student.subSite}`
            : row.rawCells[8] || row.rawCells[7] || "—"}
        </td>
        <td className="p-3">
          <div className="font-black">
            {row.student ? formatOpportunityBalance(row.student) : "—"}
          </div>
          {row.activeChapterName && (
            <div className="text-[11px] text-muted-foreground">
              {row.activeChapterName}
            </div>
          )}
        </td>
        <td className="p-3 dir-ltr text-left">
          {row.student?.phone || normalizePhone(row.rawCells[11] || "") || "—"}
        </td>
        <td className="p-3">{row.student?.status || row.rawCells[9] || "—"}</td>
        <td className="p-3">
          {row.errors.length === 0 ? (
            <div className="space-y-2">
              <Badge variant="secondary">
                <ClipboardCheck className="size-3" />
                {PREVIEW_CATEGORY_COPY.ready.badge}
              </Badge>
              {row.warnings.map((warning, index) => (
                <div
                  key={index}
                  className="text-xs leading-5 text-warning"
                >
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <Badge
                variant={
                  category === "duplicate" ||
                  category === "unknownCourseOrLocation"
                    ? "destructive"
                    : "outline"
                }
              >
                {PREVIEW_CATEGORY_COPY[category].badge}
              </Badge>
              <div className="space-y-1">
                {row.errors.map((error, index) => (
                  <div
                    key={index}
                    className="text-xs leading-5 text-danger"
                  >
                    • {error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="tp-management-page tp-bulk-import-page space-y-4">
      <Card className="tp-management-action-card tp-bulk-import__input-card">
        <CardHeader>
          <div className="tp-bulk-import__heading">
            <CardTitle className="text-base">بيانات الطلاب</CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setRawText(SAMPLE_TEXT);
                setPreviewDone(false);
              }}
              disabled={isPreviewing}
            >
              وضع المثال
            </Button>
          </div>
        </CardHeader>
        <CardContent className="tp-bulk-import__input">
          <details className="tp-bulk-import__format">
            <summary>ترتيب الأعمدة ({EXPECTED_COLUMNS})</summary>
            <ol>
              {COLUMN_NAMES.map((name, index) => (
                <li key={name}>
                  <span>{index + 1}</span>
                  {name}
                </li>
              ))}
            </ol>
            <p>
              التسجيل الجماعي لا يعتمد على عمود الفرص المكتوب بالنص؛ فرص البداية
              تُحسب من الفصل النشط للدورة، والدورة الموقوفة أو ذات تعارض الفصول
              تُرفض قبل الإضافة.
            </p>
          </details>

          <label className="sr-only" htmlFor="bulk-student-text">
            نص بيانات الطلاب
          </label>
          <textarea
            id="bulk-student-text"
            dir="rtl"
            value={rawText}
            disabled={isPreviewing}
            onChange={(event) => {
              setRawText(event.target.value);
              setPreviewDone(false);
            }}
            placeholder="الصق بيانات الطلاب هنا، كل طالب في سطر مستقل…"
            className="tp-bulk-import__textarea"
          />

          <div className="tp-bulk-import__input-footer">
            <div
              className="min-w-0 text-xs text-muted-foreground"
              role="status"
            >
              {contextLoading ? "جارٍ تجهيز بيانات التسجيل" : null}
            </div>
            <div className="tp-bulk-import__actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRawText("");
                  setPreviewRows([]);
                  setPreviewDone(false);
                }}
                disabled={isPreviewing}
              >
                مسح
              </Button>
              <Button
                type="button"
                onClick={buildPreview}
                disabled={isPreviewing || contextLoading || !registerContext}
              >
                {isPreviewing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Eye className="size-4" />
                )}
                {isPreviewing ? "جارٍ الفحص…" : "معاينة وفحص"}
              </Button>
            </div>
          </div>
          {contextError ? (
            <div className="tp-bulk-import__context-error" role="alert">
              {contextError}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {previewDone && (
        <div className="tp-management-workspace">
          <section
            className="tp-management-main-flow"
            aria-label="معاينة الطلاب"
          >
            <Card className="tp-management-results-card">
              <CardHeader>
                <div className="tp-bulk-import__heading">
                  <CardTitle className="text-base">نتيجة المعاينة</CardTitle>
                  <p className="tp-management-count-summary text-xs text-muted-foreground">
                    {summary.total} سطر
                  </p>
                </div>
              </CardHeader>
              <CardContent className="tp-bulk-import__preview">
                <fieldset className="tp-bulk-import__policy">
                  <legend>طريقة الاستيراد</legend>
                  <RadioGroup
                    value={importPolicy}
                    onValueChange={(value) =>
                      setImportPolicy(value as ImportPolicy)
                    }
                    aria-label="طريقة الاستيراد"
                    className="tp-bulk-import__policy-options"
                  >
                    <label
                      className="tp-bulk-import__policy-option"
                      data-selected={importPolicy === "valid-only"}
                    >
                      <RadioGroupItem value="valid-only" />
                      <span>
                        <span className="block font-bold">
                          استيراد الصحيح فقط
                        </span>
                        <span className="tp-bulk-import__policy-description">
                          إضافة الأسطر الجاهزة وتجاهل الأسطر التي تحتوي أخطاء.
                        </span>
                      </span>
                    </label>
                    <label
                      className="tp-bulk-import__policy-option"
                      data-selected={importPolicy === "fail-on-error"}
                    >
                      <RadioGroupItem value="fail-on-error" />
                      <span>
                        <span className="block font-bold">
                          إلغاء الاستيراد إذا يوجد خطأ واحد
                        </span>
                        <span className="tp-bulk-import__policy-description">
                          لا تبدأ الإضافة إلا بعد أن تكون جميع الأسطر جاهزة.
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                </fieldset>

                {summary.blockingRows > 0 && (
                  <div
                    role="status"
                    className={`rounded-xl border p-3 text-sm leading-7 ${
                      importPolicy === "valid-only"
                        ? "border-warning-line bg-warning-soft text-warning"
                        : "border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft text-danger"
                    }`}
                  >
                    <ShieldAlert className="ml-2 inline size-4" />
                    {importPolicy === "valid-only"
                      ? `سيتم استيراد ${summary.ready} طالب جاهز فقط، وتجاهل ${summary.blockingRows} سطر يحتاج مراجعة.`
                      : `لن يتم الاستيراد لأن هناك ${summary.blockingRows} سطر يحتوي على خطأ مانع.`}
                  </div>
                )}

                {(
                  [
                    "ready",
                    "needsEdit",
                    "duplicate",
                    "unknownCourseOrLocation",
                  ] as PreviewCategory[]
                ).map((category) => {
                  const rows = groupedPreviewRows[category];
                  if (rows.length === 0) return null;
                  const copy = PREVIEW_CATEGORY_COPY[category];

                  return (
                    <section
                      key={category}
                      className="tp-bulk-import__group"
                      aria-labelledby={`bulk-preview-${category}`}
                    >
                      <div className="tp-bulk-import__group-header">
                        <h3
                          id={`bulk-preview-${category}`}
                          className="text-sm font-bold"
                        >
                          {copy.title}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {rows.length} سطر
                        </span>
                      </div>
                      <div
                        className="table-wrap tp-bulk-import__table-scroll max-h-[min(26rem,55dvh)] overflow-auto"
                        tabIndex={0}
                        role="region"
                        aria-label={`معاينة ${copy.title}؛ يمكن تمريرها أفقياً وعمودياً`}
                      >
                        <table className="responsive-table min-w-[980px] text-right text-sm">
                          <caption className="sr-only">
                            {copy.title}: {copy.description}
                          </caption>
                          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                            <tr className="border-b">
                              <th scope="col" className="p-3">
                                السطر
                              </th>
                              <th scope="col" className="p-3">
                                الطالب
                              </th>
                              <th scope="col" className="p-3">
                                الدورة
                              </th>
                              <th scope="col" className="p-3">
                                البرنامج
                              </th>
                              <th scope="col" className="p-3">
                                الدراسة
                              </th>
                              <th scope="col" className="p-3">
                                الموقع
                              </th>
                              <th scope="col" className="p-3">
                                فرص البداية
                              </th>
                              <th scope="col" className="p-3">
                                هاتف الطالب
                              </th>
                              <th scope="col" className="p-3">
                                الحالة
                              </th>
                              <th scope="col" className="p-3">
                                الفحص
                              </th>
                            </tr>
                          </thead>
                          <tbody>{rows.map(renderPreviewRow)}</tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}

                <div className="tp-bulk-import__save-bar">
                  <p className="text-xs leading-6 text-muted-foreground">
                    {importPolicy === "valid-only"
                      ? "سيتم استيراد الأسطر الجاهزة فقط."
                      : "عند الضغط يجب أن تكون كل الأسطر سليمة، وإلا لن يبدأ الاستيراد."}
                  </p>
                  <Button
                    type="button"
                    disabled={!canImport}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <PlusCircle className="size-4" />
                    {importPolicy === "valid-only"
                      ? "استيراد الصحيح فقط"
                      : "إكمال الإضافة"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
          <aside
            className="tp-management-stats-rail"
            aria-label="إحصائيات المعاينة"
          >
            <div className="space-y-2">
              <h3 className="text-sm font-black">إحصائيات المعاينة</h3>
              <div
                className="grid"
                role="group"
                aria-label="إحصائيات المعاينة"
                tabIndex={0}
              >
                {[
                  {
                    label: "الأسطر",
                    value: summary.total,
                    color: "text-primary",
                  },
                  {
                    label: "جاهز للاستيراد",
                    value: summary.ready,
                    color: "text-success",
                  },
                  {
                    label: "يحتاج تعديل",
                    value: summary.needsEdit,
                    color: "text-warning",
                  },
                  {
                    label: "مكرر",
                    value: summary.duplicate,
                    color: "text-danger",
                  },
                  {
                    label: "دورة أو موقع غير معروف",
                    value: summary.unknownCourseOrLocation,
                    color: "text-warning",
                  },
                  {
                    label: "أسطر مع تحذيرات",
                    value: summary.warningRows,
                    color: "text-warning",
                  },
                ].map((stat) => (
                  <Card key={stat.label}>
                    <CardContent className="p-4 text-center">
                      <p className={`text-2xl font-bold ${stat.color}`}>
                        {stat.value}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {stat.label}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الإضافة الجماعية</AlertDialogTitle>
            <AlertDialogDescription>
              {importPolicy === "valid-only" && summary.blockingRows > 0
                ? `سيتم إضافة ${summary.ready} طالب جاهز فقط، ولن يتم إرسال ${summary.blockingRows} سطر يحتاج مراجعة.`
                : `سيتم إضافة ${summary.ready} طالب إلى سجل الطلاب. هل تريد إكمال الإضافة الآن؟`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isImporting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport} disabled={isImporting}>
              {isImporting ? (
                <Loader2 className="ml-2 size-4 animate-spin" />
              ) : (
                <PlusCircle className="ml-2 size-4" />
              )}
              نعم، أضف الطلاب
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
