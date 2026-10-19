"use client";

import React from "react";
import {
  Archive,
  BookOpen,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Folder,
  GraduationCap,
  MessageCircle,
  Pencil,
  Phone,
  RotateCcw,
  Send,
  User,
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
import { StudentContactEdit, type StudentContactField } from "./student-contact-edit";
import "./student-registry-results.css";
import "./student-card.css";

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
  "no-telegram": "بلا تليگرام",
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

  // شارة «بلا تليگرام» أُلغيت من كرت الطالب — الفلتر (بلا تليگرام)
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
  /** A number fixed right on the card: the list shows it at once. */
  onContactSaved?: (studentId: string, field: StudentContactField, value: string | null) => void;
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
      <div className="tp-registry-results tp-scards">
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
                  يوزر تليگرام:{" "}
                  {student.username ? (
                    <ContactLink href={telegramLink(student.username)}>
                      {student.username}
                    </ContactLink>
                  ) : (
                    "—"
                  )}
                </p>
                <p>
                  معرف تليگرام:{" "}
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
  const balanceTone = dismissed ? "danger" : balance <= 0 ? "warning" : Number.isFinite(limit) && balance < limit ? "warning" : "success";
  // Only filled facts, each under its own label; nothing shows «—».
  const location = formatRegistryLocation(student);
  const facts = [
    { label: "المدرسة", value: student.school },
    { label: "البرنامج", value: student.courseProgram ? formatRegistryCourseProgram(student) : "" },
    { label: "نظام الدراسة", value: student.studyType },
    { label: "السكن", value: location !== "—" ? location : "" },
    { label: "الجنس", value: student.gender },
    { label: "التسجيل", value: student.createdAt ? formatAppDate(student.createdAt, "") : "" },
  ].filter((fact) => fact.value);
  const missingContacts = [
    !sanitizePhoneInput(student.phone || "") ? "رقم الطالب" : "",
    !sanitizePhoneInput(student.parentPhone || "") ? "رقم ولي الأمر" : "",
  ].filter(Boolean);
  const telegramHandle = student.username || (student.telegram && !/^\d+$/.test(student.telegram) ? student.telegram : "");
  const healthBadges = registryHealthBadges(student).filter((badge) => badge.label !== "ناقص بيانات تواصل" && badge.label !== "فرص كاملة");
  const moreActions = studentMoreActions({ student, ...actionProps });
  // Both numbers and the Telegram username are fixed right on the card, as the full edit would.
  const quickEdit = actionProps.canEdit && student.status !== ARCHIVED_STUDENT_STATUS;
  const archived = student.status === ARCHIVED_STUDENT_STATUS;
  const hasPhone = Boolean(sanitizePhoneInput(student.phone || ""));
  const hasParentPhone = Boolean(sanitizePhoneInput(student.parentPhone || ""));
  // The card shows the essentials; facts and contact edits open on demand.
  const [open, setOpen] = React.useState(false);
  const moreId = `registry-student-more-${student.id}`;
  // «الفصل الأول - الخلية» shows as the chapter and its topic.
  const [chapterTitle = "", ...topicParts] = (row.activeChapter?.name || "").split(/\s+-\s+/);
  const chapterTopic = topicParts.join(" - ");
  const graceEndsToday = currentGrace ? currentGrace.endDate === baghdadTodayKey() : false;
  const panelTone = dismissed ? "danger" : archived ? "muted" : currentGrace && graceEndsToday ? "warning" : "success";
  const ringPct = Number.isFinite(limit) && limit > 0 ? Math.min(100, Math.round((balance / limit) * 100)) : balance > 0 ? 100 : 0;
  return (
    <article
      className="tp-scard"
      aria-labelledby={`registry-student-${student.id}`}
      data-status={dismissed ? "dismissed" : archived ? "archived" : "active"}
    >
      {/* Who: the avatar tile, the name, status and code; «⋯» at the far end. */}
      <header className="tp-scard__head">
        <span className="tp-scard__avatar" data-tone={tone} aria-hidden="true">
          <User />
        </span>
        <div className="tp-scard__who">
          <h3 id={`registry-student-${student.id}`} className="tp-scard__name" title={student.name} style={{ "--name-len": student.name.trim().length } as React.CSSProperties}>{student.name}</h3>
          <p className="tp-scard__meta">
            <span className="tp-scard__status" data-tone={tone}>{student.status}</span>
            <bdi className="tp-scard__code">{student.code}</bdi>
          </p>
        </div>
        {moreActions.length ? (
          <RowActionsMenu label={`إجراءات أخرى لـ${student.name}`} actions={moreActions} />
        ) : null}
      </header>

      {/* Course, chapter and its topic, each with its icon. */}
      <ul className="tp-scard__study">
        <li title={courseName(student.courseId) || "بدون دورة"}>
          <GraduationCap aria-hidden="true" />
          <span>{courseName(student.courseId) || "بدون دورة"}</span>
        </li>
        {chapterTitle ? (
          <li title={chapterTitle}>
            <BookOpen aria-hidden="true" />
            <span>{chapterTitle}</span>
          </li>
        ) : null}
        {chapterTopic ? (
          <li title={chapterTopic}>
            <Building2 aria-hidden="true" />
            <span>{chapterTopic}</span>
          </li>
        ) : null}
      </ul>

      {/* The panel: the student's state and its date beside the balance ring. */}
      <section className="tp-scard__panel" data-tone={panelTone} aria-label="الفرص والحالة">
        <div className="tp-scard__state">
          {currentGrace ? (
            <span className="tp-scard__chip" data-tone={graceEndsToday ? "warning" : "success"}>
              <Clock aria-hidden="true" />
              ضمن فترة السماح
            </span>
          ) : null}
          <div className="tp-scard__when">
            <span className="tp-scard__when-icon" aria-hidden="true">
              <CalendarDays />
            </span>
            <span className="tp-scard__when-text">
              {currentGrace ? (
                <>
                  <small>فترة السماح حتى</small>
                  <b>{formatGraceDate(currentGrace.endDate)}</b>
                </>
              ) : dismissed ? (
                <>
                  <small>سبب الفصل</small>
                  <b>{displayReasonText(student.dismissalReason) || "سبب الفصل غير مدخل"}</b>
                  {student.dismissalNotes ? <small>ملاحظات: {student.dismissalNotes}</small> : null}
                </>
              ) : (
                <>
                  <small>تاريخ التسجيل</small>
                  <b>{student.createdAt ? formatAppDate(student.createdAt, "") : "غير مسجل"}</b>
                </>
              )}
            </span>
          </div>
        </div>
        <div
          className="tp-scard__ring"
          data-tone={balanceTone}
          style={{ "--ring-pct": `${ringPct}%` } as React.CSSProperties}
        >
          <span className="tp-scard__ring-inner">
            <b>{formatOpportunityBalance(student, { separator: " من " })}</b>
            <small>الفرص</small>
          </span>
        </div>
      </section>

      {healthBadges.length || activeIssue || missingContacts.length ? (
        <ul className="tp-scard__notes">
          {healthBadges.map((badge) => (
            <li key={badge.label} data-tone={badge.className.includes("danger") ? "danger" : "warning"}>{badge.label}</li>
          ))}
          {activeIssue ? <li data-tone="warning">سبب الظهور: {registryIssueFilterLabels[activeIssue]}</li> : null}
          {missingContacts.length ? <li data-tone="warning">ناقص {missingContacts.join(" و")}</li> : null}
        </ul>
      ) : null}

      {open ? (
        <div className="tp-scard__more" id={moreId}>
          {facts.length ? (
            <dl className="tp-scard__facts">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {hasPhone || hasParentPhone || telegramHandle || quickEdit ? (
            <div className="tp-scard__contacts">
              {hasPhone || quickEdit ? (
                <div className="tp-scard__contact-row">
                  <span className="tp-scard__contact-label">رقم الطالب</span>
                  {hasPhone ? (
                    <a className="tp-scard__contact" href={whatsappLink(student.phone)} target="_blank" rel="noopener noreferrer">
                      <span dir="ltr" className="tabular-nums">{student.phone}</span>
                    </a>
                  ) : null}
                  {quickEdit ? <StudentContactEdit student={student} field="phone" emptyLabel="رقم الطالب" onSaved={(value) => actionProps.onContactSaved?.(student.id, "phone", value)} /> : null}
                </div>
              ) : null}
              {hasParentPhone || quickEdit ? (
                <div className="tp-scard__contact-row">
                  <span className="tp-scard__contact-label">ولي الأمر</span>
                  {hasParentPhone ? (
                    <a className="tp-scard__contact" href={whatsappLink(student.parentPhone)} target="_blank" rel="noopener noreferrer">
                      <span dir="ltr" className="tabular-nums">{student.parentPhone}</span>
                    </a>
                  ) : null}
                  {quickEdit ? <StudentContactEdit student={student} field="parentPhone" emptyLabel="رقم ولي الأمر" onSaved={(value) => actionProps.onContactSaved?.(student.id, "parentPhone", value)} /> : null}
                </div>
              ) : null}
              {telegramHandle || quickEdit ? (
                <div className="tp-scard__contact-row">
                  <span className="tp-scard__contact-label">تليگرام</span>
                  {telegramHandle ? (
                    <a className="tp-scard__contact" href={telegramLink(telegramHandle)} target="_blank" rel="noopener noreferrer" dir="ltr">
                      {telegramHandle.startsWith("@") ? telegramHandle : `@${telegramHandle}`}
                    </a>
                  ) : null}
                  {quickEdit ? <StudentContactEdit student={student} field="username" emptyLabel="معرف تليگرام" onSaved={(value) => actionProps.onContactSaved?.(student.id, "username", value)} /> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="tp-scard__foot">
        <div className="tp-scard__reach">
          {hasPhone ? (
            <a className="tp-scard__round" href={whatsappLink(student.phone)} target="_blank" rel="noopener noreferrer" aria-label={`رقم الطالب ${student.phone}`} title={student.phone}>
              <Phone aria-hidden="true" />
            </a>
          ) : null}
          {hasParentPhone ? (
            <a className="tp-scard__round" href={whatsappLink(student.parentPhone)} target="_blank" rel="noopener noreferrer" aria-label={`ولي الأمر ${student.parentPhone}`} title={`ولي الأمر ${student.parentPhone}`}>
              <MessageCircle aria-hidden="true" />
            </a>
          ) : null}
          {telegramHandle ? (
            <a className="tp-scard__round" href={telegramLink(telegramHandle)} target="_blank" rel="noopener noreferrer" aria-label={`تليگرام ${telegramHandle}`} title={telegramHandle.startsWith("@") ? telegramHandle : `@${telegramHandle}`}>
              <Send aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <span className="tp-scard__divider" aria-hidden="true" />
        <button type="button" className="tp-scard__action" aria-expanded={open} aria-controls={moreId} onClick={() => setOpen((value) => !value)}>
          <ChevronDown className="tp-scard__chev" aria-hidden="true" />
          <span>التفاصيل</span>
          <FileText aria-hidden="true" />
        </button>
        <span className="tp-scard__divider" aria-hidden="true" />
        <button type="button" className="tp-scard__action" onClick={() => actionProps.onFile(student)} title="الدرجات والفرص والمكالمات">
          <ChevronRight aria-hidden="true" />
          <span>ملف الطالب</span>
          <Folder aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

