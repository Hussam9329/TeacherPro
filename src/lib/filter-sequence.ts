import type { Exam } from "@/lib/teacher-store";
import {
  COURSE_PROGRAMS,
  STUDY_TYPES,
  getAvailablePrograms,
  getAvailableStudyTypes,
  getAvailableStudyTypesForProgram,
  type CourseProgram,
  type CourseSettingsSource,
  type StudyType,
} from "@/lib/course-config";
import { getStudentLocationFilterOptions } from "@/lib/student-list-filters";

export type AcademicFilterState = {
  courseId?: string;
  courseProgram?: string;
  courseTerm?: string;
  studyType?: string;
  locationScope?: string;
  location?: string;
  nameLetter?: string;
};

type AcademicCourse = CourseSettingsSource & {
  id: string;
  name?: string;
};

type AcademicStudent = {
  courseId?: string;
  courseProgram?: string | null;
  courseTerm?: string | null;
  studyType?: string | null;
  locationScope?: string | null;
  mainSite?: string | null;
  subSite?: string | null;
  name?: string;
};

type AcademicFilterContext = {
  courses?: AcademicCourse[];
  students?: AcademicStudent[];
};

function normalizeCourseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Some old local records may already be comma-separated.
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectedCourses(
  courses: AcademicCourse[] = [],
  courseId?: string,
): AcademicCourse[] {
  return courseId ? courses.filter((course) => course.id === courseId) : courses;
}

function uniqueOrdered<T extends string>(values: unknown[], order: readonly T[]): T[] {
  const allowed = new Set<string>(order);
  const discovered = new Set<string>();
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && allowed.has(text)) discovered.add(text);
  }
  return order.filter((item) => discovered.has(item));
}

function studentMatchesOptionBase(
  student: AcademicStudent,
  filters: AcademicFilterState,
): boolean {
  if (filters.courseId && student.courseId !== filters.courseId) return false;
  if (filters.courseProgram && student.courseProgram !== filters.courseProgram)
    return false;
  if (
    filters.courseProgram === "كورسات" &&
    filters.courseTerm &&
    student.courseTerm !== filters.courseTerm
  )
    return false;
  if (filters.studyType && student.studyType !== filters.studyType) return false;
  return true;
}

export function getAcademicCourseProgramFilterOptions(
  courses: AcademicCourse[],
  filters: Pick<AcademicFilterState, "courseId"> = {},
  students: AcademicStudent[] = [],
): CourseProgram[] {
  const courseScope = selectedCourses(courses, filters.courseId);
  const fromCourses = courseScope.flatMap((course) => getAvailablePrograms(course));
  const courseOptions = uniqueOrdered(fromCourses, COURSE_PROGRAMS);
  if (courseOptions.length > 0) return courseOptions;

  const fromStudents = students
    .filter((student) => !filters.courseId || student.courseId === filters.courseId)
    .map((student) => student.courseProgram);
  const studentOptions = uniqueOrdered(fromStudents, COURSE_PROGRAMS);
  return studentOptions.length > 0 ? studentOptions : [...COURSE_PROGRAMS];
}

export function getAcademicStudyTypeFilterOptions(
  courses: AcademicCourse[],
  filters: Pick<AcademicFilterState, "courseId" | "courseProgram"> = {},
  students: AcademicStudent[] = [],
): StudyType[] {
  const courseScope = selectedCourses(courses, filters.courseId);
  const fromCourses = courseScope.flatMap((course) =>
    filters.courseProgram
      ? getAvailableStudyTypesForProgram(course, filters.courseProgram)
      : getAvailableStudyTypes(course),
  );
  const courseOptions = uniqueOrdered(fromCourses, STUDY_TYPES);
  if (courseOptions.length > 0) return courseOptions;

  const fromStudents = students
    .filter((student) => {
      if (filters.courseId && student.courseId !== filters.courseId) return false;
      if (filters.courseProgram && student.courseProgram !== filters.courseProgram)
        return false;
      return true;
    })
    .map((student) => student.studyType);
  const studentOptions = uniqueOrdered(fromStudents, STUDY_TYPES);
  return studentOptions.length > 0 ? studentOptions : [...STUDY_TYPES];
}

export function getAcademicLocationFilterOptions(
  students: AcademicStudent[],
  filters: Pick<
    AcademicFilterState,
    "courseId" | "courseProgram" | "courseTerm" | "studyType"
  > = {},
): string[] {
  const scopedStudents = students.filter((student) =>
    studentMatchesOptionBase(student, filters),
  );
  return getStudentLocationFilterOptions(scopedStudents);
}

function linkedCoursesSupportFilters(
  linkedCourses: AcademicCourse[],
  filters: AcademicFilterState,
): boolean {
  if (!filters.courseProgram && !filters.studyType) return true;

  return linkedCourses.some((course) => {
    if (filters.courseProgram) {
      const programs = getAvailablePrograms(course);
      if (programs.length > 0 && !programs.includes(filters.courseProgram as CourseProgram)) {
        return false;
      }
    }

    if (filters.studyType) {
      const studyTypes = filters.courseProgram
        ? getAvailableStudyTypesForProgram(course, filters.courseProgram)
        : getAvailableStudyTypes(course);
      if (studyTypes.length > 0 && !studyTypes.includes(filters.studyType as StudyType)) {
        return false;
      }
    }

    return true;
  });
}

function linkedStudentsSupportFilters(
  students: AcademicStudent[],
  linkedCourseIds: string[],
  filters: AcademicFilterState,
): boolean {
  if (!filters.courseProgram && !filters.courseTerm && !filters.studyType) return true;
  return students.some((student) => {
    if (!student.courseId || !linkedCourseIds.includes(student.courseId)) return false;
    return studentMatchesOptionBase(student, filters);
  });
}

/**
 * Unified filter matching for academic records (exams, grades).
 * Used across grade-entry, grade-records, and e-correction pages
 * to ensure consistent filter behavior.
 */
export function examMatchesAcademicFilters(
  exam: Exam | Record<string, unknown>,
  filters: AcademicFilterState,
  context?: AcademicFilterContext,
): boolean {
  const courseIds = normalizeCourseIds((exam as { courseIds?: unknown }).courseIds);

  if (filters.courseId) {
    if (!courseIds.includes(filters.courseId)) return false;
  }

  const relevantCourseIds = filters.courseId ? [filters.courseId] : courseIds;
  const linkedCourses = (context?.courses || []).filter((course) =>
    relevantCourseIds.includes(course.id),
  );

  if (linkedCourses.length > 0) {
    if (!linkedCoursesSupportFilters(linkedCourses, filters)) return false;
  } else if (
    context?.students?.length &&
    !linkedStudentsSupportFilters(context.students, relevantCourseIds, filters)
  ) {
    return false;
  }

  return true;
}

export function studentMatchesAcademicFilters(
  student: AcademicStudent,
  filters: AcademicFilterState,
  _extra?: unknown,
): boolean {
  if (filters.courseId && student.courseId !== filters.courseId) return false;
  if (filters.courseProgram && student.courseProgram !== filters.courseProgram)
    return false;
  if (
    filters.courseProgram === "كورسات" &&
    filters.courseTerm &&
    student.courseTerm !== filters.courseTerm
  )
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
