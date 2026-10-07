"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import "./course-checkbox-filter.css";

type CourseOption = { id: string; name: string };

type Props = {
  courses: readonly CourseOption[];
  /** The chosen courses; empty means every course («كل الدورات»). */
  value: readonly string[];
  onChange: (courseIds: string[]) => void;
  label?: string;
};

/**
 * The course filter of a page: «كل الدورات», or one course or several
 * together. With «كل الدورات» every course shows ticked; unticking one keeps
 * the rest. «كل الدورات» shows a dash while only some are ticked. Ticking
 * every course is «كل الدورات»; unticking the last one goes back to it too
 * (a filter of no course would show nothing).
 */
export function CourseCheckboxFilter({ courses, value, onChange, label = "الدورات" }: Props) {
  const baseId = useId();
  const known = new Set(courses.map((course) => course.id));
  const chosen = value.filter((id) => known.has(id));
  const all = chosen.length === 0;
  const isChecked = (courseId: string) => all || chosen.includes(courseId);

  const toggle = (courseId: string) => {
    const ticked = all ? courses.map((course) => course.id) : chosen;
    const next = ticked.includes(courseId)
      ? ticked.filter((id) => id !== courseId)
      : [...ticked, courseId];
    onChange(next.length === courses.length ? [] : next);
  };

  return (
    <fieldset className="tp-course-filter">
      <legend className="tp-course-filter__legend">
        {label}
        <span className="tp-course-filter__count">{all ? "الكل" : `${chosen.length} من ${courses.length}`}</span>
      </legend>
      <label htmlFor={`${baseId}-all`} className="tp-course-filter__option" data-all="true" data-checked={all || undefined}>
        <Checkbox
          id={`${baseId}-all`}
          checked={all ? true : "indeterminate"}
          onCheckedChange={() => { if (!all) onChange([]); }}
        />
        <span>كل الدورات</span>
      </label>
      <div className="tp-course-filter__list" role="group" aria-label={label}>
        {courses.map((course) => {
          const checked = isChecked(course.id);
          return (
            <label key={course.id} htmlFor={`${baseId}-${course.id}`} className="tp-course-filter__option" data-checked={checked || undefined}>
              <Checkbox id={`${baseId}-${course.id}`} checked={checked} onCheckedChange={() => toggle(course.id)} />
              <span>{course.name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The chosen courses as one request parameter ("" for every course). */
export function courseFilterParam(courseIds: readonly string[]): string {
  return courseIds.join(",");
}

/** «كل الدورات», the one course's name, or the chosen names joined. */
export function courseFilterLabel(courseIds: readonly string[], courseName: (id: string) => string): string {
  if (!courseIds.length) return "كل الدورات";
  return courseIds.map(courseName).join("، ");
}
