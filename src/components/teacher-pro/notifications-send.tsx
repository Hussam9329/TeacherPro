"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, RefreshCw, Send } from "lucide-react";
import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { toast } from "@/lib/user-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, LoadingState } from "./ui-kit";

type Target = "all" | "course" | "course-chapter";

type PushLog = {
  id: string;
  kind: string;
  target: string;
  courseName: string;
  chapterName: string;
  title: string;
  body: string;
  recipients: number;
  devices: number;
  sent: number;
  failed: number;
  userName: string;
  createdAt: string;
};

type Reach = { students: number; reachable: number; devices: number };

type TargetCourse = { id: string; name: string; chapters: Array<{ id: string; name: string; active: boolean }> };

const TITLE_MAX = 80;
const BODY_MAX = 500;

const TARGET_LABELS: Record<Target, string> = {
  all: "كل الطلاب",
  course: "دورة",
  "course-chapter": "دورة وفصل",
};

function targetText(log: PushLog): string {
  if (log.kind === "exam-window") return `نافذة امتحان${log.courseName ? ` · ${log.courseName}` : ""}`;
  if (log.target === "all") return "كل الطلاب";
  if (log.target === "course-chapter") return `${log.courseName} · ${log.chapterName}`;
  return log.courseName || "دورة";
}

async function readError(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

export function NotificationsSendView() {
  const [courses, setCourses] = useState<TargetCourse[]>([]);
  const [targetsError, setTargetsError] = useState("");

  const [target, setTarget] = useState<Target>("all");
  const [courseId, setCourseId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [reach, setReach] = useState<Reach | null>(null);
  const [logs, setLogs] = useState<PushLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/notifications/targets", { credentials: "same-origin" });
        if (!res.ok) throw new Error(await readError(res, "تعذر تحميل الدورات والفصول."));
        const payload = (await res.json()) as { courses: TargetCourse[] };
        if (!cancelled) setCourses(payload.courses);
      } catch (error) {
        if (!cancelled) setTargetsError(error instanceof Error ? error.message : "تعذر تحميل الدورات والفصول.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError("");
    try {
      const res = await fetch("/api/notifications?limit=100", { credentials: "same-origin" });
      if (!res.ok) throw new Error(await readError(res, "تعذر تحميل سجل الإشعارات."));
      const payload = (await res.json()) as { logs: PushLog[] };
      setLogs(payload.logs);
    } catch (error) {
      setLogsError(error instanceof Error ? error.message : "تعذر تحميل سجل الإشعارات.");
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  const activeCourses = courses;
  const courseChapterOptions = useMemo(
    () => courses.find((c) => c.id === courseId)?.chapters ?? [],
    [courseId, courses],
  );

  useEffect(() => {
    if (chapterId && !courseChapterOptions.some((o) => o.id === chapterId)) setChapterId("");
  }, [chapterId, courseChapterOptions]);

  const titleTrimmed = title.trim();
  const bodyTrimmed = body.trim();
  const validationMessage =
    !titleTrimmed ? "عنوان الإشعار مطلوب."
    : titleTrimmed.length > TITLE_MAX ? `العنوان يجب ألا يتجاوز ${TITLE_MAX} حرفاً.`
    : !bodyTrimmed ? "نص الإشعار مطلوب."
    : bodyTrimmed.length > BODY_MAX ? `النص يجب ألا يتجاوز ${BODY_MAX} حرف.`
    : target !== "all" && !courseId ? "اختر الدورة."
    : target === "course-chapter" && !chapterId ? "اختر الفصل."
    : "";

  const payload = () => ({
    target,
    courseId: target === "all" ? undefined : courseId,
    chapterId: target === "course-chapter" ? chapterId : undefined,
    title: titleTrimmed,
    body: bodyTrimmed,
  });

  const check = async () => {
    if (validationMessage) { toast.error(validationMessage); return; }
    setChecking(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload(), dryRun: true }),
      });
      if (!res.ok) throw new Error(await readError(res, "تعذر حساب المستلمين."));
      setReach((await res.json()) as Reach);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حساب المستلمين.");
    } finally {
      setChecking(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!res.ok) throw new Error(await readError(res, "تعذر إرسال الإشعار."));
      const result = (await res.json()) as { sent: number; failed: number; devices: number };
      toast.success(
        result.devices === 0
          ? "سُجّل الإشعار، لكن لا يوجد جهاز مفعّل للإشعارات ضمن هذه الجهة."
          : `أُرسل الإشعار إلى ${result.sent} جهاز${result.failed ? ` (تعذر ${result.failed})` : ""}.`,
      );
      setReach(null);
      setTitle("");
      setBody("");
      void loadLogs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال الإشعار.");
    } finally {
      setSending(false);
    }
  };

  const targetSummary =
    target === "all" ? "كل الطلاب"
    : target === "course" ? activeCourses.find((c) => c.id === courseId)?.name || "الدورة"
    : `${activeCourses.find((c) => c.id === courseId)?.name || "الدورة"} · ${courseChapterOptions.find((o) => o.id === chapterId)?.name || "الفصل"}`;

  return (
    <div className="tp-list space-y-6" dir="rtl">
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <BellRing className="size-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-bold">إرسال إشعار إلى تطبيق الطلاب</h2>
        </div>
        <p className="mb-5 text-sm leading-6 text-muted-foreground">
          يصل الإشعار إلى الطلاب الذين سجّلوا الدخول في التطبيق وفعّلوا الإشعارات. الطلاب المفصولون لا يستلمون.
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>الجهة المستهدفة</Label>
            <RadioGroup value={target} onValueChange={(v) => setTarget(v as Target)} className="flex flex-wrap gap-4">
              {(Object.keys(TARGET_LABELS) as Target[]).map((key) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value={key} id={`notify-target-${key}`} />
                  <span>{TARGET_LABELS[key]}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          {target !== "all" && (
            <div className="space-y-2">
              <Label htmlFor="notify-course">الدورة</Label>
              <Select value={courseId || "none"} onValueChange={(v) => setCourseId(v === "none" ? "" : v)}>
                <SelectTrigger id="notify-course"><SelectValue placeholder="اختر الدورة" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">اختر الدورة</SelectItem>
                  {activeCourses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {target === "course-chapter" && (
            <div className="space-y-2">
              <Label htmlFor="notify-chapter">الفصل</Label>
              <Select value={chapterId || "none"} onValueChange={(v) => setChapterId(v === "none" ? "" : v)} disabled={!courseId}>
                <SelectTrigger id="notify-chapter"><SelectValue placeholder="اختر الفصل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">اختر الفصل</SelectItem>
                  {courseChapterOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}{o.active ? " (النشط)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targetsError && <p className="text-xs text-destructive">{targetsError}</p>}
              {courseId && courseChapterOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">لا توجد فصول مرتبطة بهذه الدورة.</p>
              )}
            </div>
          )}

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notify-title">العنوان</Label>
            <Input
              id="notify-title"
              name="title"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => { setTitle(e.target.value); setReach(null); }}
              placeholder="مثال: محاضرة اليوم الساعة 6 مساءً"
            />
            <p className="text-xs text-muted-foreground">{titleTrimmed.length} / {TITLE_MAX}</p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notify-body">النص</Label>
            <textarea
              id="notify-body"
              name="body"
              value={body}
              maxLength={BODY_MAX}
              onChange={(e) => { setBody(e.target.value); setReach(null); }}
              rows={4}
              placeholder="اكتب نص الإشعار كما سيظهر على هاتف الطالب"
              className="border-input placeholder:text-muted-foreground flex w-full rounded-xl border bg-background/70 px-3.5 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
            />
            <p className="text-xs text-muted-foreground">{bodyTrimmed.length} / {BODY_MAX}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" disabled={checking || sending || Boolean(validationMessage)} onClick={() => void check()}>
            <Send className="size-4" aria-hidden="true" />
            {checking ? "جاري الحساب..." : "إرسال"}
          </Button>
          {validationMessage && <span className="text-xs text-muted-foreground">{validationMessage}</span>}
        </div>
      </section>

      <AlertDialog open={reach !== null} onOpenChange={(open) => { if (!open) setReach(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>إرسال الإشعار إلى {targetSummary}؟</AlertDialogTitle>
            <AlertDialogDescription>
              {reach && reach.devices === 0
                ? `الجهة تضم ${reach.students} طالب، ولا يوجد بينهم جهاز مفعّل للإشعارات بعد. سيُسجَّل الإشعار دون إرسال.`
                : reach
                  ? `سيصل إلى ${reach.reachable} طالب من أصل ${reach.students} (${reach.devices} جهاز). الطلاب الآخرون لم يفعّلوا الإشعارات في التطبيق.`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border bg-muted/40 p-3 text-sm">
            <p className="font-bold">{titleTrimmed}</p>
            <p className="mt-1 whitespace-pre-wrap leading-6">{bodyTrimmed}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void send(); }} disabled={sending}>
              {sending ? "جاري الإرسال..." : "تأكيد الإرسال"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-base font-bold">سجل الإشعارات المرسلة</h3>
          <Button type="button" variant="outline" size="icon" aria-label="تحديث السجل" title="تحديث" disabled={logsLoading} onClick={() => void loadLogs()}>
            <RefreshCw className={`size-4${logsLoading ? " animate-spin" : ""}`} aria-hidden="true" />
          </Button>
        </div>
        {logsLoading && logs.length === 0 ? (
          <LoadingState title="جاري تحميل السجل..." />
        ) : logsError ? (
          <EmptyState title="تعذر تحميل السجل" description={logsError} compact />
        ) : logs.length === 0 ? (
          <EmptyState title="لم يُرسل أي إشعار بعد" description="تظهر هنا الإشعارات اليدوية وإشعارات فتح نوافذ الامتحانات." icon={BellRing} compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-muted-foreground">
                  <th className="py-2 pe-3 font-medium">الوقت</th>
                  <th className="py-2 pe-3 font-medium">الجهة</th>
                  <th className="py-2 pe-3 font-medium">الإشعار</th>
                  <th className="py-2 pe-3 font-medium">الوصول</th>
                  <th className="py-2 pe-3 font-medium">المرسل</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pe-3 text-xs text-muted-foreground">{formatBaghdadDateTime(log.createdAt)}</td>
                    <td className="py-2 pe-3">{targetText(log)}</td>
                    <td className="py-2 pe-3">
                      <p className="font-bold">{log.title}</p>
                      <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{log.body}</p>
                    </td>
                    <td className="whitespace-nowrap py-2 pe-3 text-xs">
                      <span>{log.recipients} طالب · {log.devices} جهاز</span>
                      <br />
                      <span className="text-muted-foreground">أُرسل {log.sent}{log.failed ? ` · تعذر ${log.failed}` : ""}</span>
                    </td>
                    <td className="py-2 pe-3 text-xs">{log.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
