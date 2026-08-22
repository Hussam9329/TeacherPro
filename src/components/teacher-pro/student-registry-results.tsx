"use client";

import React from "react";
import {
  Archive,
  Eye,
  Pencil,
  RotateCcw,
  UserX,
} from "lucide-react";
import type { Student } from "@/lib/teacher-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatAppDate, sanitizePhoneInput } from "@/lib/format";
import { formatOpportunityBalance } from "@/lib/opportunity-balance";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import { formatStudentGraceRemaining } from "./student-registry-helpers";

const ARCHIVED_STUDENT_STATUS = "مؤرشف";

export type RegistryIssueFilter =
  | ""
  | "no-active-chapter"
  | "active-chapter-conflict"
  | "zero-opportunity-limit"
  | "zero-opportunities"
  | "opportunity-full"
  | "opportunity-over-limit"
  | "missing-contact"
  | "no-telegram";

type RegistryStudentHealth = Student & {
  hasActiveChapter?: boolean;
  activeChapterConflictCount?: number;
  activeChapter?: { id: string; name: string; opportunities: number } | null;
  opportunityLimit?: number | null;
  opportunityHealth?:
    | "ready"
    | "zero-limit"
    | "missing-active-chapter"
    | "active-chapter-conflict";
  isOpportunityFull?: boolean;
  isOpportunityOverLimit?: boolean;
};

export const registryIssueFilterLabels: Record<
  Exclude<RegistryIssueFilter, "">,
  string
> = {
  "no-active-chapter": "بدون فصل نشط",
  "active-chapter-conflict": "تعارض فصول نشطة",
  "zero-opportunity-limit": "سقف فرص صفر",
  "zero-opportunities": "فرص صفر",
  "opportunity-full": "فرص كاملة",
  "opportunity-over-limit": "فوق السقف",
  "missing-contact": "ناقص بيانات تواصل",
  "no-telegram": "بلا تيليجرام",
};

function registryHealthBadges(student: Student) {
  const row = student as RegistryStudentHealth;
  const badges: Array<{ label: string; className: string }> = [];
  const conflictCount = Number(row.activeChapterConflictCount || 0);
  const opportunityHealth =
    row.opportunityHealth ||
    (conflictCount > 1
      ? "active-chapter-conflict"
      : row.hasActiveChapter === false
        ? "missing-active-chapter"
        : Number(row.activeChapter?.opportunities) === 0
          ? "zero-limit"
          : "ready");

  if (opportunityHealth === "active-chapter-conflict") {
    badges.push({
      label: `تعارض فصول نشطة: ${conflictCount}`,
      className:
        "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    });
  } else if (opportunityHealth === "missing-active-chapter") {
    badges.push({
      label: "بدون فصل نشط",
      className:
        "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    });
  } else if (opportunityHealth === "zero-limit") {
    badges.push({
      label: "سقف فرص صفر",
      className:
        "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    });
  }

  if (opportunityHealth === "ready" && row.isOpportunityOverLimit) {
    badges.push({
      label: "فرص فوق السقف",
      className:
        "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    });
  } else if (opportunityHealth === "ready" && row.isOpportunityFull) {
    badges.push({
      label: "فرص كاملة",
      className:
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    });
  }

  if (
    !sanitizePhoneInput(student.phone || "") ||
    !sanitizePhoneInput(student.parentPhone || "")
  ) {
    badges.push({
      label: "ناقص بيانات تواصل",
      className:
        "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    });
  }

  if (!normalizeTelegramIdentifier(student.telegram || "")) {
    badges.push({
      label: "بلا تيليجرام",
      className:
        "border-muted-foreground/30 bg-muted/60 text-muted-foreground",
    });
  }

  return badges;
}

export function studentMatchesRegistryIssue(
  student: Student,
  issue: RegistryIssueFilter,
): boolean {
  if (!issue) return true;
  const row = student as RegistryStudentHealth;
  const conflictCount = Number(row.activeChapterConflictCount || 0);
  const limit =
    row.opportunityLimit ??
    (row.activeChapter ? Number(row.activeChapter.opportunities || 0) : null);
  const health =
    row.opportunityHealth ||
    (conflictCount > 1
      ? "active-chapter-conflict"
      : row.hasActiveChapter === false
        ? "missing-active-chapter"
        : limit === 0
          ? "zero-limit"
          : "ready");

  if (issue === "no-active-chapter") return health === "missing-active-chapter";
  if (issue === "active-chapter-conflict")
    return health === "active-chapter-conflict";
  if (issue === "zero-opportunity-limit") return health === "zero-limit";
  if (issue === "zero-opportunities")
    return student.status === "نشط" && Number(student.opportunities || 0) === 0;
  if (issue === "opportunity-full")
    return (
      health === "ready" &&
      limit !== null &&
      Number(student.opportunities || 0) === limit
    );
  if (issue === "opportunity-over-limit")
    return (
      health === "ready" &&
      limit !== null &&
      Number(student.opportunities || 0) > limit
    );
  if (issue === "missing-contact")
    return (
      !sanitizePhoneInput(student.phone || "") ||
      !sanitizePhoneInput(student.parentPhone || "")
    );
  if (issue === "no-telegram")
    return !normalizeTelegramIdentifier(student.telegram || "");
  return true;
}

export function formatRegistryLocation(student: Student): string {
  const primary = String(
    student.locationScope || student.mainSite || "",
  ).trim();
  const secondary = String(student.subSite || "").trim();
  if (primary === "بغداد" && secondary === "عموم بغداد") {
    return "عموم بغداد";
  }
  return (
    Array.from(new Set([primary, secondary].filter(Boolean))).join(" — ") ||
    "—"
  );
}

function formatRegistryCourseProgram(student: Student): string {
  if (!student.courseProgram) return "—";
  if (student.courseProgram !== "كورسات") return student.courseProgram;
  return student.courseTerm ? `كورسات — ${student.courseTerm}` : "كورسات";
}

function ContactLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return <span className="text-muted-foreground">{children || "—"}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all font-bold text-primary underline-offset-4 hover:underline"
    >
      {children || "—"}
    </a>
  );
}

function StudentStatusBadge({ status }: { status: Student["status"] }) {
  return (
    <Badge
      variant={
        status === "نشط"
          ? "default"
          : status === ARCHIVED_STUDENT_STATUS
            ? "secondary"
            : "destructive"
      }
    >
      {status}
    </Badge>
  );
}

function StudentHealthIndicators({
  student,
  activeIssue,
  className = "",
}: {
  student: Student;
  activeIssue: RegistryIssueFilter;
  className?: string;
}) {
  const badges = registryHealthBadges(student);
  if (badges.length === 0 && !activeIssue) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`.trim()}>
      {activeIssue && (
        <span className="w-full text-[11px] font-bold text-muted-foreground">
          سبب الظهور: {registryIssueFilterLabels[activeIssue]}
        </span>
      )}
      {badges.map((badge) => (
        <Badge
          key={badge.label}
          variant="outline"
          className={`rounded-full ${badge.className}`}
        >
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}

function StudentDismissalDetails({ student }: { student: Student }) {
  if (student.status !== "مفصول") return null;
  return (
    <div className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
      <div>
        {[student.dismissalType, student.dismissalReason]
          .filter(Boolean)
          .join(" — ") || "سبب الفصل غير مدخل"}
      </div>
      {student.dismissalNotes && (
        <div className="mt-1 text-destructive/80">
          ملاحظات: {student.dismissalNotes}
        </div>
      )}
    </div>
  );
}

type StudentActionsProps = {
  student: Student;
  canEdit: boolean;
  canArchive: boolean;
  serverUnavailable: boolean;
  statusActionSaving: boolean;
  deleting: boolean;
  onFile: (student: Student) => void;
  onEdit: (student: Student) => void;
  onDismiss: (student: Student) => void;
  onReactivate: (student: Student) => void;
  onArchive: (student: Student) => void;
};

function StudentActions({
  student,
  canEdit,
  canArchive,
  serverUnavailable,
  statusActionSaving,
  deleting,
  onFile,
  onEdit,
  onDismiss,
  onReactivate,
  onArchive,
}: StudentActionsProps) {
  return (
    <>
      <Button
        variant="default"
        size="sm"
        className="tp-student-registry__action-button"
        onClick={() => onFile(student)}
      >
        <Eye aria-hidden="true" className="size-4" />
        ملف الطالب
      </Button>
      {canEdit && (
        <Button
          variant="secondary"
          size="sm"
          className="tp-student-registry__action-button"
          disabled={serverUnavailable}
          onClick={() => onEdit(student)}
        >
          <Pencil aria-hidden="true" className="size-4" />
          تعديل
        </Button>
      )}
      {canEdit &&
        (student.status === "نشط" ? (
          <Button
            variant="destructive"
            size="sm"
            className="tp-student-registry__action-button"
            disabled={serverUnavailable || statusActionSaving}
            onClick={() => onDismiss(student)}
          >
            <UserX aria-hidden="true" className="size-4" />
            فصل
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="tp-student-registry__action-button tp-student-registry__action-button--restore"
            disabled={serverUnavailable || statusActionSaving}
            onClick={() => onReactivate(student)}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {student.status === ARCHIVED_STUDENT_STATUS
              ? "استعادة"
              : "إعادة تفعيل"}
          </Button>
        ))}
      {canArchive && student.status !== ARCHIVED_STUDENT_STATUS && (
        <Button
          variant="outline"
          size="sm"
          className="tp-student-registry__action-button border-destructive/40 text-destructive hover:bg-destructive/10"
          disabled={serverUnavailable || deleting}
          onClick={() => onArchive(student)}
        >
          <Archive aria-hidden="true" className="size-4" />
          أرشفة
        </Button>
      )}
    </>
  );
}

type StudentRegistryResultsProps = Omit<StudentActionsProps, "student"> & {
  students: Student[];
  viewMode: "cards" | "table";
  activeIssue: RegistryIssueFilter;
  courseName: (courseId: string) => string;
  whatsappLink: (phone: string) => string;
  telegramLink: (telegram: string) => string;
};

export function StudentRegistryResults({
  students,
  viewMode,
  activeIssue,
  courseName,
  whatsappLink,
  telegramLink,
  ...actionProps
}: StudentRegistryResultsProps) {
  if (viewMode === "cards") {
    return (
      <div className="tp-student-registry__cards grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {students.map((student) => (
          <Card
            key={student.id}
            className="transition-[border-color,box-shadow] duration-200 hover:border-primary/25 hover:shadow-xl hover:shadow-primary/10"
          >
            <CardContent className="p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{student.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {student.code} — {student.school || "بدون مدرسة"}
                  </p>
                </div>
                <StudentStatusBadge status={student.status} />
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                <RegistryField label="الدورة" value={courseName(student.courseId) || "—"} />
                <RegistryField label="نوع الدورة" value={formatRegistryCourseProgram(student)} />
                <RegistryField label="نوع البرنامج" value={student.studyType || "—"} />
                <RegistryField label="الجنس" value={student.gender || "—"} />
                <RegistryField label="الموقع" value={formatRegistryLocation(student)} />
                <RegistryField label="الفرص" value={formatOpportunityBalance(student, { separator: " / " })} />
                <RegistryField label="السماح المتبقي" value={formatStudentGraceRemaining(student)} />
                <RegistryField label="تاريخ الإضافة" value={formatAppDate(student.createdAt, student.createdAt || "—")} />
                <RegistryField
                  label="تيليجرام"
                  value={
                    student.telegram ? (
                      <ContactLink href={telegramLink(student.telegram)}>
                        {student.telegram}
                      </ContactLink>
                    ) : (
                      "—"
                    )
                  }
                />
                <RegistryField
                  label="رقم الطالب"
                  value={
                    <ContactLink href={whatsappLink(student.phone)}>
                      {student.phone}
                    </ContactLink>
                  }
                />
                <RegistryField
                  label="ولي الأمر"
                  value={
                    <ContactLink href={whatsappLink(student.parentPhone)}>
                      {student.parentPhone}
                    </ContactLink>
                  }
                />
              </div>

              <StudentHealthIndicators
                student={student}
                activeIssue={activeIssue}
                className="mb-3"
              />
              <div className="mb-3">
                <StudentDismissalDetails student={student} />
              </div>
              <div className="tp-student-registry__card-actions">
                <StudentActions student={student} {...actionProps} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-3 lg:hidden">
        {students.map((student) => (
          <CompactStudentRow
            key={student.id}
            student={student}
            activeIssue={activeIssue}
            courseName={courseName}
            whatsappLink={whatsappLink}
            telegramLink={telegramLink}
            {...actionProps}
          />
        ))}
      </div>
      <div className="table-wrap tp-student-registry__table-wrap hidden lg:block" tabIndex={0} aria-label="جدول سجل الطلاب؛ يمكن تمريره أفقياً وعمودياً">
        <table className="responsive-table tp-student-registry__table min-w-[1120px] text-sm">
          <caption className="sr-only">
            نتائج سجل الطلاب حسب الفلاتر الحالية، وتشمل بيانات الدراسة والتواصل والحالة والإجراءات.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-3 text-right">الطالب</th>
              <th scope="col" className="p-3 text-right">الدراسة</th>
              <th scope="col" className="p-3 text-right">الموقع</th>
              <th scope="col" className="p-3 text-right">التواصل</th>
              <th scope="col" className="p-3 text-right">الملف الأكاديمي</th>
              <th scope="col" className="p-3 text-right">الحالة وسلامة الملف</th>
              <th scope="col" className="p-3 text-right">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.id} className="border-t align-top">
                <td className="min-w-52 p-3 font-medium">
                  <p>{student.name}</p>
                  <p className="text-xs text-muted-foreground">{student.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {student.school || "بدون مدرسة"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    الجنس: {student.gender || "—"}
                  </p>
                </td>
                <td className="min-w-48 p-3">
                  <p className="font-bold">{courseName(student.courseId) || "—"}</p>
                  <p className="text-xs">{formatRegistryCourseProgram(student)}</p>
                  <p className="text-xs text-muted-foreground">
                    {student.studyType || "—"}
                  </p>
                </td>
                <td className="min-w-44 p-3">{formatRegistryLocation(student)}</td>
                <td className="min-w-52 space-y-1 p-3 text-xs">
                  <p>
                    الطالب: <ContactLink href={whatsappLink(student.phone)}>{student.phone}</ContactLink>
                  </p>
                  <p>
                    ولي الأمر: <ContactLink href={whatsappLink(student.parentPhone)}>{student.parentPhone}</ContactLink>
                  </p>
                  <p>
                    تيليجرام:{" "}
                    {student.telegram ? (
                      <ContactLink href={telegramLink(student.telegram)}>{student.telegram}</ContactLink>
                    ) : (
                      "—"
                    )}
                  </p>
                </td>
                <td className="min-w-40 space-y-1 p-3 text-xs">
                  <p>الفرص: <strong>{formatOpportunityBalance(student, { separator: " / " })}</strong></p>
                  <p>السماح المتبقي: {formatStudentGraceRemaining(student)}</p>
                  <p>التسجيل: {formatAppDate(student.createdAt, student.createdAt || "—")}</p>
                </td>
                <td className="min-w-64 space-y-2 p-3">
                  <StudentStatusBadge status={student.status} />
                  <StudentHealthIndicators student={student} activeIssue={activeIssue} />
                  <StudentDismissalDetails student={student} />
                </td>
                <td className="tp-student-registry__actions-cell min-w-72 p-3">
                  <div className="tp-student-registry__table-actions">
                    <StudentActions student={student} {...actionProps} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompactStudentRow({
  student,
  activeIssue,
  courseName,
  whatsappLink,
  telegramLink,
  ...actionProps
}: StudentActionsProps & {
  activeIssue: RegistryIssueFilter;
  courseName: (courseId: string) => string;
  whatsappLink: (phone: string) => string;
  telegramLink: (telegram: string) => string;
}) {
  return (
    <article className="rounded-2xl border bg-card/85 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-black">{student.name}</h3>
          <p className="text-xs text-muted-foreground">
            {student.code} — {student.school || "بدون مدرسة"}
          </p>
        </div>
        <StudentStatusBadge status={student.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <RegistryField label="الدورة" value={courseName(student.courseId) || "—"} />
        <RegistryField label="نوع الدورة" value={formatRegistryCourseProgram(student)} />
        <RegistryField label="الدراسة" value={student.studyType || "—"} />
        <RegistryField label="الجنس" value={student.gender || "—"} />
        <RegistryField label="الموقع" value={formatRegistryLocation(student)} />
        <RegistryField label="الفرص" value={formatOpportunityBalance(student, { separator: " / " })} />
        <RegistryField label="السماح المتبقي" value={formatStudentGraceRemaining(student)} />
        <RegistryField label="التسجيل" value={formatAppDate(student.createdAt, student.createdAt || "—")} />
      </div>
      <div className="mt-3 space-y-1 rounded-xl bg-muted/35 p-2 text-xs">
        <p>
          الطالب: <ContactLink href={whatsappLink(student.phone)}>{student.phone}</ContactLink>
        </p>
        <p>
          ولي الأمر: <ContactLink href={whatsappLink(student.parentPhone)}>{student.parentPhone}</ContactLink>
        </p>
        <p>
          تيليجرام:{" "}
          {student.telegram ? (
            <ContactLink href={telegramLink(student.telegram)}>{student.telegram}</ContactLink>
          ) : (
            "—"
          )}
        </p>
      </div>
      <StudentHealthIndicators
        student={student}
        activeIssue={activeIssue}
        className="mt-3"
      />
      <div className="mt-3">
        <StudentDismissalDetails student={student} />
      </div>
      <div className="tp-student-registry__table-actions mt-3">
        <StudentActions student={student} {...actionProps} />
      </div>
    </article>
  );
}

function RegistryField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="break-words text-xs font-medium">{value}</div>
    </div>
  );
}
