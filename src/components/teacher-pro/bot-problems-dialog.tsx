"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, BookOpen, Bot, CheckCheck, Loader2, Plus, RefreshCw, Search, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { botProblemsApi } from "@/lib/bot-problems-client";
import { BOT_PROBLEM_REASON_MAX, type BotProblem, type BotProblemStudent } from "@/lib/bot-problems";
import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { toast } from "@/lib/user-toast";
import { normalizeForSearch } from "@/lib/validation";
import { describeTelegramHandle } from "./student-registry-helpers";
import { EmptyState, LoadingState } from "./ui-kit";
import "./tp-modal.css";
import "./bot-problems-dialog.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Filter = "current" | "resolved";

const FILTERS: Array<{ key: Filter; label: string; tone: "warning" | "success" }> = [
  { key: "current", label: "مشاكل حالية", tone: "warning" },
  { key: "resolved", label: "مشاكل تم حلها", tone: "success" },
];

/**
 * «مشاكل البوت»: a notebook of Telegram-bot problems. Each problem is one
 * student and a reason typed by hand, dated when it is saved. Ticking it moves
 * it from the current problems to the solved ones; unticking brings it back.
 * Nothing here is shown anywhere else in the system.
 */
export function BotProblemsDialog({ open, onOpenChange }: Props) {
  const [problems, setProblems] = useState<BotProblem[]>([]);
  const [filter, setFilter] = useState<Filter>("current");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const requestRef = useRef<AbortController | null>(null);

  // «إضافة مشكلة»
  const [adding, setAdding] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");
  const debouncedStudentQuery = useDebouncedValue(studentQuery.trim(), 300);
  const [studentResults, setStudentResults] = useState<BotProblemStudent[]>([]);
  const [studentSearching, setStudentSearching] = useState(false);
  const [studentSearchError, setStudentSearchError] = useState("");
  const [student, setStudent] = useState<BotProblemStudent | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const result = await botProblemsApi.list(controller.signal);
      if (controller.signal.aborted) return;
      setProblems(result.problems);
      setLoaded(true);
      setError("");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "تعذر تحميل مشاكل البوت. أعد المحاولة.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  const resetAdd = () => {
    setStudentQuery("");
    setStudentResults([]);
    setStudentSearchError("");
    setStudent(null);
    setReason("");
  };

  useEffect(() => {
    setFilter("current");
    setSearch("");
    setAdding(false);
    resetAdd();
    if (!open) {
      requestRef.current?.abort();
      return;
    }
    void refresh();
  }, [open, refresh]);

  // The whole system's students, any status, for the problem being added.
  useEffect(() => {
    if (!adding || student || debouncedStudentQuery.length < 2) {
      setStudentResults([]);
      setStudentSearching(false);
      setStudentSearchError("");
      return;
    }
    const controller = new AbortController();
    setStudentSearching(true);
    botProblemsApi.searchStudents(debouncedStudentQuery, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setStudentResults(result.students);
        setStudentSearchError("");
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setStudentResults([]);
        setStudentSearchError(cause instanceof Error ? cause.message : "تعذر البحث عن الطالب.");
      },
    ).finally(() => {
      if (!controller.signal.aborted) setStudentSearching(false);
    });
    return () => controller.abort();
  }, [adding, student, debouncedStudentQuery]);

  async function save() {
    const text = reason.replace(/\s+/g, " ").trim();
    if (!student || !text || saving) return;
    setSaving(true);
    try {
      const { problem } = await botProblemsApi.add(student.id, text);
      setProblems((current) => [problem, ...current.filter((item) => item.id !== problem.id)]);
      setFilter("current");
      setAdding(false);
      resetAdd();
      toast.success(`انحفظت مشكلة ${problem.student.name}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "تعذر حفظ المشكلة. أعد المحاولة.");
    } finally {
      setSaving(false);
    }
  }

  async function setResolved(problem: BotProblem, resolved: boolean) {
    if (pendingIds.has(problem.id) || Boolean(problem.resolvedAt) === resolved) return;
    setPendingIds((current) => new Set(current).add(problem.id));
    // Moves at once; the saved row replaces it when the server answers.
    setProblems((current) => current.map((item) => item.id === problem.id
      ? { ...item, resolvedAt: resolved ? new Date().toISOString() : null }
      : item));
    try {
      const { problem: saved } = await botProblemsApi.setResolved(problem.id, resolved);
      setProblems((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch (cause) {
      setProblems((current) => current.map((item) => item.id === problem.id ? problem : item));
      toast.error(cause instanceof Error ? cause.message : "تعذر تحديث المشكلة. أعد المحاولة.");
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(problem.id);
        return next;
      });
    }
  }

  const query = normalizeForSearch(search);
  const matching = problems.filter((problem) => !query || normalizeForSearch(
    `${problem.student.name} ${problem.student.code} ${problem.student.username} ${problem.student.telegram} ${problem.reason}`,
  ).includes(query));
  const counts = {
    current: matching.filter((problem) => !problem.resolvedAt).length,
    resolved: matching.filter((problem) => problem.resolvedAt).length,
  };
  const visible = matching.filter((problem) => (filter === "current" ? !problem.resolvedAt : Boolean(problem.resolvedAt)));
  const reasonText = reason.replace(/\s+/g, " ").trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tp-modal tp-bot-problems" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><Bot /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>مشاكل البوت</DialogTitle>
          </DialogHeader>
        </div>

        <div className="tp-modal__body">
          <div className="tp-modal__searchbar">
            <div className="tp-modal__input-wrap tp-modal__search">
              <Search aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="بحث في مشاكل البوت"
                placeholder="ابحث بالاسم أو الكود أو سبب المشكلة"
              />
            </div>
            <Button
              type="button"
              aria-expanded={adding}
              onClick={() => {
                setAdding((value) => !value);
                resetAdd();
              }}
            >
              {adding ? <X className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
              {adding ? "إلغاء الإضافة" : "إضافة مشكلة"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="تحديث مشاكل البوت"
              title="تحديث"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            </Button>
          </div>

          {adding && (
            <section className="tp-modal__panel tp-bot-add" aria-label="إضافة مشكلة">
              <div className="tp-modal__field">
                <span className="tp-bot-add__label">الطالب</span>
                {student ? (
                  <div className="tp-bot-add__chosen">
                    <span className="tp-bot-add__chosen-text">
                      <b>{student.name}</b>
                      <span>
                        <bdi>{student.code}</bdi>
                        {student.courseName ? ` · ${student.courseName}` : ""}
                        {student.status !== "نشط" ? ` · ${student.status}` : ""}
                      </span>
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setStudent(null); setStudentQuery(""); }}>
                      تغيير
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="tp-modal__input-wrap tp-modal__search">
                      <Search aria-hidden="true" />
                      <Input
                        autoFocus
                        value={studentQuery}
                        onChange={(event) => setStudentQuery(event.target.value)}
                        aria-label="ابحث عن الطالب"
                        placeholder="اكتب اسم الطالب أو الكود أو اليوزر"
                      />
                    </div>
                    {studentSearching && (
                      <p role="status" className="tp-modal__status">
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />جاري البحث…
                      </p>
                    )}
                    {studentSearchError && <p role="alert" className="tp-modal__note" data-tone="danger">{studentSearchError}</p>}
                    {!studentSearching && debouncedStudentQuery.length >= 2 && studentResults.length === 0 && !studentSearchError && (
                      <p className="tp-modal__muted">ماكو طالب بهذا الاسم.</p>
                    )}
                    {studentResults.length > 0 && (
                      <ul className="tp-bot-add__results" aria-label="نتائج البحث">
                        {studentResults.map((result) => (
                          <li key={result.id}>
                            <button type="button" className="tp-bot-add__result" onClick={() => setStudent(result)}>
                              <b>{result.name}</b>
                              <span>
                                <bdi>{result.code}</bdi>
                                {result.courseName ? ` · ${result.courseName}` : ""}
                                {result.status !== "نشط" ? ` · ${result.status}` : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <label className="tp-modal__field">
                <span className="tp-bot-add__label">سبب المشكلة</span>
                <textarea
                  className="tp-bot-add__reason"
                  value={reason}
                  maxLength={BOT_PROBLEM_REASON_MAX}
                  rows={3}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="اكتب شنو المشكلة ويه البوت"
                />
              </label>

              <div className="tp-modal__actions">
                <Button type="button" disabled={!student || !reasonText || saving} onClick={() => void save()}>
                  {saving ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                  {saving ? "جاري الحفظ…" : "حفظ"}
                </Button>
                <Button type="button" variant="ghost" disabled={saving} onClick={() => { setAdding(false); resetAdd(); }}>
                  إلغاء
                </Button>
              </div>
            </section>
          )}

          <div role="group" aria-label="حالة المشكلة" className="tp-modal__chips">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="tp-modal__filter"
                data-tone={option.tone}
                aria-pressed={filter === option.key}
                onClick={() => setFilter(option.key)}
              >
                <span className="tp-modal__filter-dot" aria-hidden="true" />
                <span className="tp-modal__filter-label">{option.label}</span>
                <span className="tp-modal__filter-count">{loaded ? counts[option.key] : "…"}</span>
              </button>
            ))}
          </div>

          <div className="tp-modal__toolbar">
            <span className="tp-modal__count" aria-live="polite">
              {loaded ? `المعروض ${visible.length} من ${counts.current + counts.resolved} مشكلة · الأحدث أولاً` : "مشاكل البوت"}
            </span>
          </div>

          {error && <div role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" /><p>{error}</p></div>}

          <section className="tp-modal__section" aria-label={filter === "current" ? "مشاكل حالية" : "مشاكل تم حلها"}>
            {!loaded && loading ? (
              <LoadingState title="جاري تحميل مشاكل البوت…" />
            ) : loaded && visible.length === 0 ? (
              <EmptyState
                icon={query ? Search : CheckCheck}
                title={query
                  ? "ماكو مشاكل تطابق البحث"
                  : filter === "current" ? "ماكو مشاكل حالية" : "ماكو مشاكل محلولة بعد"}
              />
            ) : (
              <ul className="tp-modal__cards tp-bot-problems__list" data-columns="1">
                {visible.map((problem) => {
                  const resolved = Boolean(problem.resolvedAt);
                  const busy = pendingIds.has(problem.id);
                  const telegram = describeTelegramHandle(problem.student);
                  return (
                    <li key={problem.id} className="tp-bot-problem" data-resolved={resolved}>
                      <div className="tp-bot-problem__main">
                        <div className="tp-bot-problem__head">
                          <b className="tp-bot-problem__name">{problem.student.name}</b>
                          <bdi className="tp-modal__code">{problem.student.code}</bdi>
                          {problem.student.courseName ? (
                            <span className="tp-bot-problem__course"><BookOpen aria-hidden="true" />{problem.student.courseName}</span>
                          ) : null}
                          {problem.student.status !== "نشط" ? (
                            <span className="tp-modal__chip" data-tone={problem.student.status === "مفصول" ? "danger" : "outline"}>
                              {problem.student.status}
                            </span>
                          ) : null}
                          {telegram.value ? (
                            telegram.href ? (
                              <a className="tp-modal__tg" href={telegram.href} target="_blank" rel="noopener noreferrer" dir="ltr">
                                <Send aria-hidden="true" />@{telegram.value}
                              </a>
                            ) : (
                              <span className="tp-modal__tg" data-plain="true" dir="ltr"><Send aria-hidden="true" />{telegram.value}</span>
                            )
                          ) : null}
                        </div>
                        <p className="tp-bot-problem__reason">{problem.reason}</p>
                        <p className="tp-bot-problem__meta">
                          <time dateTime={problem.createdAt}>{formatBaghdadDateTime(problem.createdAt)}</time>
                          {problem.createdByName ? ` · ${problem.createdByName}` : ""}
                          {resolved && problem.resolvedAt ? (
                            <>
                              {" — انحلت "}
                              <time dateTime={problem.resolvedAt}>{formatBaghdadDateTime(problem.resolvedAt)}</time>
                              {problem.resolvedByName ? ` · ${problem.resolvedByName}` : ""}
                            </>
                          ) : null}
                        </p>
                      </div>
                      <label className="tp-bot-problem__done" data-checked={resolved} data-busy={busy || undefined}>
                        <Checkbox
                          checked={resolved}
                          disabled={busy}
                          onCheckedChange={(checked) => { if (typeof checked === "boolean") void setResolved(problem, checked); }}
                          aria-label={`${resolved ? "إرجاع مشكلة" : "تم حل مشكلة"} ${problem.student.name}`}
                          className="size-6"
                        />
                        <span>{busy ? "جاري الحفظ…" : resolved ? "انحلت" : "تم الحل"}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
