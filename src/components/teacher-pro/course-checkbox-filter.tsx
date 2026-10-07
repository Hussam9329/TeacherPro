"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
 * The course filter of a page, as small as a select: the field names the
 * choice («كل الدورات», a course, or how many), and opens a short list of
 * checkboxes. With «كل الدورات» every course shows ticked; unticking one
 * keeps the rest, and «كل الدورات» then shows a dash. Ticking every course is
 * «كل الدورات»; unticking the last one goes back to it too (a filter of no
 * course would show nothing).
 */
export function CourseCheckboxFilter({ courses, value, onChange, label = "اسم الدورة" }: Props) {
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const known = new Set(courses.map((course) => course.id));
  const chosen = value.filter((id) => known.has(id));
  const all = chosen.length === 0;
  const isChecked = (courseId: string) => all || chosen.includes(courseId);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const toggle = (courseId: string) => {
    const ticked = all ? courses.map((course) => course.id) : chosen;
    const next = ticked.includes(courseId)
      ? ticked.filter((id) => id !== courseId)
      : [...ticked, courseId];
    onChange(next.length === courses.length ? [] : next);
  };

  const summary = courseFilterSummary(chosen, courses);

  return (
    <div ref={rootRef} className="tp-course-filter" data-open={open || undefined}>
      <Label htmlFor={`${baseId}-trigger`} className="text-xs font-bold">{label}</Label>
      <button
        ref={triggerRef}
        id={`${baseId}-trigger`}
        type="button"
        className="tp-course-filter__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`${baseId}-panel`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="tp-course-filter__summary">{summary}</span>
        <ChevronDownIcon className="tp-course-filter__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id={`${baseId}-panel`} className="tp-course-filter__panel" role="group" aria-label={label}>
          <label htmlFor={`${baseId}-all`} className="tp-course-filter__option" data-all="true">
            <Checkbox
              id={`${baseId}-all`}
              checked={all ? true : "indeterminate"}
              onCheckedChange={() => { if (!all) onChange([]); }}
            />
            <span>كل الدورات</span>
            <span className="tp-course-filter__count">{all ? courses.length : `${chosen.length} من ${courses.length}`}</span>
          </label>
          <div className="tp-course-filter__list">
            {courses.map((course) => (
              <label key={course.id} htmlFor={`${baseId}-${course.id}`} className="tp-course-filter__option">
                <Checkbox id={`${baseId}-${course.id}`} checked={isChecked(course.id)} onCheckedChange={() => toggle(course.id)} />
                <span>{course.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The chosen courses as one request parameter ("" for every course). */
export function courseFilterParam(courseIds: readonly string[]): string {
  return courseIds.join(",");
}

/**
 * A short name for the choice: «كل الدورات», one or two course names,
 * «كل الدورات عدا …» when one or two are left out, or «3 من 9 دورات».
 */
export function courseFilterSummary(courseIds: readonly string[], courses: readonly CourseOption[]): string {
  const chosen = new Set(courseIds.filter((id) => courses.some((course) => course.id === id)));
  if (!chosen.size || chosen.size === courses.length) return "كل الدورات";
  const nameOf = (course: CourseOption) => course.name;
  const picked = courses.filter((course) => chosen.has(course.id));
  if (picked.length <= 2) return picked.map(nameOf).join("، ");
  const left = courses.filter((course) => !chosen.has(course.id));
  if (left.length <= 2) return `كل الدورات عدا ${left.map(nameOf).join("، ")}`;
  return `${picked.length} من ${courses.length} دورات`;
}

/** Every chosen course by name (for logs and reports), or «كل الدورات». */
export function courseFilterLabel(courseIds: readonly string[], courseName: (id: string) => string): string {
  if (!courseIds.length) return "كل الدورات";
  return courseIds.map(courseName).join("، ");
}
