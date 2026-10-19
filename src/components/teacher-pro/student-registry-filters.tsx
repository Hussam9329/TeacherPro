"use client";

import type { Dispatch, SetStateAction } from "react";
import { type Course } from "@/lib/teacher-store";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { type RegistryIssueFilter, registryIssueFilterLabels } from "./student-registry-results";
import { STUDENT_FILTER_COURSE_TERMS } from "@/lib/student-list-filters";
import { type RegistryViewMode } from "./student-registry-helpers";

export type StudentRegistryFiltersProps = {
  filterCourseId: string;
  setFilterCourseId: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  courses: Course[];
  filterCourseProgram: string;
  setFilterCourseProgram: Dispatch<SetStateAction<string>>;
  availableProgramsForFilter: ("كورسات" | "منهج كامل")[];
  filterCourseTerm: string;
  setFilterCourseTerm: Dispatch<SetStateAction<string>>;
  filterStudyType: string;
  setFilterStudyType: Dispatch<SetStateAction<string>>;
  availableStudyTypesForFilter: ("إلكتروني" | "حضوري" | "مدمج")[];
  filterLocation: string;
  setFilterLocation: Dispatch<SetStateAction<string>>;
  locationFilterOptions: string[];
  filterGender: string;
  setFilterGender: Dispatch<SetStateAction<string>>;
  filterRegistryIssue: RegistryIssueFilter;
  setFilterRegistryIssue: Dispatch<SetStateAction<RegistryIssueFilter>>;
  viewMode: RegistryViewMode;
  setViewMode: Dispatch<SetStateAction<RegistryViewMode>>;
  pageSize: number;
  setPageSize: Dispatch<SetStateAction<number>>;
};

export function StudentRegistryFilters({
  filterCourseId,
  setFilterCourseId,
  setPage,
  courses,
  filterCourseProgram,
  setFilterCourseProgram,
  availableProgramsForFilter,
  filterCourseTerm,
  setFilterCourseTerm,
  filterStudyType,
  setFilterStudyType,
  availableStudyTypesForFilter,
  filterLocation,
  setFilterLocation,
  locationFilterOptions,
  filterGender,
  setFilterGender,
  filterRegistryIssue,
  setFilterRegistryIssue,
  viewMode,
  setViewMode,
  pageSize,
  setPageSize,
}: StudentRegistryFiltersProps) {
  return (
    <>
      <div className="tp-filter-field tp-filter-primary">
        <Label htmlFor="registry-course" className="text-xs">
          اسم الدورة
        </Label>
        <Select
          name="courseId"
          value={filterCourseId || "all"}
          onValueChange={(v) => {
            setFilterCourseId(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger id="registry-course">
            <SelectValue placeholder="كل الدورات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الدورات</SelectItem>
            {courses.map((course) => (
              <SelectItem key={course.id} value={course.id}>
                {course.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="tp-filter-field tp-filter-primary">
        <Label htmlFor="registry-program" className="text-xs">
          نظام الاشتراك
        </Label>
        <Select
          name="courseProgram"
          value={filterCourseProgram || "all"}
          onValueChange={(v) => {
            setFilterCourseProgram(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger id="registry-program">
            <SelectValue placeholder="الكل" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل</SelectItem>
            {availableProgramsForFilter.map((program) => (
              <SelectItem key={program} value={program}>
                {program}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {filterCourseProgram === "كورسات" && (
        <div className="tp-filter-field tp-filter-primary">
          <Label htmlFor="registry-term" className="text-xs">
            الكورس المطلوب
          </Label>
          <Select
            name="courseTerm"
            value={filterCourseTerm || "all"}
            onValueChange={(v) => {
              setFilterCourseTerm(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger id="registry-term">
              <SelectValue placeholder="الكل" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              {STUDENT_FILTER_COURSE_TERMS.map((term) => (
                <SelectItem key={term} value={term}>
                  {term}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="tp-filter-field tp-filter-primary">
        <Label htmlFor="registry-study-type" className="text-xs">
          نظام الدراسة
        </Label>
        <Select
          name="studyType"
          value={filterStudyType || "all"}
          onValueChange={(v) => {
            setFilterStudyType(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger id="registry-study-type">
            <SelectValue placeholder="الكل" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل</SelectItem>
            {availableStudyTypesForFilter.map((studyType) => (
              <SelectItem key={studyType} value={studyType}>
                {studyType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="tp-filter-field tp-filter-secondary">
        <Label htmlFor="registry-location" className="text-xs">
          المحافظة / الموقع
        </Label>
        <Select
          name="location"
          value={filterLocation || "all"}
          onValueChange={(v) => {
            setFilterLocation(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger id="registry-location">
            <SelectValue placeholder="الكل" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل</SelectItem>
            {locationFilterOptions.map((location) => (
              <SelectItem key={location} value={location}>
                {location}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="tp-filter-field tp-filter-secondary">
        <Label htmlFor="registry-gender" className="text-xs">
          الجنس
        </Label>
        <Select
          name="gender"
          value={filterGender || "all"}
          onValueChange={(v) => {
            setFilterGender(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger id="registry-gender">
            <SelectValue placeholder="كل الأجناس" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل</SelectItem>
            <SelectItem value="ذكر">ذكر</SelectItem>
            <SelectItem value="أنثى">أنثى</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="tp-filter-field tp-filter-secondary">
        <Label htmlFor="registry-issue" className="text-xs">
          مشاكل/صحة الطالب
        </Label>
        <Select
          name="registryIssue"
          value={filterRegistryIssue || "all"}
          onValueChange={(v) => {
            setFilterRegistryIssue(
              v === "all" ? "" : (v as RegistryIssueFilter),
            );
            setPage(1);
          }}
        >
          <SelectTrigger id="registry-issue">
            <SelectValue placeholder="كل الطلاب" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الطلاب</SelectItem>
            {Object.entries(registryIssueFilterLabels).map(
              ([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="tp-filter-field tp-filter-meta">
        <Label htmlFor="registry-view" className="text-xs">
          طريقة العرض
        </Label>
        <Select
          value={viewMode}
          onValueChange={(v) => setViewMode(v as RegistryViewMode)}
        >
          <SelectTrigger id="registry-view">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cards">البطاقات</SelectItem>
            <SelectItem value="table">الجدول</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="tp-filter-field tp-filter-meta">
        <Label htmlFor="registry-pageSize" className="text-xs">
          حجم الصفحة
        </Label>
        <Select
          name="pageSize"
          value={String(pageSize)}
          onValueChange={(v) => {
            setPageSize(Number(v));
            setPage(1);
          }}
        >
          <SelectTrigger id="registry-pageSize" className="tabular-nums">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
