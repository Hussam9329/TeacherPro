"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileWarning,
  RefreshCw,
  ShieldAlert,
  UserRound,
  UserRoundX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  GradeSmartNoteCategory,
  GradeSmartNoteRecord,
  GradeSmartNoteStatus,
} from "@/lib/api";

const CATEGORY_META: Record<
  GradeSmartNoteCategory,
  {
    title: string;
    shortTitle: string;
    decision: string;
    className: string;
    icon: typeof ShieldAlert;
  }
> = {
  DISMISSED_PENDING: {
    title: "درجات طلاب مفصولين معلّقة",
    shortTitle: "طالب مفصول",
    decision: "لم تُسجّل كدرجة ولم تؤثر أكاديمياً؛ تنتظر مراجعة حالة الفصل.",
    className:
      "border-danger-line bg-danger-soft/80 text-danger",
    icon: UserRoundX,
  },
  // Historical only: the current grace model never creates or settles these.
  GRACE_SCORED: {
    title: "درجات سماح قديمة (أرشيف)",
    shortTitle: "درجة سماح قديمة (أرشيف)",
    decision: "سجل من نظام السماح السابق للعرض فقط؛ لا يغيّر المحاسبة ولا يُنشأ مثله بعد الآن.",
    className:
      "border-info-line bg-info-soft/80 text-info",
    icon: CheckCircle2,
  },
  BEFORE_REGISTRATION_PENDING: {
    title: "درجات امتحانات سابقة لتسجيل الطالب",
    shortTitle: "امتحان سابق للتسجيل",
    decision: "عند اعتمادها يُقدَّم تاريخ تسجيل الطالب إلى تاريخ الامتحان وتُحتسب الدرجة رسمياً.",
    className:
      "border-warning-line bg-warning-soft/80 text-warning",
    icon: CalendarClock,
  },
  LEAVE_PENDING: {
    title: "تعارضات إجازات تاريخية",
    shortTitle: "سجل إجازة قديم",
    decision: "سجلات قديمة للمراجعة فقط؛ إدخال درجة اليوم ينهي الإجازة ويعتمدها محتسبة.",
    className:
      "border-success-line bg-success-soft/80 text-success",
    icon: FileWarning,
  },
};

const STATUS_LABELS: Record<GradeSmartNoteStatus, string> = {
  PENDING: "درجة معلّقة",
  PROCESSED: "معالجة ومغلقة",
  CONFLICT: "تحتاج معالجة تعارض",
  REJECTED: "مرفوضة بعد المراجعة",
};

const STATUS_VARIANTS: Record<
  GradeSmartNoteStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  PROCESSED: "default",
  CONFLICT: "destructive",
  REJECTED: "outline",
};

const DEFAULT_VISIBLE_NOTES_COUNT = 5;

function formatSmartNoteTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "وقت غير معروف";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function GradeSmartNotesPanel({
  notes,
  totalCount,
  categoryCounts,
  loading,
  error,
  onRetry,
}: {
  notes: GradeSmartNoteRecord[];
  totalCount: number;
  categoryCounts: Partial<Record<GradeSmartNoteCategory, number>>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [activeCategory, setActiveCategory] =
    useState<GradeSmartNoteCategory | null>(null);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const filteredNotes = useMemo(
    () =>
      activeCategory
        ? notes.filter((note) => note.category === activeCategory)
        : notes,
    [activeCategory, notes],
  );
  const visibleNotes = useMemo(
    () =>
      showAllNotes
        ? filteredNotes
        : filteredNotes.slice(0, DEFAULT_VISIBLE_NOTES_COUNT),
    [filteredNotes, showAllNotes],
  );

  return (
    <Card
      className="overflow-hidden border-primary/30 bg-gradient-to-b from-primary/5 to-background"
      aria-labelledby="grade-smart-notes-title"
    >
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle id="grade-smart-notes-title" className="text-lg">
              لوحة الدرجات الذكية لهذا الامتحان
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" aria-label={`إجمالي السجلات ${totalCount}`}>
              الإجمالي: {totalCount}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={loading}
              aria-label="تحديث لوحة الدرجات الذكية"
            >
              <RefreshCw
                className={`ms-1 h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              تحديث
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(CATEGORY_META) as GradeSmartNoteCategory[]).map(
            (category) => {
              const meta = CATEGORY_META[category];
              const Icon = meta.icon;
              const count = Number(categoryCounts[category] || 0);
              const selected = activeCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() =>
                    setActiveCategory((current) => {
                      setShowAllNotes(false);
                      return current === category ? null : category;
                    })
                  }
                  aria-pressed={selected}
                  className={`min-h-11 min-w-0 touch-manipulation rounded-2xl border p-4 text-start transition [overflow-wrap:anywhere] hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${meta.className} ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block text-xs font-bold leading-5">
                        {meta.title}
                      </span>
                      <span className="mt-2 block text-2xl font-black tabular-nums">
                        {count}
                      </span>
                    </span>
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  </span>
                </button>
              );
            },
          )}
        </div>

        <section aria-labelledby="smart-notes-list-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 id="smart-notes-list-title" className="text-sm font-black">
                السجل المنظّم
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {activeCategory
                  ? `عرض: ${CATEGORY_META[activeCategory].title} — ${CATEGORY_META[activeCategory].decision}`
                  : "عرض كل محاولات الدرجات المحفوظة لهذا الامتحان وحالة مراجعتها."}
              </p>
            </div>
            {activeCategory && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActiveCategory(null);
                  setShowAllNotes(false);
                }}
              >
                إلغاء التصفية
              </Button>
            )}
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-2xl border border-destructive/35 bg-destructive/5 p-4 text-sm text-destructive"
            >
              <p>{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={onRetry}
              >
                إعادة المحاولة
              </Button>
            </div>
          ) : loading && notes.length === 0 ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-2xl border bg-background/80 p-4 text-sm text-muted-foreground"
            >
              جاري تحميل الدرجات الذكية...
            </p>
          ) : filteredNotes.length === 0 ? (
            <p className="rounded-2xl border border-dashed bg-background/70 p-5 text-center text-sm text-muted-foreground">
              لا توجد حالات من هذا النوع لهذا الامتحان.
            </p>
          ) : (
            <>
              {totalCount > notes.length && !activeCategory && (
                <p className="mb-3 rounded-xl border border-info-line bg-info-soft px-3 py-2 text-xs text-info">
                  يعرض السجل أحدث {notes.length} حالة من أصل {totalCount}. استخدم
                  بطاقات الملخص لمعرفة العدد الكامل.
                </p>
              )}
              <ul className="space-y-3" aria-label="سجل الدرجات الذكية">
                {visibleNotes.map((note) => {
                const meta = CATEGORY_META[note.category];
                return (
                  <li
                    key={note.id}
                    className="rounded-2xl border bg-background/90 p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="break-words font-black">
                          {note.studentNameSnapshot}
                        </p>
                        <Badge variant="outline" className="shrink-0">
                          {note.studentCodeSnapshot || "بدون كود"}
                        </Badge>
                        <Badge
                          variant={STATUS_VARIANTS[note.status]}
                          className="shrink-0"
                        >
                          {STATUS_LABELS[note.status]}
                        </Badge>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Badge className="text-sm tabular-nums">
                          الدرجة: {note.score ?? "—"}
                        </Badge>
                        <Badge variant="outline">{meta.shortTitle}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatSmartNoteTime(note.attemptedAt || note.createdAt)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                        {note.attemptedByName || "مستخدم النظام"}
                      </span>
                    </div>
                    {note.resolution && note.status !== "PENDING" ? (
                      <p className="mt-2 break-words rounded-xl bg-muted/45 px-3 py-2 text-xs font-medium leading-5 [overflow-wrap:anywhere]">
                        {note.resolution}
                      </p>
                    ) : null}
                  </li>
                );
                })}
              </ul>
              {filteredNotes.length > DEFAULT_VISIBLE_NOTES_COUNT && (
                <div className="mt-4 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAllNotes((current) => !current)}
                    aria-expanded={showAllNotes}
                  >
                    {showAllNotes
                      ? "عرض أقل"
                      : `إظهار الكل (${filteredNotes.length})`}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

      </CardContent>
    </Card>
  );
}
