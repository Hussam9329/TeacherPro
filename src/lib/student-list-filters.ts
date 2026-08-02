import { COURSE_TERMS, COURSE_PROGRAMS, STUDY_TYPES } from "./course-config";
import {
  BAGHDAD_COURSE_SITES,
  IRAQI_PROVINCES,
  normalizeIraqiProvinceName,
} from "./iraq";

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

const locationAliasGroups: Record<string, readonly string[]> = {
  "أربيل": ["أربيل", "اربيل"],
  "الأنبار": ["الأنبار", "الانبار"],
  "البصرة": ["البصرة", "البصره"],
  "الديوانية": ["الديوانية", "الديوانيه", "القادسية"],
  "الناصرية": ["الناصرية", "الناصريه", "ذي قار"],
  "أونلاين": [
    "أونلاين",
    "اونلاين",
    "Online",
    "إلكتروني",
    "الكتروني",
    "إلكترونية",
    "الكترونية",
  ],
};

function locationAliasKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ar-IQ")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

export function normalizeStudentFilterLocation(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const key = locationAliasKey(text);
  const canonical = Object.entries(locationAliasGroups).find(([, aliases]) =>
    aliases.some((alias) => locationAliasKey(alias) === key),
  )?.[0];
  return normalizeIraqiProvinceName(canonical || text);
}

export function getStudentFilterLocationAliases(value: unknown): string[] {
  const canonical = normalizeStudentFilterLocation(value);
  return [...(locationAliasGroups[canonical] || [canonical])].filter(Boolean);
}

export function getStudentLocationFilterValue(student: StudentFilterSource): string {
  const locationScope = normalizeStudentFilterLocation(student.locationScope);
  const subSite = normalizeStudentFilterLocation(student.subSite);
  const mainSite = normalizeStudentFilterLocation(student.mainSite);

  if (locationScope === "بغداد") {
    if (subSite && subSite !== "عموم بغداد" && subSite !== "بغداد") {
      return subSite;
    }
    if (mainSite && mainSite !== "عموم بغداد" && mainSite !== "بغداد") {
      return mainSite;
    }
    return "بغداد";
  }
  if (locationScope === "خارج القطر") return "خارج القطر";
  if (locationScope === "محافظات") return subSite || mainSite;
  if (subSite && subSite !== "عموم بغداد") return subSite;
  return mainSite || locationScope;
}

export function getStudentLocationFilterOptions(students: StudentFilterSource[]): string[] {
  const discovered = new Set(students.map(getStudentLocationFilterValue).filter(Boolean));
  if (
    students.some(
      (student) =>
        normalizeStudentFilterLocation(student.locationScope) === "بغداد",
    )
  ) {
    discovered.add("بغداد");
  }
  const orderedBase = [
    "بغداد",
    ...BAGHDAD_COURSE_SITES,
    ...IRAQI_PROVINCES,
    "خارج القطر",
    "أونلاين",
  ];
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
  if (filters.location) {
    const location = normalizeStudentFilterLocation(filters.location);
    if (location === "بغداد") {
      if (normalizeStudentFilterLocation(student.locationScope) !== "بغداد") {
        return false;
      }
    } else if (getStudentLocationFilterValue(student) !== location) {
      return false;
    }
  }
  return true;
}
