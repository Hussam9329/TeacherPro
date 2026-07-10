"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  useTeacherStore,
  type Course,
  type Student,
} from "@/lib/teacher-store";
import {
  studentApi,
  studentRegisterApi,
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
  CardDescription,
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
import { toast } from "sonner";
import {
  ClipboardCheck,
  ClipboardPaste,
  Eye,
  Loader2,
  PlusCircle,
  ShieldAlert,
} from "lucide-react";
import { toLatinDigits } from "@/lib/format";
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
  getStudentDuplicateMessage,
  normalizePhoneForDuplicate,
  normalizeStudentName,
  normalizeTelegramIdentifier,
  sanitizeTelegramInput,
} from "@/lib/student-utils";

const EXPECTED_COLUMNS = 15;
const COLUMN_NAMES = [
  "اسم الطالب",
  "المدرسة",
  "الجنس",
  "الدورة",
  "نوع الدورة",
  "الكورس",
  "نوع الدراسة",
  "الموقع الرئيسي",
  "الموقع الفرعي",
  "الحالة",
  "الفرص",
  "فترة السماح",
  "رقم هاتف الطالب",
  "رقم ولي الأمر",
  "معرف التليكرام",
];

const SAMPLE_TEXT = `مراد سلمان سرحان سلمان\tالياسمين للبنين\tذكر\tالدورة الصيفية\tمنهج كامل\t\tإلكتروني\tبغداد\tبغداد - عموم بغداد\tنشط\t0\t0 يوم\t7505687475\t7505374138\tMorad_SS2
نور العباس فوزي عبد الحسين منصور\tثانوية الشهيد ابو مهدي المهندس للمتفوقين\tذكر\tالدورة الصيفية\tكورسات\tالكورس الأول\tمدمج\tبغداد\tبغداد - عموم بغداد\tنشط\t0\t0 يوم\t7724959157\t7717701265\tABAAS_554
رانيا فراس خليل ابراهيم\tصفية بنت عبد المطلب\tأنثى\tالدورة الصيفية\tكورسات\tالكورس الأول\tمدمج\tبغداد\tبغداد - عموم بغداد\tنشط\t0\t0 يوم\t7516470445\t7500948615\tra_9rr9
هبه الله سلمان لفته\tثانويه النضال\tأنثى\tالدورة الصيفية\tكورسات\tالكورس الأول\tمدمج\tبغداد\tبغداد - عموم بغداد\tنشط\t0\t0 يوم\t7747247967\t7704768926\tHibaallha`;

type BulkStudentDraft = Omit<
  Student,
  "id" | "code" | "dismissalType" | "dismissalReason" | "dismissalNotes"
> & {
  dismissalType?: string;
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
  source?: "database";
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
      "الدورة غير موجودة، أو نوع الدراسة/الموقع غير مفعّل ضمن إعدادات الدورة.",
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
      : new Date().toISOString().slice(0, 10),
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
  const { students, loadFromServer, mergeStudentsCache } = useTeacherStore();
  const [rawText, setRawText] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewDone, setPreviewDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
          setContextError("تعذر تحميل سياق التسجيل الجماعي من قاعدة البيانات.");
        }
        return;
      }
      setRegisterContext(context);
    } catch {
      if (!silent) {
        setRegisterContext(null);
        setContextError("تعذر الاتصال بالخادم لتحميل سياق التسجيل الجماعي.");
      }
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBulkContext(isBackgroundSync());
  }, [loadBulkContext, syncKey, isBackgroundSync]);

  useEffect(() => {
    let cancelled = false;
    studentApi
      .listAll()
      .then((result) => {
        if (!cancelled) {
          mergeStudentsCache((result?.students || []) as unknown as Student[]);
        }
      })
      .catch(() => {
        // فحص التكرار المحلي يستخدم آخر كاش متاح عند فشل الاتصال.
      });
    return () => {
      cancelled = true;
    };
  }, [mergeStudentsCache, syncKey]);

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
    !isImporting &&
    !contextLoading &&
    Boolean(registerContext) &&
    (importPolicy === "valid-only" || summary.blockingRows === 0);

  const contextRows = registerContext?.rows || [];
  const contextCourses = useMemo(
    () => contextRows.map(normalizeRegisterContextCourse),
    [contextRows],
  );
  const contextRowByCourseId = useMemo(
    () => new Map(contextRows.map((row) => [row.id, row])),
    [contextRows],
  );

  const buildPreview = () => {
    if (contextLoading) {
      toast.error("انتظر اكتمال تحميل سياق التسجيل الجماعي من قاعدة البيانات");
      return;
    }
    if (!registerContext) {
      toast.error("تعذر فحص التسجيل الجماعي", {
        description:
          contextError || "لا يوجد سياق دورات متاح من قاعدة البيانات.",
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

    const result: PreviewRow[] = parsedRows.map((cells, index) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const rowNumber = index + 1;

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
        graceRaw,
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
      const accountingGraceDays = Math.min(30, parseInteger(graceRaw, 0));

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
        errors.push("نوع الدراسة يجب أن يكون إلكتروني أو حضوري أو مدمج");
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
          "لا يوجد فصل نشط لهذه الدورة؛ الخادم سيسجل الطالب بفرص 0 بوضوح.",
        );
      } else if (courseRow?.activeChapter && opportunities <= 0) {
        warnings.push(
          `الفصل النشط "${courseRow.activeChapter.name || "—"}" فرصه 0؛ الطالب سيبدأ بدون فرص.`,
        );
      }
      if (courseRow?.activeChapter && inputOpportunities !== opportunities) {
        warnings.push(
          `تم تجاهل عمود الفرص (${inputOpportunities}) واعتماد فرص الفصل النشط من قاعدة البيانات: ${opportunities}.`,
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
            `المحافظة "${subSite}" غير مفعّلة لهذه الدورة/نوع الدراسة`,
          );
        }
      }

      const duplicateMessage = getStudentDuplicateMessage(students, {
        name: nameRaw,
        phone,
        telegram,
      });
      if (duplicateMessage)
        errors.push(duplicateMessage.replace("لا يمكن إضافة الطالب: ", ""));

      const duplicateParentPhone = parentPhone
        ? students.find(
            (student) =>
              normalizePhoneForDuplicate(student.parentPhone) === parentPhone,
          )
        : null;
      if (duplicateParentPhone) {
        warnings.push(
          `رقم ولي الأمر موجود مسبقاً عند: ${duplicateParentPhone.name}`,
        );
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
              dismissalType: "",
              dismissalReason: "",
              dismissalNotes: "",
              createdAt: new Date().toISOString().slice(0, 10),
              opportunities,
              baseOpportunities: opportunities,
              accountingGraceDays,
            }
          : null;

      return {
        rowNumber,
        rawCells: cells,
        student,
        errors,
        warnings,
        activeChapterName: courseRow?.activeChapter?.name || undefined,
        source: "database" as const,
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
          row.errors.push(`معرف التليكرام مكرر داخل النص مع السطر ${previous}`);
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
      toast.success("المعاينة سليمة", {
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
    toast.success("تمت الإضافة الجماعية من قاعدة البيانات", {
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
          <div className="font-black">{row.student?.opportunities ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground">
            {row.activeChapterName
              ? `من ${row.activeChapterName}`
              : "من قاعدة البيانات"}
          </div>
        </td>
        <td className="p-3 dir-ltr text-left">
          {row.student?.phone || normalizePhone(row.rawCells[12] || "") || "—"}
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
                  className="text-xs leading-5 text-amber-600 dark:text-amber-300"
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
                    className="text-xs leading-5 text-destructive"
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
    <div className="section-stack mx-auto max-w-7xl">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="relative overflow-hidden border-b bg-card/70 p-5 md:p-6">
          <div className="absolute inset-inline-start-0 top-0 h-28 w-28 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                <ClipboardPaste className="size-7" />
              </div>
              <div>
                <CardTitle className="text-2xl font-black tracking-tight text-gradient-brand md:text-3xl">
                  إضافة جماعية للطلاب
                </CardTitle>
                <CardDescription className="mt-2 leading-6">
                  الصق كل طالب في سطر مستقل، والحقول مفصولة بزر Tab بنفس الصيغة
                  المطلوبة.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 p-4 md:p-6 lg:p-8">
          <section className="surface-card p-5 md:p-6">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-black">مربع الإدخال</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  الترتيب: {COLUMN_NAMES.join(" ← ")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRawText(SAMPLE_TEXT)}
              >
                وضع المثال
              </Button>
            </div>

            <textarea
              dir="rtl"
              value={rawText}
              onChange={(event) => {
                setRawText(event.target.value);
                setPreviewDone(false);
              }}
              placeholder={SAMPLE_TEXT}
              className="min-h-[260px] w-full rounded-2xl border border-input bg-background/70 p-4 font-mono text-sm leading-7 shadow-xs outline-none transition focus:border-ring focus:ring-4 focus:ring-ring/20"
            />

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">{EXPECTED_COLUMNS} عمود</Badge>
                <Badge variant="outline">الأرقام تُحوّل تلقائياً إلى 07</Badge>
                <Badge variant="outline">@ التليكرام اختياري</Badge>
                <Badge
                  variant={
                    contextLoading
                      ? "outline"
                      : registerContext
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {contextLoading
                    ? "جاري تحميل سياق قاعدة البيانات"
                    : registerContext
                      ? `الدورات من قاعدة البيانات: ${registerContext.stats.active}`
                      : "سياق التسجيل غير متاح"}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setRawText("");
                    setPreviewRows([]);
                    setPreviewDone(false);
                  }}
                >
                  مسح
                </Button>
                <Button
                  type="button"
                  onClick={buildPreview}
                  disabled={contextLoading || !registerContext}
                >
                  <Eye className="ml-2 size-4" />
                  معاينة وفحص
                </Button>
              </div>
            </div>
            {contextError ? (
              <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm leading-6 text-destructive">
                {contextError}
              </div>
            ) : null}
            <div className="mt-3 rounded-2xl border border-primary/15 bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">
              التسجيل الجماعي لا يعتمد على عمود الفرص المكتوب بالنص؛ فرص البداية
              تُحسب من الفصل النشط للدورة في قاعدة البيانات، والدورة الموقوفة أو
              ذات تعارض الفصول تُرفض قبل الإضافة.
            </div>
          </section>

          {previewDone && (
            <section className="surface-card p-5 md:p-6">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-black">نتيجة المعاينة</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    المعاينة مقسمة حتى يعرف المستخدم بالضبط ما الذي سيُستورد وما
                    الذي يحتاج مراجعة.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{summary.total} سطر</Badge>
                  <Badge variant="secondary">{summary.ready} جاهز</Badge>
                  <Badge
                    variant={summary.needsEdit ? "destructive" : "outline"}
                  >
                    {summary.needsEdit} يحتاج تعديل
                  </Badge>
                  <Badge
                    variant={summary.duplicate ? "destructive" : "outline"}
                  >
                    {summary.duplicate} مكرر
                  </Badge>
                  <Badge
                    variant={
                      summary.unknownCourseOrLocation
                        ? "destructive"
                        : "outline"
                    }
                  >
                    {summary.unknownCourseOrLocation} دورة/موقع
                  </Badge>
                  <Badge variant="outline">{summary.warningRows} تحذير</Badge>
                </div>
              </div>

              <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <div className="mb-3 font-black">سياسة الاستيراد</div>
                <RadioGroup
                  value={importPolicy}
                  onValueChange={(value) =>
                    setImportPolicy(value as ImportPolicy)
                  }
                  className="grid gap-3 md:grid-cols-2"
                >
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-background/70 p-4 transition hover:border-primary/40">
                    <RadioGroupItem value="valid-only" className="mt-1" />
                    <span>
                      <span className="block font-bold">
                        استيراد الصحيح فقط
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                        سيتم استيراد الأسطر الجاهزة فقط، وتبقى الأسطر الخاطئة
                        ظاهرة حتى يعدلها المستخدم لاحقاً.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-background/70 p-4 transition hover:border-primary/40">
                    <RadioGroupItem value="fail-on-error" className="mt-1" />
                    <span>
                      <span className="block font-bold">
                        إلغاء الاستيراد إذا يوجد خطأ واحد
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                        لن يتم استيراد أي طالب إلا بعد أن تصبح كل الأسطر ضمن قسم
                        جاهز للاستيراد.
                      </span>
                    </span>
                  </label>
                </RadioGroup>
              </div>

              {summary.blockingRows > 0 && (
                <div
                  className={`mb-4 rounded-2xl border p-4 text-sm leading-7 ${
                    importPolicy === "valid-only"
                      ? "border-amber-300/50 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                      : "border-destructive/30 bg-destructive/10 text-destructive"
                  }`}
                >
                  <ShieldAlert className="ml-2 inline size-4" />
                  {importPolicy === "valid-only"
                    ? `سيتم استيراد ${summary.ready} طالب جاهز فقط، وتجاهل ${summary.blockingRows} سطر يحتاج مراجعة.`
                    : `لن يتم الاستيراد لأن هناك ${summary.blockingRows} سطر يحتوي على خطأ مانع.`}
                </div>
              )}

              <div className="space-y-5">
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
                    <div
                      key={category}
                      className="overflow-hidden rounded-2xl border bg-background/60"
                    >
                      <div className="flex flex-col gap-2 border-b bg-muted/45 p-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-black">{copy.title}</div>
                          <div className="mt-1 text-sm leading-6 text-muted-foreground">
                            {copy.description}
                          </div>
                        </div>
                        <Badge
                          variant={
                            category === "ready" ? "secondary" : "outline"
                          }
                        >
                          {rows.length} سطر
                        </Badge>
                      </div>

                      <div className="max-h-[420px] overflow-auto">
                        <table className="w-full min-w-[980px] text-right text-sm">
                          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                            <tr className="border-b">
                              <th className="p-3">السطر</th>
                              <th className="p-3">الطالب</th>
                              <th className="p-3">الدورة</th>
                              <th className="p-3">البرنامج</th>
                              <th className="p-3">الدراسة</th>
                              <th className="p-3">الموقع</th>
                              <th className="p-3">فرص البداية</th>
                              <th className="p-3">هاتف الطالب</th>
                              <th className="p-3">الحالة</th>
                              <th className="p-3">الفحص</th>
                            </tr>
                          </thead>
                          <tbody>{rows.map(renderPreviewRow)}</tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm leading-6 text-muted-foreground">
                  {importPolicy === "valid-only"
                    ? "عند الضغط سيتم إرسال الأسطر الجاهزة فقط إلى الخادم."
                    : "عند الضغط يجب أن تكون كل الأسطر سليمة، وإلا لن يبدأ الاستيراد."}
                </div>
                <Button
                  type="button"
                  disabled={!canImport}
                  onClick={() => setConfirmOpen(true)}
                >
                  <PlusCircle className="ml-2 size-4" />
                  {importPolicy === "valid-only"
                    ? "استيراد الصحيح فقط"
                    : "إكمال الإضافة"}
                </Button>
              </div>
            </section>
          )}
        </CardContent>
      </Card>

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
