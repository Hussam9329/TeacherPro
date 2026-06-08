/**
 * course-config.ts — ثوابت ودوال مشتركة لإعدادات الدورات
 * يستخدم في: courses.tsx, student-register.tsx, student-registry.tsx,
 *            courses/route.ts, students/route.ts, teacher-store.ts
 */

// ─── الثوابت ────────────────────────────────────────────────────────────────

export const COURSE_PROGRAMS = ["منهج كامل", "كورسات"] as const;
export const COURSE_TERMS = ["الكورس الأول", "الكورس الثاني"] as const;
export const STUDY_TYPES = ["إلكتروني", "حضوري", "مدمج"] as const;
export const LOCATION_SCOPES = ["بغداد", "محافظات"] as const;
export const BAGHDAD_MODES = ["عموم بغداد", "بغداد - مخصص"] as const;

export type CourseProgram = (typeof COURSE_PROGRAMS)[number];
export type CourseTerm = (typeof COURSE_TERMS)[number];
export type StudyType = (typeof STUDY_TYPES)[number];
export type LocationScope = (typeof LOCATION_SCOPES)[number];
export type BaghdadMode = (typeof BAGHDAD_MODES)[number];

export type StudyLocationConfig = {
  scopes: LocationScope[];
  baghdadMode?: BaghdadMode;
  baghdadSites?: string[];
  provinces?: string[];
};

export type CourseLocationConfig = Partial<Record<StudyType, StudyLocationConfig>>;
export type StudyTypesByProgram = Partial<Record<CourseProgram, StudyType[]>>;

// ─── JSON Helpers ────────────────────────────────────────────────────────────

export function parseJsonArray<T = string>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function parseJsonRecord<T extends object>(value: unknown, fallback: T): T {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? []);
}

// ─── Course Data Access Helpers ──────────────────────────────────────────────

/** واجهة موحدة لقراءة إعدادات الدورة من أي مصدر (store أو API) */
export type CourseSettingsSource = {
  availablePrograms?: unknown;
  availableStudyTypes?: unknown;
  studyTypesByProgram?: unknown;
  locationConfig?: unknown;
};

function isCourseProgram(value: unknown): value is CourseProgram {
  return COURSE_PROGRAMS.includes(value as CourseProgram);
}

function isStudyType(value: unknown): value is StudyType {
  return STUDY_TYPES.includes(value as StudyType);
}

function uniqueCoursePrograms(values: unknown[]): CourseProgram[] {
  return Array.from(new Set(values.filter(isCourseProgram)));
}

function uniqueStudyTypes(values: unknown[]): StudyType[] {
  return Array.from(new Set(values.filter(isStudyType)));
}

function getLegacyAvailableStudyTypes(course: CourseSettingsSource): StudyType[] {
  return uniqueStudyTypes(parseJsonArray<unknown>(course.availableStudyTypes));
}

export function getAvailablePrograms(course: CourseSettingsSource): CourseProgram[] {
  return uniqueCoursePrograms(parseJsonArray<unknown>(course.availablePrograms));
}

export function getStudyTypesByProgram(course: CourseSettingsSource): StudyTypesByProgram {
  const programs = getAvailablePrograms(course);
  const legacyStudyTypes = getLegacyAvailableStudyTypes(course);
  const rawMap = parseJsonRecord<Record<string, unknown>>(course.studyTypesByProgram, {});
  const result: StudyTypesByProgram = {};

  for (const program of programs) {
    const selected = parseJsonArray<unknown>(rawMap[program]);
    const normalized = uniqueStudyTypes(selected);

    // توافق خلفي: الدورات القديمة كانت تحفظ نوع الدراسة كقائمة عامة.
    result[program] = normalized.length > 0 ? normalized : [...legacyStudyTypes];
  }

  return result;
}

export function getAvailableStudyTypes(course: CourseSettingsSource): StudyType[] {
  const mappedStudyTypes = Object.values(getStudyTypesByProgram(course)).flat();
  return uniqueStudyTypes(mappedStudyTypes.length > 0 ? mappedStudyTypes : getLegacyAvailableStudyTypes(course));
}

export function getAvailableStudyTypesForProgram(
  course: CourseSettingsSource,
  program?: string | null,
): StudyType[] {
  if (!program || !isCourseProgram(program)) return [];
  const byProgram = getStudyTypesByProgram(course);
  return uniqueStudyTypes(byProgram[program] || []);
}

export function getCourseLocationConfig(course: CourseSettingsSource): CourseLocationConfig {
  return parseJsonRecord<CourseLocationConfig>(course.locationConfig, {});
}

export function hasCourseProgram(course: CourseSettingsSource, program: CourseProgram) {
  return getAvailablePrograms(course).includes(program);
}

// ─── Location Derivation Helpers ─────────────────────────────────────────────

export function getLocationScopes(
  course: CourseSettingsSource,
  studyType: string,
): LocationScope[] {
  const config = getCourseLocationConfig(course);
  const studyConfig = config[studyType as StudyType];
  return studyConfig?.scopes ?? [];
}

export function getBaghdadMode(
  course: CourseSettingsSource,
  studyType: string,
): BaghdadMode | undefined {
  const config = getCourseLocationConfig(course);
  const studyConfig = config[studyType as StudyType];
  return studyConfig?.baghdadMode;
}

export function getBaghdadSites(
  course: CourseSettingsSource,
  studyType: string,
): string[] {
  const config = getCourseLocationConfig(course);
  const studyConfig = config[studyType as StudyType];
  return studyConfig?.baghdadSites ?? [];
}

export function getProvinceOptions(
  course: CourseSettingsSource,
  studyType: string,
): string[] {
  const config = getCourseLocationConfig(course);
  const studyConfig = config[studyType as StudyType];
  return studyConfig?.provinces ?? [];
}

// ─── Student Choice Validation (server-side) ────────────────────────────────

export type StudentCourseChoices = {
  courseProgram?: string | null;
  courseTerm?: string | null;
  studyType?: string | null;
  locationScope?: string | null;
  baghdadMode?: string | null;
  subSite?: string | null;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * تحقق من أن اختيارات الطالب تتوافق مع إعدادات الدورة
 * يستخدم في API routes (students POST/PUT)
 */
export function validateStudentCourseChoices(
  course: CourseSettingsSource,
  choices: StudentCourseChoices,
): ValidationResult {
  const availablePrograms = getAvailablePrograms(course);

  // 1. التحقق من courseProgram
  if (!choices.courseProgram) {
    return { ok: false, error: "نوع الدورة مطلوب" };
  }
  if (!availablePrograms.includes(choices.courseProgram as CourseProgram)) {
    return { ok: false, error: `نوع الدورة "${choices.courseProgram}" غير متاح في هذه الدورة` };
  }

  // 2. إذا كورسات، يجب اختيار كورس
  if (choices.courseProgram === "كورسات") {
    if (!choices.courseTerm || !COURSE_TERMS.includes(choices.courseTerm as CourseTerm)) {
      return { ok: false, error: "يجب اختيار الكورس عند اختيار كورسات" };
    }
  }

  // 3. التحقق من studyType حسب نوع الدورة المختار
  const availableStudyTypes = getAvailableStudyTypesForProgram(course, choices.courseProgram);
  if (!choices.studyType) {
    return { ok: false, error: "نوع الدراسة مطلوب" };
  }
  if (!availableStudyTypes.includes(choices.studyType as StudyType)) {
    return { ok: false, error: `نوع الدراسة "${choices.studyType}" غير متاح لنوع الدورة "${choices.courseProgram}"` };
  }

  // 4. التحقق من locationScope
  const locationScopes = getLocationScopes(course, choices.studyType);
  if (!choices.locationScope) {
    return { ok: false, error: "الموقع مطلوب" };
  }
  if (!locationScopes.includes(choices.locationScope as LocationScope)) {
    return { ok: false, error: `الموقع "${choices.locationScope}" غير متاح لنوع الدراسة المختار` };
  }

  // 5. إذا بغداد
  if (choices.locationScope === "بغداد") {
    const baghdadMode = getBaghdadMode(course, choices.studyType);
    if (!baghdadMode) {
      return { ok: false, error: "إعدادات بغداد غير محددة لهذا النوع" };
    }
    if (choices.baghdadMode && choices.baghdadMode !== baghdadMode) {
      return { ok: false, error: `نوع بغداد يجب أن يكون "${baghdadMode}"` };
    }

    if (baghdadMode === "بغداد - مخصص") {
      const baghdadSites = getBaghdadSites(course, choices.studyType);
      if (!choices.subSite || !baghdadSites.includes(choices.subSite)) {
        return { ok: false, error: "يجب اختيار موقع بغداد صالح" };
      }
    }
  }

  // 6. إذا محافظات
  if (choices.locationScope === "محافظات") {
    const provinces = getProvinceOptions(course, choices.studyType);
    if (!choices.subSite || !provinces.includes(choices.subSite)) {
      return { ok: false, error: "يجب اختيار محافظة صالحة" };
    }
  }

  return { ok: true };
}

/**
 * حل الموقع الفرعي بناءً على الاختيارات
 */
export function resolveSubSite(
  course: CourseSettingsSource,
  studyType: string,
  locationScope: string,
  baghdadMode: string | undefined,
  subSite: string | undefined,
): string {
  if (locationScope === "بغداد") {
    const mode = getBaghdadMode(course, studyType);
    if (mode === "عموم بغداد") return "عموم بغداد";
    if (mode === "بغداد - مخصص") return subSite || "";
  }
  if (locationScope === "محافظات") {
    return subSite || "";
  }
  return subSite || "";
}

/**
 * تحقق من أن تعديل إعدادات الدورة لا يزيل خيارات مستخدمة من طلاب
 * يُستخدم في courses PUT route
 */
export type StudentChoicesSource = {
  courseProgram?: string | null;
  courseTerm?: string | null;
  studyType?: string | null;
  locationScope?: string | null;
  baghdadMode?: string | null;
  subSite?: string | null;
};

export function findUsedOptionsToRemove(
  oldCourse: CourseSettingsSource,
  newCourse: CourseSettingsSource,
  students: StudentChoicesSource[],
): string[] {
  const errors: string[] = [];

  const oldPrograms = getAvailablePrograms(oldCourse);
  const newPrograms = getAvailablePrograms(newCourse);

  for (const student of students) {
    // تحقق من courseProgram
    if (
      student.courseProgram &&
      oldPrograms.includes(student.courseProgram as CourseProgram) &&
      !newPrograms.includes(student.courseProgram as CourseProgram)
    ) {
      errors.push(`نوع الدورة "${student.courseProgram}" مستخدم من طالب ولا يمكن إزالته`);
    }

    // تحقق من courseTerm (فقط إذا كان كورسات)
    if (student.courseProgram === "كورسات" && student.courseTerm) {
      const newProgramsIncludeKorrasat = newPrograms.includes("كورسات");
      if (!newProgramsIncludeKorrasat) {
        errors.push(`خيار "كورسات" مستخدم من طالب ولا يمكن إزالته`);
      }
    }

    // تحقق من studyType حسب نوع الدورة
    if (student.courseProgram && student.studyType) {
      const newStudyTypesForProgram = getAvailableStudyTypesForProgram(newCourse, student.courseProgram);
      if (!newStudyTypesForProgram.includes(student.studyType as StudyType)) {
        errors.push(`نوع الدراسة "${student.studyType}" مستخدم مع نوع الدورة "${student.courseProgram}" ولا يمكن إزالته`);
      }
    }

    // تحقق من locationScope
    if (student.studyType && student.locationScope) {
      const newScopes = getLocationScopes(newCourse, student.studyType);
      if (!newScopes.includes(student.locationScope as LocationScope)) {
        errors.push(`الموقع "${student.locationScope}" لنوع الدراسة "${student.studyType}" مستخدم من طالب ولا يمكن إزالته`);
      }
    }

    // تحقق من subSite (بغداد - مخصص)
    if (student.studyType && student.locationScope === "بغداد" && student.subSite) {
      const newBaghdadSites = getBaghdadSites(newCourse, student.studyType);
      const newBaghdadMode = getBaghdadMode(newCourse, student.studyType);
      if (newBaghdadMode === "بغداد - مخصص" && newBaghdadSites.length > 0 && !newBaghdadSites.includes(student.subSite)) {
        errors.push(`موقع بغداد "${student.subSite}" مستخدم من طالب ولا يمكن إزالته`);
      }
    }

    // تحقق من subSite (محافظات)
    if (student.studyType && student.locationScope === "محافظات" && student.subSite) {
      const newProvinces = getProvinceOptions(newCourse, student.studyType);
      if (newProvinces.length > 0 && !newProvinces.includes(student.subSite)) {
        errors.push(`المحافظة "${student.subSite}" مستخدمة من طالب ولا يمكن إزالتها`);
      }
    }
  }

  // إزالة التكرار
  return [...new Set(errors)];
}
