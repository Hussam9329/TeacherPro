"use client";

import React from "react";
import {
  Archive,
  Eye,
  MessageCircle,
  Pencil,
  Phone,
  RotateCcw,
  Send,
  UserX,
} from "lucide-react";
import type { Student } from "@/lib/teacher-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAppDate, sanitizePhoneInput } from "@/lib/format";
import { formatOpportunityBalance } from "@/lib/opportunity-balance";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import { formatGraceDate } from "@/lib/grace-periods";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import {
  currentStudentGracePeriod,
  formatStudentCurrentGrace,
} from "./student-registry-helpers";
import { displayReasonText } from "@/lib/reason-display";
import { RowActionsMenu, type RowAction } from "./row-actions-menu";
import "./student-registry-results.css";

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
        "border-danger-line bg-danger-soft text-danger",
    });
  } else if (opportunityHealth === "missing-active-chapter") {
    badges.push({
      label: "بدون فصل نشط",
      className:
        "border-warning-line bg-warning-soft text-warning",
    });
  } else if (opportunityHealth === "zero-limit") {
    badges.push({
      label: "سقف فرص صفر",
      className:
        "border-warning-line bg-warning-soft text-warning",
    });
  }

  if (opportunityHealth === "ready" && row.isOpportunityOverLimit) {
    badges.push({
      label: "فرص فوق السقف",
      className:
        "border-danger-line bg-danger-soft text-danger",
    });
  } else if (opportunityHealth === "ready" && row.isOpportunityFull) {
    badges.push({
      label: "فرص كاملة",
      className:
        "border-success-line bg-success-soft text-success",
    });
  }

  if (
    !sanitizePhoneInput(student.phone || "") ||
    !sanitizePhoneInput(student.parentPhone || "")
  ) {
    badges.push({
      label: "ناقص بيانات تواصل",
      className:
        "border-warning-line bg-warning-soft text-warning",
    });
  }

  // شارة «بلا تيليجرام» أُلغيت من كرت الطالب — الفلتر (بلا تيليجرام)
  // في مشاكل السجل يبقى متاحاً للبحث عن هؤلاء الطلاب.

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
    Array.from(new Set([primary, secondary].filter(Boolean))).join(" — ") || "—"
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
      className="tp-registry-contact break-all font-bold text-primary underline-offset-4 hover:underline"
    >
      {children || "—"}
    </a>
  );
}

function StudentStatusBadge({ status }: { status: Student["status"] }) {
  if (status === "نشط") {
    return (
      <Badge variant="success">
        <span className="tp-status-dot text-success-vivid" aria-hidden="true" />
        {status}
      </Badge>
    );
  }
  if (status === ARCHIVED_STUDENT_STATUS) {
    return (
      <Badge variant="secondary">
        <Archive aria-hidden="true" />
        {status}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <UserX aria-hidden="true" />
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

/** Glowing grace light: green while the period runs, amber on its last day. */
function GraceLightPill({ endDate, children }: { endDate: string; children: React.ReactNode }) {
  const endsToday = endDate === baghdadTodayKey();
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 font-semibold ${
        endsToday
          ? "border-warning-line bg-warning-soft text-warning"
          : "border-success-line bg-success-soft text-success"
      }`}
    >
      <span
        className={`tp-status-dot ${endsToday ? "text-warning-vivid" : "text-success-vivid"}`}
        aria-hidden="true"
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

function StudentCurrentGraceNote({ student }: { student: Student }) {
  const text = formatStudentCurrentGrace(student);
  const period = currentStudentGracePeriod(student);
  if (!text || !period) return null;
  return (
    <p>
      <GraceLightPill endDate={period.endDate}>{text}</GraceLightPill>
    </p>
  );
}

function StudentDismissalDetails({ student }: { student: Student }) {
  if (student.status !== "مفصول") return null;
  return (
    <div className="rounded-lg border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-2 text-xs font-medium text-danger">
      <div>{displayReasonText(student.dismissalReason) || "سبب الفصل غير مدخل"}</div>
      {student.dismissalNotes && (
        <div className="mt-1 text-danger/85">
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
  onRestore: (student: Student) => void;
  onArchive: (student: Student) => void;
};

function studentMoreActions({
  student,
  canEdit,
  canArchive,
  serverUnavailable,
  statusActionSaving,
  deleting,
  onEdit,
  onDismiss,
  onRestore,
  onArchive,
}: StudentActionsProps): RowAction[] {
  const actions: RowAction[] = [];
  // An archived student is frozen: «استعادة من الأرشيف» is the only action.
  if (canEdit && student.status !== ARCHIVED_STUDENT_STATUS) {
    actions.push({
      key: "edit",
      label: "تعديل",
      icon: <Pencil aria-hidden="true" />,
      disabled: serverUnavailable,
      onSelect: () => onEdit(student),
    });
  }
  if (canEdit && student.status === ARCHIVED_STUDENT_STATUS) {
    actions.push({
      key: "restore",
      label: "استعادة من الأرشيف",
      icon: <RotateCcw aria-hidden="true" />,
      disabled: serverUnavailable || statusActionSaving,
      onSelect: () => onRestore(student),
    });
  }
  if (canEdit && student.status === "نشط") {
    actions.push({
      key: "dismiss",
      label: "فصل…",
      icon: <UserX aria-hidden="true" />,
      danger: true,
      disabled: serverUnavailable || statusActionSaving,
      onSelect: () => onDismiss(student),
    });
  }
  if (canArchive && student.status !== ARCHIVED_STUDENT_STATUS) {
    actions.push({
      key: "archive",
      label: "أرشفة…",
      icon: <Archive aria-hidden="true" />,
      danger: true,
      disabled: serverUnavailable || deleting,
      onSelect: () => onArchive(student),
    });
  }
  return actions;
}

function StudentActions(props: StudentActionsProps) {
  const { student, onFile } = props;
  return (
    <>
      <Button
        variant="default"
        size="sm"
        className="tp-registry-action"
        onClick={() => onFile(student)}
      >
        <Eye aria-hidden="true" className="size-4" />
        ملف الطالب
      </Button>
      <RowActionsMenu label={`إجراءات أخرى لـ${student.name}`} actions={studentMoreActions(props)} />
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
      <div className="tp-registry-results tp-rcards" data-columns="2">
        {students.map((student) => (
          <StudentRegistryRow
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
    );
  }

  return (
    <div
      className="table-wrap tp-registry-results tp-registry-results__table-wrap"
      tabIndex={0}
      role="region"
      aria-label="جدول سجل الطلاب؛ يمكن تمريره أفقياً وعمودياً"
    >
      <table className="responsive-table tp-registry-results__table text-sm">
        <caption className="sr-only">
          نتائج سجل الطلاب حسب الفلاتر الحالية، وتشمل بيانات الدراسة والتواصل
          والحالة والإجراءات.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="p-3 text-right">
              الطالب
            </th>
            <th scope="col" className="p-3 text-right">
              الدراسة
            </th>
            <th scope="col" className="p-3 text-right">
              الموقع
            </th>
            <th scope="col" className="p-3 text-right">
              التواصل
            </th>
            <th scope="col" className="p-3 text-right">
              الملف الأكاديمي
            </th>
            <th scope="col" className="p-3 text-right">
              الحالة وسلامة الملف
            </th>
            <th scope="col" className="p-3 text-right">
              الإجراءات
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr
              key={student.id}
              className="border-t align-top"
              data-dismissed={student.status === "مفصول" || undefined}
            >
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
                <p className="font-bold">
                  {courseName(student.courseId) || "—"}
                </p>
                <p className="text-xs">
                  {formatRegistryCourseProgram(student)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {student.studyType || "—"}
                </p>
              </td>
              <td className="min-w-44 p-3">
                {formatRegistryLocation(student)}
              </td>
              <td className="min-w-52 space-y-1 p-3 text-xs">
                <p>
                  الطالب:{" "}
                  <ContactLink href={whatsappLink(student.phone)}>
                    {student.phone}
                  </ContactLink>
                </p>
                <p>
                  ولي الأمر:{" "}
                  <ContactLink href={whatsappLink(student.parentPhone)}>
                    {student.parentPhone}
                  </ContactLink>
                </p>
                <p>
                  يوزر تيليجرام:{" "}
                  {student.username ? (
                    <ContactLink href={telegramLink(student.username)}>
                      {student.username}
                    </ContactLink>
                  ) : (
                    "—"
                  )}
                </p>
                <p>
                  معرف تيليجرام:{" "}
                  {student.telegram ? (
                    /^\d+$/.test(student.telegram) ? (
                      <span dir="ltr">{student.telegram}</span>
                    ) : (
                      <ContactLink href={telegramLink(student.telegram)}>
                        {student.telegram}
                      </ContactLink>
                    )
                  ) : (
                    "—"
                  )}
                </p>
              </td>
              <td className="min-w-40 space-y-1 p-3 text-xs">
                <p>
                  الفرص:{" "}
                  <strong>
                    {formatOpportunityBalance(student, { separator: " / " })}
                  </strong>
                </p>
                <StudentCurrentGraceNote student={student} />
                <p>
                  التسجيل:{" "}
                  {formatAppDate(student.createdAt, student.createdAt || "—")}
                </p>
              </td>
              <td className="min-w-64 space-y-2 p-3">
                <div className="tp-registry-row__status">
                  <StudentStatusBadge status={student.status} />
                </div>
                <StudentHealthIndicators
                  student={student}
                  activeIssue={activeIssue}
                />
                <StudentDismissalDetails student={student} />
              </td>
              <td className="min-w-64 p-3">
                <div className="tp-registry-row-actions">
                  <StudentActions student={student} {...actionProps} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusTone(status: Student["status"]): "success" | "danger" | "muted" {
  return status === "نشط" ? "success" : status === "مفصول" ? "danger" : "muted";
}

function StudentRegistryRow({
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
  const currentGrace = currentStudentGracePeriod(student);
  const row = student as RegistryStudentHealth;
  const tone = statusTone(student.status);
  const dismissed = student.status === "مفصول";
  const balance = Math.max(0, Number(student.opportunities ?? 0));
  const limit = Number(row.opportunityLimit ?? row.activeChapter?.opportunities ?? NaN);
  const dots = Number.isFinite(limit) ? Math.min(Math.max(limit, balance), 6) : 0;
  const balanceTone = dismissed ? "danger" : balance <= 0 ? "warning" : Number.isFinite(limit) && balance < limit ? "warning" : "success";
  // Only filled facts; nothing shows «—».
  const facts = [
    student.school,
    student.courseProgram ? formatRegistryCourseProgram(student) : "",
    student.studyType,
    formatRegistryLocation(student) !== "—" ? formatRegistryLocation(student) : "",
    student.gender,
    student.createdAt ? `مسجّل ${formatAppDate(student.createdAt, "")}` : "",
  ].filter(Boolean);
  const missingContacts = [
    !sanitizePhoneInput(student.phone || "") ? "رقم الطالب" : "",
    !sanitizePhoneInput(student.parentPhone || "") ? "رقم ولي الأمر" : "",
  ].filter(Boolean);
  const telegramHandle = student.username || (student.telegram && !/^\d+$/.test(student.telegram) ? student.telegram : "");
  const healthBadges = registryHealthBadges(student).filter((badge) => badge.label !== "ناقص بيانات تواصل" && badge.label !== "فرص كاملة");
  const moreActions = studentMoreActions({ student, ...actionProps });
  return (
    <article
      className="tp-rcard"
      aria-labelledby={`registry-student-${student.id}`}
      data-tone={dismissed ? "danger" : undefined}
      data-muted={student.status === ARCHIVED_STUDENT_STATUS ? "true" : undefined}
      data-dismissed={dismissed || undefined}
    >
      <div className="tp-rcard__head">
        <span className="tp-rcard__light" data-tone={tone} aria-hidden="true" />
        <h3 id={`registry-student-${student.id}`} className="tp-rcard__name">{student.name}</h3>
        <span className="tp-rcard__sep" aria-hidden="true" />
        <bdi className="tp-rcard__code">{student.code}</bdi>
        <span className="tp-rcard__sub">
          {courseName(student.courseId) || "بدون دورة"}
          {row.activeChapter?.name ? ` · ${row.activeChapter.name}` : ""}
        </span>
        <span className="tp-rcard__head-end">
          <span className="tp-rcard__pill" data-tone={tone} data-solid={dismissed ? "true" : undefined}>
            {student.status}
          </span>
          {healthBadges.map((badge) => (
            <span
              key={badge.label}
              className="tp-rcard__pill"
              data-tone={badge.className.includes("danger") ? "danger" : "warning"}
            >
              {badge.label}
            </span>
          ))}
        </span>
      </div>

      <div className="tp-rcard__body" data-tile="true">
        <div className="tp-rcard__main">
          <div className="tp-rcard__panel" data-tone={balanceTone}>
            <span className="tp-rcard__eyebrow">الفرص</span>
            <span className="tp-rcard__title">
              {dots > 0 ? (
                <>
                  <span className="tp-meter" data-tone={balanceTone} aria-hidden="true">
                    {Array.from({ length: dots }, (_, index) => (
                      <i key={index} data-off={index >= balance ? "true" : undefined} />
                    ))}
                  </span>{" "}
                </>
              ) : null}
              {formatOpportunityBalance(student, { separator: " من " })}
            </span>
            {dismissed ? (
              <span className="tp-rcard__line">
                {displayReasonText(student.dismissalReason) || "سبب الفصل غير مدخل"}
                {student.dismissalNotes ? ` · ملاحظات: ${student.dismissalNotes}` : ""}
              </span>
            ) : null}
            {currentGrace ? (
              <span className="tp-rcard__line">
                <GraceLightPill endDate={currentGrace.endDate}>
                  {`فترة سماح حتى ${formatGraceDate(currentGrace.endDate)}`}
                </GraceLightPill>
              </span>
            ) : null}
          </div>
          {facts.length ? <p className="tp-rcard__line">{facts.join(" · ")}</p> : null}
          {activeIssue ? (
            <p className="tp-rcard__line">سبب الظهور: {registryIssueFilterLabels[activeIssue]}</p>
          ) : null}
        </div>
        <button type="button" className="tp-rcard__tile" onClick={() => actionProps.onFile(student)}>
          <span className="tp-rcard__tile-icon" aria-hidden="true">
            <Eye />
          </span>
          <span className="tp-rcard__tile-text">ملف الطالب</span>
          <span className="tp-rcard__tile-hint">الدرجات والفرص والمكالمات</span>
        </button>
      </div>

      <div className="tp-rcard__foot">
        {sanitizePhoneInput(student.phone || "") ? (
          <a className="tp-rcard__contact" href={whatsappLink(student.phone)} target="_blank" rel="noopener noreferrer">
            <Phone aria-hidden="true" />
            <span dir="ltr" className="tabular-nums">{student.phone}</span>
          </a>
        ) : null}
        {sanitizePhoneInput(student.parentPhone || "") ? (
          <a className="tp-rcard__contact" href={whatsappLink(student.parentPhone)} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden="true" />
            ولي الأمر <span dir="ltr" className="tabular-nums">{student.parentPhone}</span>
          </a>
        ) : null}
        {telegramHandle ? (
          <a className="tp-rcard__contact" href={telegramLink(telegramHandle)} target="_blank" rel="noopener noreferrer" dir="ltr">
            <Send aria-hidden="true" />
            {telegramHandle.startsWith("@") ? telegramHandle : `@${telegramHandle}`}
          </a>
        ) : null}
        {missingContacts.length ? (
          <span className="tp-rcard__pill" data-tone="warning">ناقص {missingContacts.join(" و")}</span>
        ) : null}
        {moreActions.length ? (
          <span className="tp-rcard__foot-end">
            <RowActionsMenu label={`إجراءات أخرى لـ${student.name}`} actions={moreActions} />
          </span>
        ) : null}
      </div>
    </article>
  );
}

