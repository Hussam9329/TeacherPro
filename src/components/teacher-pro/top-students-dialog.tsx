"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Award, Copy, Crown, Medal, RefreshCw, SlidersHorizontal, Trophy, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copyText } from "@/lib/code-closure-contact";
import { COURSE_PROGRAMS, LOCATION_SCOPES, OUT_OF_COUNTRY_LOCATION_SCOPE, STUDY_TYPES } from "@/lib/course-config";
import { formatAppDate } from "@/lib/format";
import { useTeacherStore } from "@/lib/teacher-store";
import { degreeTone, type TopStudentExamResult, type TopStudentRow, type TopStudentsAttendance, type TopStudentsExam } from "@/lib/top-students";
import { topStudentsApi, type TopStudentsQuery, type TopStudentsResponse } from "@/lib/top-students-client";
import { toast } from "@/lib/user-toast";
import { EmptyState, ErrorState, LoadingState } from "./ui-kit";
import "./tp-modal.css";
import "./top-students-dialog.css";

const LAST_COUNTS = [2, 3, 4, 5, 10];
const LIMITS = [10, 20, 50];
const GENDERS = ["ذكر", "أنثى"];
const LOCATIONS = [...LOCATION_SCOPES, OUT_OF_COUNTRY_LOCATION_SCOPE];

type Period = "last" | "range";

const fmt = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="tp-top__seg">
      {options.map(([key, text]) => (
        <button key={String(key)} type="button" className="tp-top__seg-btn" aria-pressed={value === key} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="tp-modal__field">
      <span>{label}</span>
      <div className="tp-modal__select-wrap" data-plain="true">
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
      </div>
    </label>
  );
}

/** A degree in a box coloured by how close it is to the full mark. */
function Degree({ value, percent, outOf, size }: { value: number; percent: number; outOf?: number; size?: "lg" }) {
  return (
    <span className="tp-top__degree" dir="ltr" data-tone={degreeTone(percent)} data-size={size}>
      {fmt(value)}
      {outOf !== undefined && <small>/{outOf}</small>}
    </span>
  );
}

function ExamCell({ result, exam, showOutOf }: { result: TopStudentExamResult; exam?: TopStudentsExam; showOutOf: boolean }) {
  const name = exam ? `${exam.name} — من ${exam.fullMark}` : undefined;
  if (result.state === "mark" && result.score !== null && exam) {
    return (
      <span title={name}>
        <Degree value={result.score} percent={(result.score / exam.fullMark) * 100} outOf={showOutOf ? exam.fullMark : undefined} />
      </span>
    );
  }
  const text = { mark: "—", absent: "غائب", excused: "مجاز", pending: "—" }[result.state];
  return <span className="tp-top__cell" data-state={result.state} title={name}>{text}</span>;
}

const PODIUM_ICONS = [Crown, Medal, Award];

/**
 * «الطلبة المتميزين»: one course's best students in its cumulative exams
 * (optionally the finals too), over the last N exams or a date range.
 */
export function TopStudentsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const courses = useTeacherStore(useShallow((state) => state.courses.filter((course) => course.active)));
  const [courseId, setCourseId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [period, setPeriod] = useState<Period>("last");
  const [last, setLast] = useState(3);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [withFinals, setWithFinals] = useState(false);
  const [attendance, setAttendance] = useState<TopStudentsAttendance>("all");
  const [limit, setLimit] = useState(10);
  const [gender, setGender] = useState("");
  const [studyType, setStudyType] = useState("");
  const [courseProgram, setCourseProgram] = useState("");
  const [locationScope, setLocationScope] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [data, setData] = useState<TopStudentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);

  const activeCourseId = courseId || courses[0]?.id || "";
  const extraCount = [gender, studyType, courseProgram, locationScope].filter(Boolean).length;
  const query: TopStudentsQuery | null = activeCourseId
    ? {
      courseId: activeCourseId,
      chapterId: chapterId || undefined,
      withFinals,
      ...(period === "range" ? { range: { from, to } } : { last }),
      attendance,
      limit,
      gender,
      studyType,
      courseProgram,
      locationScope,
    }
    : null;
  const queryKey = query ? JSON.stringify(query) : "";
  const rangeInvalid = period === "range" && Boolean(from && to && from > to);

  useEffect(() => {
    if (!open || !queryKey || rangeInvalid) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    topStudentsApi.load(JSON.parse(queryKey) as TopStudentsQuery, controller.signal)
      .then((response) => { if (!controller.signal.aborted) setData(response); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "تعذر تحميل الطلبة المتميزين.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, queryKey, rangeInvalid, reload]);

  const fresh = data && data.course.id === activeCourseId ? data : null;
  const examsById = useMemo(() => new Map((fresh?.exams || []).map((exam) => [exam.id, exam])), [fresh]);
  const podium = (fresh?.rows || []).filter((row) => row.rank <= 3).slice(0, 3);
  const top = fresh?.rows[0] ?? null;
  // Each exam's own full mark is shown only when the exams do not share one.
  const mixedFullMarks = Boolean(fresh?.exams.some((exam) => exam.fullMark !== fresh.scale));

  const changeCourse = (value: string) => {
    setCourseId(value);
    setChapterId("");
  };
  const clearExtra = () => {
    setGender("");
    setStudyType("");
    setCourseProgram("");
    setLocationScope("");
  };

  const periodText = period === "range"
    ? (from || to ? `من ${from ? formatAppDate(from) : "البداية"} إلى ${to ? formatAppDate(to) : "اليوم"}` : "كل الامتحانات لحد اليوم")
    : `آخر ${last} امتحانات`;

  const copyList = async () => {
    if (!fresh?.rows.length) return;
    const lines = [
      `الطلبة المتميزون — ${fresh.course.name}`,
      `${periodText} (${fresh.exams.length} امتحان)`,
      "",
      ...fresh.rows.map((row) => `${row.rank}. ${row.name} — ${fmt(row.averageScore)} من ${fresh.scale}`),
    ];
    const done = await copyText(lines.join("\n"), listRef.current);
    if (done) toast.success("تم نسخ القائمة.");
    else toast.error("تعذر النسخ.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tp-modal tp-top" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><Trophy /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>الطلبة المتميزين</DialogTitle>
            <DialogDescription>حسب درجاتهم بالامتحانات التراكمية، للطلاب النشطين.</DialogDescription>
          </DialogHeader>
        </div>

        <div className="tp-modal__body">
          <section className="tp-modal__panel tp-top__controls" aria-label="فلترة الطلبة المتميزين">
            <div className="tp-top__fields">
              <SelectField label="الدورة" value={activeCourseId} onChange={changeCourse}>
                {!courses.length && <option value="">ماكو دورات</option>}
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </SelectField>
              <SelectField label="الفصل" value={chapterId} onChange={setChapterId}>
                <option value="">كل الفصول</option>
                {(fresh?.chapters || []).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}
              </SelectField>
            </div>

            <div className="tp-top__row">
              <span className="tp-top__label">الفترة</span>
              <Segmented label="الفترة" value={period} onChange={setPeriod} options={[["last", "آخر امتحانات"], ["range", "حسب التاريخ"]]} />
              {period === "last" ? (
                <Segmented label="عدد الامتحانات" value={last} onChange={setLast} options={LAST_COUNTS.map((count) => [count, String(count)] as const)} />
              ) : (
                <div className="tp-top__range">
                  <label className="tp-modal__field"><span>من</span><DateInput aria-label="من تاريخ" value={from} onChange={setFrom} /></label>
                  <label className="tp-modal__field"><span>إلى</span><DateInput aria-label="إلى تاريخ" value={to} onChange={setTo} /></label>
                </div>
              )}
            </div>
            {rangeInvalid && <p className="tp-modal__note" data-tone="danger">تاريخ «من» بعد تاريخ «إلى».</p>}

            <div className="tp-top__row">
              <span className="tp-top__label">الامتحانات</span>
              <Segmented label="نوع الامتحانات" value={withFinals ? "finals" : "cumulative"} onChange={(value) => setWithFinals(value === "finals")} options={[["cumulative", "تراكمي فقط"], ["finals", "تراكمي + فاينل"]]} />
            </div>
            <div className="tp-top__row">
              <span className="tp-top__label">الغياب</span>
              <Segmented label="الغياب" value={attendance} onChange={setAttendance} options={[["all", "حضر كل الامتحانات"], ["zero", "الغياب يُحسب صفر"]]} />
            </div>
            <div className="tp-top__row">
              <span className="tp-top__label">العدد</span>
              <Segmented label="عدد الطلاب" value={limit} onChange={setLimit} options={LIMITS.map((count) => [count, `أفضل ${count}`] as const)} />
              <div className="tp-top__tools">
                <Button type="button" variant="outline" className="tp-modal__filter-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                  تصفية إضافية
                  {extraCount > 0 && <span className="tp-modal__filter-badge">{extraCount}</span>}
                </Button>
                <Button type="button" variant="outline" size="icon" className="tp-modal__filter-toggle" aria-label="تحديث" disabled={loading} onClick={() => setReload((value) => value + 1)}>
                  <RefreshCw className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
                </Button>
              </div>
            </div>

            {moreOpen && (
              <div className="tp-top__fields tp-top__extra">
                <SelectField label="الجنس" value={gender} onChange={setGender}>
                  <option value="">الكل</option>
                  {GENDERS.map((value) => <option key={value} value={value}>{value}</option>)}
                </SelectField>
                <SelectField label="نظام الدراسة" value={studyType} onChange={setStudyType}>
                  <option value="">الكل</option>
                  {STUDY_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
                </SelectField>
                <SelectField label="البرنامج" value={courseProgram} onChange={setCourseProgram}>
                  <option value="">الكل</option>
                  {COURSE_PROGRAMS.map((value) => <option key={value} value={value}>{value}</option>)}
                </SelectField>
                <SelectField label="المنطقة" value={locationScope} onChange={setLocationScope}>
                  <option value="">الكل</option>
                  {LOCATIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                </SelectField>
                {extraCount > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="tp-top__clear" onClick={clearExtra}>
                    <X className="size-4" aria-hidden="true" />مسح التصفية الإضافية
                  </Button>
                )}
              </div>
            )}
          </section>

          {error ? (
            <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
          ) : !fresh ? (
            courses.length ? <LoadingState title="جاري حساب الطلبة المتميزين..." /> : <EmptyState title="ماكو دورات فعالة" />
          ) : (
            <div className="tp-top__results" aria-busy={loading} data-loading={loading || undefined}>
              <dl className="tp-top__stats">
                <div><dt>الامتحانات المحسوبة</dt><dd>{fresh.exams.length}</dd></div>
                <div><dt>الطلاب الداخلين بالترتيب</dt><dd>{fresh.qualified}<small> من {fresh.considered}</small></dd></div>
                <div><dt>معدل الدورة</dt><dd>{fresh.courseAverageScore === null ? "—" : fmt(fresh.courseAverageScore)}<small> من {fresh.scale}</small></dd></div>
                <div><dt>أعلى معدل</dt><dd>{top === null ? "—" : fmt(top.averageScore)}<small> من {fresh.scale}</small></dd></div>
              </dl>

              {fresh.exams.length > 0 && (
                <div className="tp-top__exams" aria-label="الامتحانات المحسوبة">
                  {fresh.exams.map((exam, index) => (
                    <span key={exam.id} className="tp-top__exam" title={`${exam.name} — ${formatAppDate(exam.date)} — من ${exam.fullMark}`}>
                      <b>{index + 1}</b>
                      <span className="tp-top__exam-name">{exam.name}</span>
                      <span className="tp-top__exam-date">{formatAppDate(exam.date)}</span>
                    </span>
                  ))}
                </div>
              )}

              {!fresh.exams.length ? (
                <EmptyState title="ماكو امتحانات بهالفلترة" description="غيّر الفترة أو الفصل أو نوع الامتحانات." />
              ) : !fresh.rows.length ? (
                <EmptyState
                  title="ماكو طلاب بهالشروط"
                  description={attendance === "all" ? "كل طالب غاب عن امتحان واحد على الأقل. جرّب «الغياب يُحسب صفر»." : "ماكو درجات مسجلة لهالامتحانات."}
                />
              ) : (
                <>
                  <div className="tp-top__podium" aria-label="المراكز الأولى">
                    {podium.map((row, index) => <PodiumCard key={row.id} row={row} place={index} scale={fresh.scale} />)}
                  </div>

                  <div className="tp-modal__toolbar">
                    <span className="tp-modal__count" aria-live="polite">
                      {`${fresh.course.name} · ${periodText} · المعروض ${fresh.rows.length} من ${fresh.qualified}`}
                    </span>
                    <Button type="button" variant="outline" size="sm" className="tp-modal__filter-toggle" onClick={() => void copyList()}>
                      <Copy className="size-4" aria-hidden="true" />نسخ القائمة
                    </Button>
                  </div>

                  <ol ref={listRef} className="tp-top__list">
                    {fresh.rows.map((row) => (
                      <li key={row.id} className="tp-top__item" data-rank={row.rank <= 3 ? row.rank : undefined}>
                        <span className="tp-top__rank" aria-label={`المركز ${row.rank}`}>{row.rank}</span>
                        <div className="tp-top__who">
                          <span className="tp-top__name">{row.name}</span>
                          <span className="tp-top__meta">
                            <span dir="ltr">{row.code}</span>
                            {row.fullMarks > 0 && <span>· {row.fullMarks} درجة كاملة</span>}
                            {row.absences > 0 && <span data-tone="danger">· غاب {row.absences}</span>}
                            {row.excused > 0 && <span>· مجاز {row.excused}</span>}
                          </span>
                        </div>
                        <div className="tp-top__cells" aria-label="درجة كل امتحان">
                          {row.exams.map((result) => (
                            <ExamCell key={result.examId} result={result} exam={examsById.get(result.examId)} showOutOf={mixedFullMarks} />
                          ))}
                        </div>
                        <div className="tp-top__score" aria-label={`المعدل ${fmt(row.averageScore)} من ${fresh.scale}`}>
                          <span className="tp-top__score-label">المعدل</span>
                          <Degree value={row.averageScore} percent={row.average} size="lg" />
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PodiumCard({ row, place, scale }: { row: TopStudentRow; place: number; scale: number }) {
  const Icon = PODIUM_ICONS[Math.min(place, 2)];
  return (
    <div className="tp-top__podium-card" data-place={row.rank}>
      <span className="tp-top__podium-icon" aria-hidden="true"><Icon /></span>
      <span className="tp-top__podium-rank">المركز {row.rank}</span>
      <span className="tp-top__podium-name">{row.name}</span>
      <Degree value={row.averageScore} percent={row.average} outOf={scale} size="lg" />
      <span className="tp-top__podium-meta">{row.marks} امتحان{row.fullMarks > 0 ? ` · ${row.fullMarks} كاملة` : ""}</span>
    </div>
  );
}
