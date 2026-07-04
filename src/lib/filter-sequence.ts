import type { Exam } from "@/lib/teacher-store";

export type AcademicFilterState = {
  courseId?: string;
  courseProgram?: string;
  studyType?: string;
  locationScope?: string;
  nameLetter?: string;
};

/**
 * Unified filter matching for academic records (exams, grades).
 * Used across grade-entry, grade-records, and e-correction pages
 * to ensure consistent filter behavior.
 */
export function examMatchesAcademicFilters(
  exam: { courseIds?: string; [key: string]: unknown },
  filters: AcademicFilterState,
  _context?: unknown,
): boolean {
  if (filters.courseId) {
    try {
      const courseIds: string[] = JSON.parse(exam.courseIds || "[]");
      if (Array.isArray(courseIds) && !courseIds.includes(filters.courseId)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

export function studentMatchesAcademicFilters(
  student: {
    courseId?: string;
    courseProgram?: string | null;
    studyType?: string | null;
    locationScope?: string | null;
    name?: string;
  },
  filters: AcademicFilterState,
  _extra?: unknown,
): boolean {
  if (filters.courseId && student.courseId !== filters.courseId) return false;
  if (filters.courseProgram && student.courseProgram !== filters.courseProgram)
    return false;
  if (filters.studyType && student.studyType !== filters.studyType) return false;
  if (filters.locationScope && student.locationScope !== filters.locationScope)
    return false;
  if (filters.nameLetter && filters.nameLetter !== "all") {
    const firstLetter = (student.name || "").trim()[0]?.replace(
      /[إأآٱ]/g,
      "ا",
    );
    if (firstLetter !== filters.nameLetter) return false;
  }
  return true;
}
