"use client";

import { useEffect, useState } from "react";
import { Handshake, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { loadPledgeList, type PledgeListResponse } from "@/lib/pledge-list-client";
import { PLEDGE_LIMIT_PER_CHAPTER, PLEDGE_LIMIT_REACHED_REASON, pledgeRemainingBadge } from "@/lib/pledge-limit";
import { useTeacherStore } from "@/lib/teacher-store";
import { useShallow } from "zustand/react/shallow";
import { pledgeDateLabel } from "./pledge-chip";
import { EmptyState, ErrorState, LoadingState } from "./ui-kit";
import "./tp-modal.css";
import "./pledge-list-dialog.css";

type Chapter = "active" | "all";
type Sort = "count" | "last" | "name";

const STATUS_TONE: Record<string, string> = { "نشط": "success", "مفصول": "danger", "مؤرشف": "muted" };

function SelectField({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="tp-modal__field">
      <span>{label}</span>
      <div className="tp-modal__select-wrap" data-plain="true">
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
      </div>
    </label>
  );
}

/**
 * «قائمة التعهدات»: every student who pledged, one row per chapter, with the
 * count, what is left of the limit, each pledge's date and who recorded it,
 * and whether «إرجاع الطالب» is closed for him. With its own button in
 * «إدارة الفرص» and «إدارة المفصولين»; «تعهدات» in «الوصول السريع» passes
 * open/onOpenChange and draws no button.
 */
export function PledgeListDialog({ courseName, open: controlledOpen, onOpenChange }: {
  courseName: (courseId: string) => string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { courses } = useTeacherStore(useShallow((state) => ({ courses: state.courses })));
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [courseId, setCourseId] = useState("");
  const [chapter, setChapter] = useState<Chapter>("active");
  const [count, setCount] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<Sort>("count");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 350);
  const [data, setData] = useState<PledgeListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadPledgeList({ courseIds: courseId, chapter, count, status, q, sort }, controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "تعذر تحميل قائمة التعهدات.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, courseId, chapter, count, status, q, sort, reloadKey]);

  return (
    <>
      {!controlled && (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <Handshake aria-hidden="true" />
          قائمة التعهدات
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="tp-modal tp-pledges" dir="rtl">
          <div className="tp-modal__hero">
            <span className="tp-modal__hero-icon" aria-hidden="true"><Handshake /></span>
            <DialogHeader className="tp-modal__heading">
              <DialogTitle>قائمة التعهدات</DialogTitle>
              <DialogDescription>
                الحد {PLEDGE_LIMIT_PER_CHAPTER} تعهدات بالفصل الواحد. بعدها يتقفل «إرجاع الطالب» بإدارة المفصولين لحد الفصل الجاي.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="tp-modal__body">
            <section className="tp-modal__panel tp-pledges__controls" aria-label="فلترة قائمة التعهدات">
              <div className="tp-modal__input-wrap">
                <Search aria-hidden="true" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ابحث بالاسم أو الكود"
                  aria-label="بحث في قائمة التعهدات"
                  autoComplete="off"
                />
              </div>
              <div className="tp-pledges__fields">
                <SelectField label="الدورة" value={courseId} onChange={setCourseId}>
                  <option value="">كل الدورات</option>
                  {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                </SelectField>
                <SelectField label="الفصل" value={chapter} onChange={(value) => setChapter(value as Chapter)}>
                  <option value="active">الفصل الحالي</option>
                  <option value="all">كل الفصول</option>
                </SelectField>
                <SelectField label="عدد التعهدات" value={count} onChange={setCount}>
                  <option value="">الكل</option>
                  <option value="1">تعهد واحد · باقيله 1</option>
                  <option value="2">تعهدين · باقيله 0</option>
                  <option value="limit">نفد الحد ({PLEDGE_LIMIT_PER_CHAPTER} فأكثر)</option>
                </SelectField>
                <SelectField label="الحالة" value={status} onChange={setStatus}>
                  <option value="">الكل</option>
                  <option value="active">نشط</option>
                  <option value="dismissed">مفصول</option>
                  <option value="archived">مؤرشف</option>
                </SelectField>
                <SelectField label="الترتيب" value={sort} onChange={(value) => setSort(value as Sort)}>
                  <option value="count">الأكثر تعهدات</option>
                  <option value="last">آخر تعهد</option>
                  <option value="name">الاسم</option>
                </SelectField>
              </div>
            </section>

            {error ? (
              <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
            ) : !data && loading ? (
              <LoadingState title="جاري تحميل التعهدات..." />
            ) : data ? (
              <div className="tp-pledges__results" aria-busy={loading} data-loading={loading || undefined}>
                <dl className="tp-pledges__stats">
                  <div><dt>طلاب</dt><dd>{data.totalStudents}</dd></div>
                  <div><dt>تعهدات</dt><dd>{data.totalPledges}</dd></div>
                  <div data-tone="success"><dt>باقيلهم تعهد</dt><dd>{data.withRemaining}</dd></div>
                  <div data-tone="danger"><dt>نفد الحد</dt><dd>{data.limitReached}</dd></div>
                </dl>
                {data.rows.length === 0 ? (
                  <EmptyState title="ماكو تعهدات مطابقة" description="غيّر الفلترة أو اختار «كل الفصول»." />
                ) : (
                  <ol className="tp-pledges__list">
                    {data.rows.map((row, index) => {
                      const badge = pledgeRemainingBadge(row);
                      return (
                      <li key={row.key} className="tp-pledges__item" data-limit={row.limitReached || undefined}>
                        <span className="tp-pledges__rank" aria-hidden="true">{index + 1}</span>
                        <div className="tp-pledges__who">
                          <span className="tp-pledges__name">{row.name}</span>
                          <span className="tp-pledges__meta">
                            <bdi dir="ltr">{row.code}</bdi>
                            <span>· {courseName(row.courseId) || "بدون دورة"}</span>
                            <span>· {row.chapterName}{row.isActiveChapter ? " (الحالي)" : ""}</span>
                            <span className="tp-pledges__status" data-tone={STATUS_TONE[row.status] || "muted"}>{row.status}</span>
                          </span>
                        </div>
                        <ul className="tp-pledges__dates" aria-label="تواريخ التعهدات">
                          {row.pledges.map((pledge, pledgeIndex) => (
                            <li key={`${pledge.date}-${pledgeIndex}`}>
                              <bdi dir="ltr">{pledgeDateLabel(pledge.date)}</bdi>
                              <small>{pledge.recordedBy || "—"}</small>
                            </li>
                          ))}
                        </ul>
                        <div className="tp-pledges__tally" title={row.limitReached && row.isActiveChapter ? PLEDGE_LIMIT_REACHED_REASON : undefined}>
                          <div className="tp-pledges__count">
                            <b dir="ltr">{row.count}/{row.limit}</b>
                            <small>استهلك</small>
                          </div>
                          <span className="tp-pledges__left" data-tone={badge.tone}>{badge.label}</span>
                        </div>
                      </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
