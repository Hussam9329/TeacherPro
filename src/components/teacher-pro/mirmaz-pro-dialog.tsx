"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BookOpen, CalendarDays, CheckCheck, ClipboardCheck, Inbox, Loader2, RefreshCw, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  MirmazHoldError,
  mirmazHoldsApi,
  type MirmazExamOption,
  type MirmazHold,
  type MirmazHoldsResponse,
  type MirmazLedgerGroup,
  type MirmazLedgerResponse,
  type MirmazLedgerRow,
  type MirmazStudentOption,
  type MirmazView,
} from "@/lib/mirmaz-holds-client";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { normalizeForSearch } from "@/lib/validation";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { formatAppDate } from "@/lib/format";
import { EmptyState, LoadingState } from "./ui-kit";
import "./tp-modal.css";
import "./mirmaz-pro-dialog.css";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

const VIEWS: Array<{ key: MirmazView; label: string; tone?: "warning" | "success" }> = [
  { key: "ALL", label: "كل الدرجات" },
  { key: "PENDING", label: "بانتظار المعالجة", tone: "warning" },
  { key: "RESOLVED", label: "انحفظت يدوياً", tone: "success" },
  { key: "REJECTED", label: "متروكة" },
];

const INTRO: Record<MirmazView, string> = {
  ALL: "كل درجة وصلت من Mirmaz Pro، حسب الامتحان، وويا حالتها: انحفظت لحالها، انحفظت يدوياً، تنتظر، أو انتركت.",
  PENDING: "درجات انصححت بـMirmaz Pro وما انحفظت لحالها، لأن اسم الطالب أو الامتحان ما طابق واحد أكيد. اختر الطالب والامتحان واحفظ.",
  RESOLVED: "درجات انحفظت من هنا يدوياً بعد ما انتظرت.",
  REJECTED: "درجات انتركت من هنا وما انحفظت.",
};

/**
 * «مرماز برو»: every grade that came from Mirmaz Pro, grouped by exam
 * («كل الدرجات»), and the ones that did not place themselves in TeacherPro
 * (the student's name or the exam did not match exactly one). Each of those
 * is placed here by choosing the student and the exam; saving goes through
 * the grade entry screen as the signed-in user.
 */
export function MirmazProDialog({ open, onOpenChange }: Props) {
  const [view, setView] = useState<MirmazView>("ALL");
  const [data, setData] = useState<MirmazHoldsResponse | null>(null);
  const [ledger, setLedger] = useState<MirmazLedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (which: MirmazView) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      if (which === "ALL") {
        const result = await mirmazHoldsApi.all(controller.signal);
        if (controller.signal.aborted) return;
        setLedger(result);
        setData(null);
      } else {
        const result = await mirmazHoldsApi.list(which, controller.signal);
        if (controller.signal.aborted) return;
        setData(result);
        setLedger(null);
      }
      setError("");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setData(null);
      setLedger(null);
      setError(cause instanceof Error ? cause.message : "تعذر تحميل «مرماز برو». أعد المحاولة.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (open) void load(view);
    else {
      requestRef.current?.abort();
      setData(null);
      setLedger(null);
      setSearch("");
    }
  }, [open, view, load]);

  const visible = useMemo(() => {
    const query = normalizeForSearch(search);
    const holds = data?.holds || [];
    return query ? holds.filter((hold) => normalizeForSearch(`${hold.studentName} ${hold.examName}`).includes(query)) : holds;
  }, [data, search]);

  // «كل الدرجات»: a group shows when its exam matches, else only its matching students.
  const visibleGroups = useMemo(() => {
    const query = normalizeForSearch(search);
    const groups = ledger?.groups || [];
    if (!query) return groups;
    return groups.flatMap((group) => {
      if (normalizeForSearch(group.title).includes(query)) return [group];
      const rows = group.rows.filter((row) => normalizeForSearch(`${row.studentName} ${row.tpStudentName || ""}`).includes(query));
      return rows.length ? [{ ...group, rows }] : [];
    });
  }, [ledger, search]);

  const counts = view === "ALL" ? ledger?.counts : data?.counts;
  const loaded = view === "ALL" ? Boolean(ledger) : Boolean(data);
  const empty = view === "ALL" ? visibleGroups.length === 0 : visible.length === 0;

  function handled(message: string) {
    toast.success(message);
    emitTeacherProDataChanged({ source: "local-mutation", reason: "معالجة درجة من مرماز برو", scopes: ["grades", "students", "dashboard", "logs"] });
    void load(view);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tp-modal tp-mirmaz" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><ClipboardCheck /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>مرماز برو</DialogTitle>
          </DialogHeader>
        </div>

        <div className="tp-modal__body">
          <div className="tp-modal__searchbar">
            <div className="tp-modal__input-wrap tp-modal__search">
              <Search aria-hidden="true" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="بحث في مرماز برو" placeholder="ابحث باسم الطالب أو الامتحان" />
            </div>
            <Button type="button" variant="outline" size="icon" aria-label="تحديث مرماز برو" title="تحديث" disabled={loading} onClick={() => void load(view)}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            </Button>
          </div>

          <div role="group" aria-label="حالة الدرجات" className="tp-modal__chips">
            {VIEWS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="tp-modal__filter"
                data-tone={option.tone}
                aria-pressed={view === option.key}
                onClick={() => setView(option.key)}
              >
                {option.tone && <span className="tp-modal__filter-dot" aria-hidden="true" />}
                <span className="tp-modal__filter-label">{option.label}</span>
                <span className="tp-modal__filter-count">{counts ? counts[option.key] ?? 0 : "…"}</span>
              </button>
            ))}
          </div>

          <p className="tp-modal__muted tp-mirmaz__intro">{INTRO[view]}</p>

          {error && <div role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" /><p>{error}</p></div>}

          <section className="tp-modal__section" aria-label="الدرجات">
            {!loaded && loading ? (
              <LoadingState title="جاري التحميل..." />
            ) : loaded && empty ? (
              <EmptyState
                icon={search.trim() ? Search : view === "PENDING" ? CheckCheck : Inbox}
                title={search.trim() ? "ماكو نتائج للبحث" : view === "PENDING" ? "ماكو درجات بانتظار المعالجة" : view === "ALL" ? "ما وصلت درجات من مرماز بعد" : "ماكو شي هنا"}
              />
            ) : view === "ALL" ? (
              <div className="tp-mirmaz__groups">
                {visibleGroups.map((group, index) => (
                  <LedgerGroup key={group.key} group={group} openAtStart={index === 0 || Boolean(search.trim())} onHandle={() => setView("PENDING")} />
                ))}
              </div>
            ) : (
              <div className="tp-modal__cards" data-columns="1">
                {visible.map((hold) => (
                  view === "PENDING"
                    ? <HoldCard key={`${hold.id}:${hold.score}:${hold.reason}`} hold={hold} onHandled={handled} />
                    : <DoneCard key={hold.id} hold={hold} />
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function matchLabel(option: MirmazStudentOption): string {
  return option.full ? "الاسم مطابق" : `تشابه بالاسم ${option.matched} من ${option.of}`;
}

function HoldHeader({ hold }: { hold: MirmazHold }) {
  return (
    <header className="tp-mirmaz__head">
      <span className="tp-mirmaz__avatar" aria-hidden="true"><UserRound /></span>
      <span className="tp-mirmaz__who">
        <b className="tp-mirmaz__name">{hold.studentName}</b>
        <span className="tp-mirmaz__meta">
          <span><BookOpen aria-hidden="true" />{hold.examName}</span>
          {hold.examDate && <span><CalendarDays aria-hidden="true" />{formatAppDate(hold.examDate, hold.examDate)}</span>}
          {hold.correctedBy && <span>صححها: {hold.correctedBy}</span>}
        </span>
      </span>
      <span className="tp-mirmaz__score" dir="ltr">{hold.score}{hold.examFullMark ? ` / ${hold.examFullMark}` : ""}</span>
    </header>
  );
}

function HoldCard({ hold, onHandled }: { hold: MirmazHold; onHandled: (message: string) => void }) {
  const fullOnes = hold.candidates.filter((option) => option.full);
  const [students, setStudents] = useState<MirmazStudentOption[]>(hold.candidates);
  const [exams, setExams] = useState<MirmazExamOption[]>(hold.examCandidates);
  const [studentId, setStudentId] = useState(fullOnes.length === 1 ? fullOnes[0].id : "");
  const [examId, setExamId] = useState(hold.examCandidates.length === 1 ? hold.examCandidates[0].id : "");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "reject" | "search" | "exams">("");
  const [problem, setProblem] = useState("");
  const [replaceAsk, setReplaceAsk] = useState("");

  async function findStudents() {
    if (query.trim().length < 2) return;
    setBusy("search");
    setProblem("");
    try {
      const found = await mirmazHoldsApi.searchStudents(query.trim());
      setStudents(found);
      if (!found.some((option) => option.id === studentId)) setStudentId("");
      if (!found.length) setProblem("ماكو طالب بهذا الاسم.");
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "تعذر البحث عن الطالب.");
    } finally {
      setBusy("");
    }
  }

  async function nearbyExams() {
    if (!hold.examDate) return;
    setBusy("exams");
    setProblem("");
    try {
      const found = await mirmazHoldsApi.examsNear(hold.examDate, hold.examFullMark);
      setExams(found);
      if (!found.some((option) => option.id === examId)) setExamId("");
      if (!found.length) setProblem("ماكو امتحانات قريبة من هذا اليوم بنفس الدرجة الكاملة.");
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "تعذر تحميل الامتحانات.");
    } finally {
      setBusy("");
    }
  }

  async function save(confirmReplace = false) {
    setBusy("save");
    setProblem("");
    try {
      const saved = await mirmazHoldsApi.resolve(hold.id, studentId, examId, confirmReplace);
      onHandled(saved.stored === "pending_note"
        ? `انحفظت كملاحظة معلّقة لـ ${String(saved.studentName)} (حسب قواعد TeacherPro).`
        : `انحفظت درجة ${String(saved.studentName)} بـ ${String(saved.examName)}.`);
    } catch (cause) {
      if (cause instanceof MirmazHoldError && cause.code === "CONFIRM_REPLACE") setReplaceAsk(cause.message);
      else setProblem(cause instanceof Error ? cause.message : "تعذر حفظ الدرجة.");
      setBusy("");
    }
  }

  async function reject() {
    setBusy("reject");
    setProblem("");
    try {
      await mirmazHoldsApi.reject(hold.id);
      onHandled(`انتركت درجة ${hold.studentName}.`);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "تعذر ترك الدرجة.");
      setBusy("");
    }
  }

  const locked = Boolean(busy);
  return (
    <article className="tp-modal__card tp-mirmaz__card" data-tone="warning">
      <HoldHeader hold={hold} />
      <p className="tp-mirmaz__reason"><AlertCircle aria-hidden="true" />{hold.reasonText}</p>

      <fieldset className="tp-mirmaz__pick" disabled={locked}>
        <legend>الطالب</legend>
        {students.length > 0 ? (
          <div className="tp-mirmaz__options">
            {students.map((option) => (
              <label key={option.id} className="tp-mirmaz__option" data-chosen={studentId === option.id}>
                <input type="radio" name={`student-${hold.id}`} checked={studentId === option.id} onChange={() => setStudentId(option.id)} />
                <span className="tp-mirmaz__option-main">
                  <b>{option.name}</b>
                  <small>{[option.course || "دورة غير معروفة", option.code].filter(Boolean).join(" · ")}</small>
                </span>
                <em data-full={option.full}>{matchLabel(option)}</em>
              </label>
            ))}
          </div>
        ) : (
          <p className="tp-modal__muted">ماكو طلاب مقترحين؛ ابحث بالاسم.</p>
        )}
        <div className="tp-mirmaz__search">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findStudents(); } }}
            aria-label={`بحث عن طالب آخر بدل ${hold.studentName}`}
            placeholder="ابحث عن طالب آخر بالاسم أو الكود"
          />
          <Button type="button" variant="outline" onClick={() => void findStudents()} disabled={query.trim().length < 2}>
            {busy === "search" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
            بحث
          </Button>
        </div>
      </fieldset>

      <fieldset className="tp-mirmaz__pick" disabled={locked}>
        <legend>الامتحان</legend>
        {exams.length > 0 ? (
          <div className="tp-mirmaz__options">
            {exams.map((option) => (
              <label key={option.id} className="tp-mirmaz__option" data-chosen={examId === option.id}>
                <input type="radio" name={`exam-${hold.id}`} checked={examId === option.id} onChange={() => setExamId(option.id)} />
                <span className="tp-mirmaz__option-main">
                  <b>{option.name}</b>
                  <small>{formatAppDate(option.date, option.date)} · من {option.fullMark}</small>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="tp-modal__muted">ماكو امتحان مقترح.</p>
        )}
        {hold.examDate && (
          <Button type="button" variant="ghost" size="sm" className="tp-mirmaz__more" onClick={() => void nearbyExams()}>
            {busy === "exams" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CalendarDays className="size-4" aria-hidden="true" />}
            امتحانات أسبوع حول {formatAppDate(hold.examDate, hold.examDate)}
          </Button>
        )}
      </fieldset>

      {problem && <div role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" /><p>{problem}</p></div>}
      {replaceAsk && (
        <div role="alert" className="tp-mirmaz__replace">
          <p>{replaceAsk}</p>
          <div>
            <Button type="button" variant="destructive" size="sm" disabled={locked} onClick={() => void save(true)}>تأكيد الاستبدال</Button>
            <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => setReplaceAsk("")}>إلغاء</Button>
          </div>
        </div>
      )}

      <div className="tp-modal__card-foot tp-mirmaz__actions">
        <Button type="button" onClick={() => void save(false)} disabled={locked || !studentId || !examId || Boolean(replaceAsk)}>
          {busy === "save" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCheck className="size-4" aria-hidden="true" />}
          حفظ الدرجة
        </Button>
        <Button type="button" variant="ghost" onClick={() => void reject()} disabled={locked}>
          {busy === "reject" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <X className="size-4" aria-hidden="true" />}
          ترك
        </Button>
        <span className="tp-mirmaz__when">وصلت {formatAppDate(baghdadDateKey(hold.createdAt), "")}</span>
      </div>
    </article>
  );
}

const STATE: Record<MirmazLedgerRow["status"], { label: string; tone?: "success" | "warning" }> = {
  SAVED: { label: "انحفظت تلقائياً", tone: "success" },
  RESOLVED: { label: "انحفظت يدوياً", tone: "success" },
  PENDING: { label: "بانتظار المعالجة", tone: "warning" },
  REJECTED: { label: "متروكة" },
};

// One exam of «كل الدرجات»: its name, date and how many grades, then its students.
function LedgerGroup({ group, openAtStart, onHandle }: { group: MirmazLedgerGroup; openAtStart: boolean; onHandle: () => void }) {
  const waiting = group.rows.filter((row) => row.status === "PENDING").length;
  return (
    <details className="tp-mirmaz__group" open={openAtStart}>
      <summary className="tp-mirmaz__group-head">
        <span className="tp-mirmaz__group-title">
          <BookOpen aria-hidden="true" />
          <b>{group.title}</b>
          {!group.placed && <em>بمرماز، مو مربوط بامتحان بعد</em>}
        </span>
        <span className="tp-mirmaz__group-meta">
          {group.date && <span><CalendarDays aria-hidden="true" />{formatAppDate(group.date, group.date)}</span>}
          <span>{group.rows.length} درجة</span>
          {waiting > 0 && <span className="tp-mirmaz__group-waiting">{waiting} تنتظر</span>}
        </span>
      </summary>
      <ul className="tp-mirmaz__rows">
        {group.rows.map((row) => <LedgerRowItem key={row.answerId} row={row} onHandle={onHandle} />)}
      </ul>
    </details>
  );
}

function LedgerRowItem({ row, onHandle }: { row: MirmazLedgerRow; onHandle: () => void }) {
  const state = STATE[row.status] ?? { label: row.status };
  const name = row.tpStudentName || row.studentName || "—";
  const changed = row.current && (row.current.status !== "درجة" || row.current.score !== row.score);
  return (
    <li className="tp-mirmaz__row" data-tone={state.tone}>
      <span className="tp-mirmaz__row-main">
        <b>{name}</b>
        <small>
          {row.tpStudentName && row.studentName && normalizeForSearch(row.studentName) !== normalizeForSearch(row.tpStudentName) && <span>بمرماز: {row.studentName}</span>}
          {row.correctedBy && <span>صححها: {row.correctedBy}</span>}
          <span>{formatAppDate(baghdadDateKey(row.at), "")}</span>
        </small>
        {row.note && <small className="tp-mirmaz__row-note">{row.note}</small>}
        {changed && (
          <small className="tp-mirmaz__row-changed">
            بـTeacherPro هسه: {row.current!.score !== null ? row.current!.score : `«${row.current!.status}»`}
          </small>
        )}
      </span>
      <span className="tp-mirmaz__row-side">
        <span className="tp-mirmaz__score" dir="ltr">{row.score}{row.fullMark ? ` / ${row.fullMark}` : ""}</span>
        <span className="tp-mirmaz__state" data-tone={state.tone}>{state.label}{row.status === "RESOLVED" && row.byName ? ` · ${row.byName}` : ""}</span>
        {row.status === "PENDING" && (
          <Button type="button" size="sm" variant="outline" onClick={onHandle}>معالجة</Button>
        )}
      </span>
    </li>
  );
}

function DoneCard({ hold }: { hold: MirmazHold }) {
  const resolved = hold.status === "RESOLVED";
  return (
    <article className="tp-modal__card tp-mirmaz__card" data-tone={resolved ? "success" : undefined}>
      <HoldHeader hold={hold} />
      <p className="tp-mirmaz__done">
        {resolved
          ? <>انحفظت لـ <b>{hold.resolvedStudentName || "—"}</b> بـ <b>{hold.resolvedExamName || "—"}</b></>
          : <>انتركت</>}
        {hold.resolvedByName && <> · {hold.resolvedByName}</>}
        {hold.resolvedAt && <> · {formatAppDate(baghdadDateKey(hold.resolvedAt), "")}</>}
      </p>
    </article>
  );
}
