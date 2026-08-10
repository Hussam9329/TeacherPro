"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileWarning,
  RefreshCw,
  ShieldAlert,
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
      "border-rose-200 bg-rose-50/80 text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-100",
    icon: UserRoundX,
  },
  GRACE_SCORED: {
    title: "درجات ضمن فترة السماح",
    shortTitle: "ضمن فترة السماح",
    decision: "محفوظة للمتابعة فقط، ولا تخصم فرصة ولا تسبب فصلاً.",
    className:
      "border-sky-200 bg-sky-50/80 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-100",
    icon: CheckCircle2,
  },
  BEFORE_REGISTRATION_PENDING: {
    title: "درجات قبل تسجيل الطالب معلّقة",
    shortTitle: "قبل تسجيل الطالب",
    decision: "لم تُسجّل كدرجة لأنها تسبق تسجيل الطالب؛ حُفظت للمراجعة فقط.",
    className:
      "border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100",
    icon: CalendarClock,
  },
  LEAVE_PENDING: {
    title: "درجات طلاب مجازين معلّقة",
    shortTitle: "الطالب مجاز",
    decision: "لم تُسجّل كدرجة لأن الطالب مجاز؛ حُفظت للمراجعة فقط.",
    className:
      "border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-100",
    icon: FileWarning,
  },
};

const STATUS_LABELS: Record<GradeSmartNoteStatus, string> = {
  PENDING: "درجة معلّقة",
  PROCESSED: "محفوظة دون احتساب",
  CONFLICT: "تحتاج معالجة تعارض",
  REJECTED: "مرفوضة بعد المراجعة",
};

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
  const visibleNotes = useMemo(
    () =>
      activeCategory
        ? notes.filter((note) => note.category === activeCategory)
        : notes,
    [activeCategory, notes],
  );

  return (
    <Card
      className="overflow-hidden border-violet-200/80 bg-gradient-to-b from-violet-50/55 to-background dark:border-violet-900/60 dark:from-violet-950/20"
      aria-labelledby="grade-smart-notes-title"
    >
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle id="grade-smart-notes-title" className="text-lg">
              لوحة الدرجات الذكية لهذا الامتحان
            </CardTitle>
            <p className="mt-1 max-w-3xl text-xs leading-6 text-muted-foreground">
              تعرض المحاولات التي حفظها النظام للمراجعة، والدرجات المحفوظة دون
              أثر أكاديمي. الدرجة المعلّقة ليست درجة معتمدة ولا تخصم فرصة.
            </p>
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
                    setActiveCategory((current) =>
                      current === category ? null : category,
                    )
                  }
                  aria-pressed={selected}
                  className={`rounded-2xl border p-4 text-start transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${meta.className} ${selected ? "ring-2 ring-violet-500 ring-offset-2 ring-offset-background" : ""}`}
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
            <div>
              <h3 id="smart-notes-list-title" className="text-sm font-black">
                السجل المنظّم
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeCategory
                  ? `عرض: ${CATEGORY_META[activeCategory].title}`
                  : "عرض كل حالات هذا الامتحان"}
              </p>
            </div>
            {activeCategory && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setActiveCategory(null)}
              >
                عرض الكل
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
          ) : visibleNotes.length === 0 ? (
            <p className="rounded-2xl border border-dashed bg-background/70 p-5 text-center text-sm text-muted-foreground">
              لا توجد حالات من هذا النوع لهذا الامتحان.
            </p>
          ) : (
            <>
              {totalCount > notes.length && !activeCategory && (
                <p className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100">
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
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black">{note.studentNameSnapshot}</p>
                          <Badge variant="outline">
                            {note.studentCodeSnapshot || "بدون كود"}
                          </Badge>
                          <Badge
                            variant={
                              note.status === "PENDING"
                                ? "secondary"
                                : note.status === "REJECTED"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {STATUS_LABELS[note.status]}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs leading-6 text-muted-foreground">
                          {note.reason || meta.decision}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Badge className="text-sm tabular-nums">
                          الدرجة المدخلة: {note.score ?? "—"}
                        </Badge>
                        <Badge variant="outline">{meta.shortTitle}</Badge>
                      </div>
                    </div>

                    <dl className="mt-3 grid grid-cols-1 gap-2 rounded-xl bg-muted/45 p-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">قرار النظام</dt>
                        <dd className="mt-1 font-semibold leading-5">
                          {meta.decision}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">وقت الإدخال</dt>
                        <dd className="mt-1 flex items-center gap-1 font-semibold tabular-nums">
                          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                          {formatSmartNoteTime(note.attemptedAt || note.createdAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">مدخل الدرجة</dt>
                        <dd className="mt-1 font-semibold">
                          {note.attemptedByName || "مستخدم النظام"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">نتيجة المراجعة</dt>
                        <dd className="mt-1 font-semibold">
                          {note.resolution || STATUS_LABELS[note.status]}
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
                })}
              </ul>
            </>
          )}
        </section>

      </CardContent>
    </Card>
  );
}
