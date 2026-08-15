import { COURSE_TERMS, COURSE_PROGRAMS, STUDY_TYPES } from "./course-config";
import { IRAQI_PROVINCES, normalizeIraqiProvinceName } from "./iraq";

export const STUDENT_FILTER_COURSE_PROGRAMS = COURSE_PROGRAMS;
export const STUDENT_FILTER_COURSE_TERMS = COURSE_TERMS;
export const STUDENT_FILTER_STUDY_TYPES = STUDY_TYPES;

export type StudentListFilterValues = {
  courseProgram?: string;
  courseTerm?: string;
  studyType?: string;
  location?: string;
};

type StudentFilterSource = {
  courseProgram?: string | null;
  courseTerm?: string | null;
  studyType?: string | null;
  locationScope?: string | null;
  mainSite?: string | null;
  subSite?: string | null;
};

const locationAliases: Record<string, string> = {
  اربيل: "أربيل",
  الانبار: "الأنبار",
  البصره: "البصرة",
  الديوانيه: "الديوانية",
  القادسية: "الديوانية",
  "ذي قار": "الناصرية",
  الكتروني: "إلكتروني",
  اونلاين: "أونلاين",
  Online: "أونلاين",
};

export function normalizeStudentFilterLocation(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return normalizeIraqiProvinceName(locationAliases[text] || text);
}

export function getStudentLocationFilterValue(student: StudentFilterSource): string {
  const locationScope = normalizeStudentFilterLocation(student.locationScope);
  const subSite = normalizeStudentFilterLocation(student.subSite);
  const mainSite = normalizeStudentFilterLocation(student.mainSite);

  if (locationScope === "بغداد") return "بغداد";
  if (locationScope === "خارج القطر") return "خارج القطر";
  if (locationScope === "محافظات") return subSite || mainSite;
  if (subSite && subSite !== "عموم بغداد") return subSite;
  return mainSite || locationScope;
}

export function getStudentLocationFilterOptions(students: StudentFilterSource[]): string[] {
  const discovered = new Set(students.map(getStudentLocationFilterValue).filter(Boolean));
  const orderedBase = ["بغداد", ...IRAQI_PROVINCES, "خارج القطر", "أونلاين"];
  const ordered = orderedBase.filter((item) => discovered.has(item));
  const custom = Array.from(discovered)
    .filter((item) => !orderedBase.includes(item as any))
    .sort((a, b) => a.localeCompare(b, "ar"));
  return [...ordered, ...custom];
}

export function studentMatchesListFilters(student: StudentFilterSource, filters: StudentListFilterValues): boolean {
  if (filters.courseProgram && student.courseProgram !== filters.courseProgram) return false;
  if (filters.courseProgram === "كورسات" && filters.courseTerm && student.courseTerm !== filters.courseTerm) return false;
  if (filters.studyType && student.studyType !== filters.studyType) return false;
  if (filters.location && getStudentLocationFilterValue(student) !== filters.location) return false;
  return true;
}
