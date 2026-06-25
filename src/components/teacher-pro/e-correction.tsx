"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { toLatinDigits } from "@/lib/format";
import { useActionLock } from "@/hooks/use-action-lock";


type TelegramSubmissionPage = {
  pageNumber?: number;
  fileId?: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  url?: string;
  dataUrl?: string;
  localPath?: string;
  size?: number;
  width?: number;
  height?: number;
  messageId?: string;
  caption?: string;
  downloadedAt?: string;
};

type TelegramExamSubmission = {
  id: string;
  studentId: string;
  examId: string;
  gradeId?: string | null;
  telegramUserId?: string;
  telegramUsername?: string;
  telegramChatId?: string;
  sourceMessageIds?: string[];
  pages?: TelegramSubmissionPage[];
  pageCount: number;
  status: string;
  notes?: string;
  submittedAt?: string | null;
  receivedAt: string;
  updatedAt: string;
  student?: {
    id: string;
    name: string;
    code: string;
    phone?: string | null;
    parentPhone?: string | null;
    telegram?: string | null;
  };
  exam?: {
    id: string;
    name: string;
    fullMark?: number;
    date?: string;
  };
};

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSubmissionPagePreview(page: TelegramSubmissionPage) {
  return page.dataUrl || page.url || "";
}

export function ECorrectionView() {
  const {
    correctionSheets,
    students,
    exams,
    users,
    addCorrectionSheet,
    updateCorrectionSheet,
    deleteCorrectionSheet,
    leaderboardSettings,
    studentName,
    userName,
  } = useTeacherStore();

  const [filterExamId, setFilterExamId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [completeDialog, setCompleteDialog] = useState({
    open: false,
    sheetId: "",
    correctionErrors: 0,
    sumErrors: 0,
  });
  const [deleteSheetDialog, setDeleteSheetDialog] = useState({
    open: false,
    id: "",
  });

  const [botSubmissions, setBotSubmissions] = useState<TelegramExamSubmission[]>([]);
  const [isLoadingBotSubmissions, setIsLoadingBotSubmissions] = useState(false);
  const [botSubmissionDialog, setBotSubmissionDialog] = useState<TelegramExamSubmission | null>(null);
  const [botSearch, setBotSearch] = useState("");
  const [botFilterExamId, setBotFilterExamId] = useState("");
  const [botFilterStatus, setBotFilterStatus] = useState("");
  const { locked: isAddingSheet, runLocked: runAddSheetLocked } =
    useActionLock();
  const { locked: isCompletingSheet, runLocked: runCompleteSheetLocked } =
    useActionLock();
  const { locked: isDeletingSheet, runLocked: runDeleteSheetLocked } =
    useActionLock();

  const loadBotSubmissions = async () => {
    setIsLoadingBotSubmissions(true);
    try {
      const response = await fetch("/api/telegram-exam-submissions", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "تعذر تحميل مستلمات البوت");
      setBotSubmissions(Array.isArray(payload.submissions) ? payload.submissions : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تحميل مستلمات البوت");
    } finally {
      setIsLoadingBotSubmissions(false);
    }
  };

  useEffect(() => {
    loadBotSubmissions();
  }, []);

  const updateBotSubmissionStatus = async (id: string, status: string) => {
    const previous = botSubmissions;
    setBotSubmissions((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    if (botSubmissionDialog?.id === id) setBotSubmissionDialog({ ...botSubmissionDialog, status });
    try {
      const response = await fetch("/api/telegram-exam-submissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "تعذر تحديث حالة المستلم");
      const nextSubmission = payload.submission as TelegramExamSubmission;
      setBotSubmissions((items) => items.map((item) => item.id === id ? nextSubmission : item));
      if (botSubmissionDialog?.id === id) setBotSubmissionDialog(nextSubmission);
      toast.success("تم تحديث حالة مستلم البوت");
    } catch (error) {
      setBotSubmissions(previous);
      toast.error(error instanceof Error ? error.message : "تعذر تحديث حالة مستلم البوت");
    }
  };

  // Filter sheets
  const filteredSheets = useMemo(() => {
    return correctionSheets.filter((s) => {
      if (filterExamId && s.examId !== filterExamId) return false;
      if (filterStatus && s.status !== filterStatus) return false;
      return true;
    });
  }, [correctionSheets, filterExamId, filterStatus]);

  // Stats

  const filteredBotSubmissions = useMemo(() => {
    const normalizedSearch = botSearch.trim().toLowerCase();
    return botSubmissions.filter((submission) => {
      if (botFilterExamId && submission.examId !== botFilterExamId) return false;
      if (botFilterStatus && submission.status !== botFilterStatus) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        submission.student?.name,
        submission.student?.code,
        submission.student?.phone,
        submission.student?.parentPhone,
        submission.student?.telegram,
        submission.telegramUsername,
        submission.telegramUserId,
        submission.exam?.name,
      ].map((item) => String(item || "").toLowerCase()).join(" ");
      return haystack.includes(normalizedSearch);
    });
  }, [botFilterExamId, botFilterStatus, botSearch, botSubmissions]);

  const botStats = useMemo(() => {
    const totalPages = botSubmissions.reduce((acc, item) => acc + (item.pageCount || item.pages?.length || 0), 0);
    return {
      total: botSubmissions.length,
      pending: botSubmissions.filter((item) => item.status === "بانتظار التصحيح").length,
      inReview: botSubmissions.filter((item) => item.status === "قيد التصحيح").length,
      done: botSubmissions.filter((item) => item.status === "مكتمل").length,
      totalPages,
    };
  }, [botSubmissions]);

  const completed = correctionSheets.filter((s) => s.status === "مكتمل").length;
  const pending = correctionSheets.filter((s) => s.status !== "مكتمل").length;
  const totalErrors = correctionSheets.reduce(
    (acc, s) => acc + s.correctionErrors + s.sumErrors,
    0,
  );

  // Leaderboard: sorted by total errors (ascending)
  const leaderboard = useMemo(() => {
    const correctorMap = new Map<
      string,
      {
        name: string;
        totalCorrectionErrors: number;
        totalSumErrors: number;
        sheets: number;
      }
    >();
    correctionSheets
      .filter((s) => s.status === "مكتمل")
      .forEach((s) => {
        const existing = correctorMap.get(s.correctorId) || {
          name: userName(s.correctorId),
          totalCorrectionErrors: 0,
          totalSumErrors: 0,
          sheets: 0,
        };
        existing.totalCorrectionErrors += s.correctionErrors;
        existing.totalSumErrors += s.sumErrors;
        existing.sheets += 1;
        correctorMap.set(s.correctorId, existing);
      });
    return Array.from(correctorMap.entries())
      .map(([id, data]) => ({
        id,
        ...data,
        penalty:
          data.totalCorrectionErrors *
            leaderboardSettings.correctionErrorPenalty +
          data.totalSumErrors * leaderboardSettings.sumErrorPenalty,
      }))
      .sort((a, b) => a.penalty - b.penalty);
  }, [correctionSheets, leaderboardSettings, userName]);

  // Add new sheet
  const handleAddSheet = runAddSheetLocked(async () => {
    const firstExam = exams[0];
    const firstStudent = students[0];
    if (!firstExam || !firstStudent) return;
    addCorrectionSheet({
      studentId: firstStudent.id,
      examId: firstExam.id,
      correctorId: users[0]?.id || "",
      status: "بانتظار التصحيح",
      startedAt: new Date().toISOString(),
      finishedAt: "",
      correctionErrors: 0,
      sumErrors: 0,
    });
    toast.success("تم إضافة ورقة تصحيح");
  });

  const handleCompleteSheet = runCompleteSheetLocked(async () => {
    updateCorrectionSheet(completeDialog.sheetId, {
      status: "مكتمل",
      finishedAt: new Date().toISOString(),
      correctionErrors: Math.max(
        0,
        Number(completeDialog.correctionErrors) || 0,
      ),
      sumErrors: Math.max(0, Number(completeDialog.sumErrors) || 0),
    });
    setCompleteDialog({
      open: false,
      sheetId: "",
      correctionErrors: 0,
      sumErrors: 0,
    });
    toast.success("تم إكمال التصحيح وتسجيل الأخطاء");
  });

  const openDeleteSheetDialog = (sheetId: string) => {
    setDeleteSheetDialog({ open: true, id: sheetId });
  };
  const handleDeleteSheetConfirm = runDeleteSheetLocked(async () => {
    const ok = deleteCorrectionSheet(deleteSheetDialog.id);
    ok ? toast.success("تم حذف ورقة التصحيح") : toast.error("تعذر حذف الورقة");
    setDeleteSheetDialog({ open: false, id: "" });
  });

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {completed}
            </p>
            <p className="text-xs text-muted-foreground">مكتمل</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {pending}
            </p>
            <p className="text-xs text-muted-foreground">بانتظار التصحيح</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
              {totalErrors}
            </p>
            <p className="text-xs text-muted-foreground">إجمالي الأخطاء</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Button
              size="sm"
              className="w-full"
              onClick={handleAddSheet}
              disabled={isAddingSheet}
              title="يضيف ورقة تصحيح تجريبية إلى القائمة"
            >
              {isAddingSheet ? "جاري الإضافة..." : "إضافة ورقة"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="sheets" dir="rtl">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="sheets">أوراق التصحيح</TabsTrigger>
          <TabsTrigger value="bot-submissions">مستلمات البوت</TabsTrigger>
          <TabsTrigger value="leaderboard">المتصدرين</TabsTrigger>
          <TabsTrigger value="errors">تتبع الأخطاء</TabsTrigger>
        </TabsList>

        {/* Sheets Tab */}
        <TabsContent value="sheets" className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ecorrection-exam" className="text-xs">
                الامتحان
              </Label>
              <Select
                name="examId"
                value={filterExamId}
                onValueChange={(v) => setFilterExamId(v === "all" ? "" : v)}
              >
                <SelectTrigger id="ecorrection-exam">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {exams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ecorrection-status" className="text-xs">
                الحالة
              </Label>
              <Select
                name="status"
                value={filterStatus}
                onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}
              >
                <SelectTrigger id="ecorrection-status">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="بانتظار التصحيح">
                    بانتظار التصحيح
                  </SelectItem>
                  <SelectItem value="قيد التصحيح">قيد التصحيح</SelectItem>
                  <SelectItem value="مكتمل">مكتمل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            {filteredSheets.map((sheet) => (
              <Card key={sheet.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">
                        {studentName(sheet.studentId)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {exams.find((e) => e.id === sheet.examId)?.name || ""} -
                        المصحح: {userName(sheet.correctorId)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          sheet.status === "مكتمل" ? "default" : "secondary"
                        }
                      >
                        {sheet.status}
                      </Badge>
                      {sheet.status === "مكتمل" && (
                        <div className="text-xs text-muted-foreground">
                          أخطاء التصحيح: {sheet.correctionErrors} | أخطاء الجمع:{" "}
                          {sheet.sumErrors}
                        </div>
                      )}
                      {sheet.status !== "مكتمل" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            setCompleteDialog({
                              open: true,
                              sheetId: sheet.id,
                              correctionErrors: sheet.correctionErrors,
                              sumErrors: sheet.sumErrors,
                            })
                          }
                        >
                          إكمال
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => openDeleteSheetDialog(sheet.id)}
                      >
                        حذف
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Telegram Bot Submissions Tab */}
        <TabsContent value="bot-submissions" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{botStats.total}</p><p className="text-xs text-muted-foreground">مستلم من البوت</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{botStats.pending}</p><p className="text-xs text-muted-foreground">بانتظار التصحيح</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-sky-600 dark:text-sky-400">{botStats.inReview}</p><p className="text-xs text-muted-foreground">قيد التصحيح</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{botStats.done}</p><p className="text-xs text-muted-foreground">مكتمل</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{botStats.totalPages}</p><p className="text-xs text-muted-foreground">صفحات مستلمة</p></CardContent></Card>
          </div>

          <Card className="border-dashed bg-muted/30">
            <CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">ربط البوت المباشر</p>
              <p>يستقبل TeacherPro تسليمات البوت عبر <code className="rounded bg-background px-1">POST /api/telegram-exam-submissions</code> مع توكن <code className="rounded bg-background px-1">TEACHERPRO_BOT_INGEST_TOKEN</code>.</p>
              <p>البيانات المتوقعة: <code className="rounded bg-background px-1">studentId</code>، <code className="rounded bg-background px-1">examId</code>، بيانات التلكرام، وقائمة <code className="rounded bg-background px-1">pages</code> التي تحتوي روابط أو dataUrl أو fileId أو localPath.</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bot-search" className="text-xs">بحث</Label>
              <Input
                id="bot-search"
                value={botSearch}
                onChange={(event) => setBotSearch(event.target.value)}
                placeholder="اسم، كود، هاتف، معرف..."
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bot-exam" className="text-xs">الامتحان</Label>
              <Select value={botFilterExamId} onValueChange={(v) => setBotFilterExamId(v === "all" ? "" : v)}>
                <SelectTrigger id="bot-exam"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {exams.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="bot-status" className="text-xs">الحالة</Label>
              <Select value={botFilterStatus} onValueChange={(v) => setBotFilterStatus(v === "all" ? "" : v)}>
                <SelectTrigger id="bot-status"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="بانتظار التصحيح">بانتظار التصحيح</SelectItem>
                  <SelectItem value="قيد التصحيح">قيد التصحيح</SelectItem>
                  <SelectItem value="مكتمل">مكتمل</SelectItem>
                  <SelectItem value="مرفوض">مرفوض</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">تحديث</Label>
              <Button variant="outline" className="w-full" onClick={loadBotSubmissions} disabled={isLoadingBotSubmissions}>
                {isLoadingBotSubmissions ? "جاري التحميل..." : "تحديث المستلمات"}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {filteredBotSubmissions.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">لا توجد مستلمات من البوت حسب الفلترة الحالية.</CardContent></Card>
            ) : filteredBotSubmissions.map((submission) => (
              <Card key={submission.id} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-base">{submission.student?.name || studentName(submission.studentId)}</p>
                        <Badge variant={submission.status === "مكتمل" ? "default" : submission.status === "قيد التصحيح" ? "secondary" : "outline"}>{submission.status}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{submission.exam?.name || exams.find((e) => e.id === submission.examId)?.name || "امتحان غير معروف"}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>الكود: {submission.student?.code || "—"}</span>
                        <span>هاتف الطالب: {submission.student?.phone || "—"}</span>
                        <span>تلكرام الطالب: {submission.student?.telegram || submission.telegramUsername || submission.telegramUserId || "—"}</span>
                        <span>الصفحات: {submission.pageCount || submission.pages?.length || 0}</span>
                        <span>الاستلام: {formatDateTime(submission.receivedAt)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setBotSubmissionDialog(submission)}>فتح الصفحات</Button>
                      {submission.status !== "قيد التصحيح" && (
                        <Button size="sm" variant="secondary" onClick={() => updateBotSubmissionStatus(submission.id, "قيد التصحيح")}>بدء التصحيح</Button>
                      )}
                      {submission.status !== "مكتمل" && (
                        <Button size="sm" onClick={() => updateBotSubmissionStatus(submission.id, "مكتمل")}>تم التصحيح</Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Leaderboard Tab */}
        <TabsContent value="leaderboard">
          <Card>
            <CardHeader>
              <CardTitle>لوحة المتصدرين - المصححون</CardTitle>
            </CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <p className="empty-state">لا توجد بيانات</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry, index) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between p-3 rounded-2xl border bg-card/80 shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            index === 0
                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                              : index === 1
                                ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                                : index === 2
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                                  : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium">{entry.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.sheets} ورقة
                          </p>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="font-bold">{entry.penalty} نقطة جزاء</p>
                        <p className="text-xs text-muted-foreground">
                          تصحيح: {entry.totalCorrectionErrors} | جمع:{" "}
                          {entry.totalSumErrors}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Errors Tab */}
        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle>تتبع الأخطاء</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {correctionSheets.filter(
                  (s) =>
                    s.status === "مكتمل" &&
                    (s.correctionErrors > 0 || s.sumErrors > 0),
                ).length === 0 ? (
                  <p className="empty-state">لا توجد أخطاء مسجلة</p>
                ) : (
                  correctionSheets
                    .filter(
                      (s) =>
                        s.status === "مكتمل" &&
                        (s.correctionErrors > 0 || s.sumErrors > 0),
                    )
                    .map((sheet) => (
                      <div
                        key={sheet.id}
                        className="flex items-center justify-between p-3 rounded-2xl border bg-card/80 shadow-sm"
                      >
                        <div>
                          <p className="font-medium text-sm">
                            {studentName(sheet.studentId)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            المصحح: {userName(sheet.correctorId)} -{" "}
                            {exams.find((e) => e.id === sheet.examId)?.name}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {sheet.correctionErrors > 0 && (
                            <Badge variant="destructive">
                              تصحيح: {sheet.correctionErrors}
                            </Badge>
                          )}
                          {sheet.sumErrors > 0 && (
                            <Badge variant="secondary">
                              جمع: {sheet.sumErrors}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!botSubmissionDialog} onOpenChange={(open) => !open && setBotSubmissionDialog(null)}>
        <DialogContent dir="rtl" className="sm:max-w-5xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>تسليم البوت - {botSubmissionDialog?.student?.name || "طالب"}</DialogTitle>
            <DialogDescription>
              {botSubmissionDialog?.exam?.name || "امتحان"} • {botSubmissionDialog?.pageCount || botSubmissionDialog?.pages?.length || 0} صفحة • الاستلام {formatDateTime(botSubmissionDialog?.receivedAt)}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[68vh] pr-2">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded-2xl border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">كود الطالب</p><p className="font-medium">{botSubmissionDialog?.student?.code || "—"}</p></div>
                <div className="rounded-2xl border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">هاتف الطالب</p><p className="font-medium">{botSubmissionDialog?.student?.phone || "—"}</p></div>
                <div className="rounded-2xl border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">معرف التلكرام</p><p className="font-medium">{botSubmissionDialog?.student?.telegram || botSubmissionDialog?.telegramUsername || botSubmissionDialog?.telegramUserId || "—"}</p></div>
              </div>

              {botSubmissionDialog?.notes && (
                <div className="rounded-2xl border bg-muted/30 p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">ملاحظات البوت</p>
                  <p>{botSubmissionDialog.notes}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(botSubmissionDialog?.pages || []).length === 0 ? (
                  <div className="rounded-2xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground md:col-span-2">
                    لا توجد صفحات مرفوعة داخل هذا التسليم.
                  </div>
                ) : (botSubmissionDialog?.pages || []).map((page, index) => {
                  const preview = getSubmissionPagePreview(page);
                  return (
                    <div key={`${page.pageNumber || index}-${page.fileId || page.localPath || index}`} className="rounded-2xl border bg-background p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-sm">صفحة {page.pageNumber || index + 1}</p>
                        <Badge variant="outline">{page.mimeType || "image"}</Badge>
                      </div>
                      {preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preview} alt={`صفحة ${page.pageNumber || index + 1}`} className="w-full max-h-[520px] rounded-xl border object-contain bg-muted/30" />
                      ) : (
                        <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
                          <p>لا يوجد رابط مباشر للمعاينة داخل TeacherPro.</p>
                          {page.localPath && <p>المسار المحلي في البوت: <code>{page.localPath}</code></p>}
                          {page.fileId && <p>Telegram fileId: <code>{page.fileId}</code></p>}
                          {page.messageId && <p>messageId: <code>{page.messageId}</code></p>}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>الملف: {page.fileName || "—"}</span>
                        <span>الحجم: {page.size || "—"}</span>
                        <span>العرض: {page.width || "—"}</span>
                        <span>الارتفاع: {page.height || "—"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            {botSubmissionDialog && botSubmissionDialog.status !== "قيد التصحيح" && (
              <Button variant="secondary" onClick={() => updateBotSubmissionStatus(botSubmissionDialog.id, "قيد التصحيح")}>بدء التصحيح</Button>
            )}
            {botSubmissionDialog && botSubmissionDialog.status !== "مكتمل" && (
              <Button onClick={() => updateBotSubmissionStatus(botSubmissionDialog.id, "مكتمل")}>تم التصحيح</Button>
            )}
            <Button variant="outline" onClick={() => setBotSubmissionDialog(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Sheet AlertDialog */}
      <AlertDialog
        open={deleteSheetDialog.open}
        onOpenChange={(o) =>
          setDeleteSheetDialog((prev) => ({ ...prev, open: o }))
        }
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف ورقة التصحيح؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSheetConfirm}
              disabled={isDeletingSheet}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingSheet ? "جاري الحذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={completeDialog.open}
        onOpenChange={(open) =>
          setCompleteDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إكمال ورقة التصحيح وتسجيل الأخطاء</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ecorrection-errors">أخطاء التصحيح</Label>
              <Input
                id="ecorrection-errors"
                name="correctionErrors"
                type="number"
                min={0}
                autoComplete="off"
                value={completeDialog.correctionErrors}
                onChange={(e) =>
                  setCompleteDialog((prev) => ({
                    ...prev,
                    correctionErrors:
                      Number(toLatinDigits(e.target.value)) || 0,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ecorrection-sum-errors">أخطاء الجمع</Label>
              <Input
                id="ecorrection-sum-errors"
                name="sumErrors"
                type="number"
                min={0}
                autoComplete="off"
                value={completeDialog.sumErrors}
                onChange={(e) =>
                  setCompleteDialog((prev) => ({
                    ...prev,
                    sumErrors: Number(toLatinDigits(e.target.value)) || 0,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setCompleteDialog({
                  open: false,
                  sheetId: "",
                  correctionErrors: 0,
                  sumErrors: 0,
                })
              }
            >
              إلغاء
            </Button>
            <Button onClick={handleCompleteSheet} disabled={isCompletingSheet}>
              {isCompletingSheet ? "جاري الحفظ..." : "حفظ وإكمال"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
