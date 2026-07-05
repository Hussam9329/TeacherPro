"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import { useTeacherStore } from "@/lib/teacher-store";
import { missingStudentsNotesStatsApi, type MissingStudentsNotesStatsResponse } from "@/lib/api";
import { formatAppDate } from "@/lib/format";
import { normalizeForSearch } from "@/lib/validation";
import {
  deleteGradeEntryMissingNote,
  fetchGradeEntryMissingNotesFromServer,
  GRADE_ENTRY_MISSING_NOTES_EVENT,
  readGradeEntryMissingNotes,
  type GradeEntryMissingNote,
} from "@/lib/grade-entry-notes";
import { EmptyState, StatCard } from "./ui-kit";
import { AlertTriangle, ClipboardList, FileText, Search } from "lucide-react";

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MissingStudentsNotesView() {
  const { exams, setSection } = useTeacherStore();
  const [notes, setNotes] = useState<GradeEntryMissingNote[]>([]);
  const [search, setSearch] = useState("");
  const [deleteDialogNote, setDeleteDialogNote] = useState<GradeEntryMissingNote | null>(null);
  const [databaseStats, setDatabaseStats] = useState<MissingStudentsNotesStatsResponse | null>(null);
  const [databaseStatsLoading, setDatabaseStatsLoading] = useState(false);

  const refreshNotes = () => setNotes(readGradeEntryMissingNotes());
  const refreshDatabaseStats = () => {
    setDatabaseStatsLoading(true);
    missingStudentsNotesStatsApi
      .get()
      .then((result) => setDatabaseStats(result))
      .catch(() => setDatabaseStats(null))
      .finally(() => setDatabaseStatsLoading(false));
  };

  useEffect(() => {
    refreshNotes();
    refreshDatabaseStats();
    void fetchGradeEntryMissingNotesFromServer().then(() => setNotes(readGradeEntryMissingNotes()));
    window.addEventListener(GRADE_ENTRY_MISSING_NOTES_EVENT, refreshNotes);
    window.addEventListener("storage", refreshNotes);
    return () => {
      window.removeEventListener(GRADE_ENTRY_MISSING_NOTES_EVENT, refreshNotes);
      window.removeEventListener("storage", refreshNotes);
    };
  }, []);

  const normalizedSearch = useMemo(() => normalizeForSearch(search), [search]);
  const filteredNotes = useMemo(() => {
    if (!normalizedSearch) return notes;
    return notes.filter((note) =>
      normalizeForSearch(
        `${note.examName} ${note.examDate} ${note.text}`,
      ).includes(normalizedSearch),
    );
  }, [normalizedSearch, notes]);

  const statValue = (value: number | undefined) =>
    databaseStatsLoading && !databaseStats ? "…" : value ?? "—";

  const handleDeleteNote = (note: GradeEntryMissingNote) => {
    setDeleteDialogNote(note);
  };

  const confirmDeleteNote = () => {
    if (!deleteDialogNote) return;
    void deleteGradeEntryMissingNote(deleteDialogNote.examId).finally(refreshDatabaseStats);
    setDeleteDialogNote(null);
    refreshNotes();
  };

  return (
    <div className="section-stack">
      <AlertDialog open={Boolean(deleteDialogNote)} onOpenChange={(open) => !open && setDeleteDialogNote(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الملاحظة</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف ملاحظات امتحان {deleteDialogNote?.examName || "هذا الامتحان"}. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteNote}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight">الطلاب الغير موجودين</h2>
          <p className="mt-1 text-sm leading-7 text-muted-foreground">
            هنا تظهر كل الملاحظات التي يكتبها مدخل الدرجات من صفحة تسجيل الدرجات لكل امتحان.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setSection("grade-entry")}>فتح تسجيل الدرجات</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="عدد الملاحظات"
          value={statValue(databaseStats?.total)}
          icon={ClipboardList}
          tone="info"
          hint="عدّ مباشر من قاعدة البيانات"
        />
        <StatCard
          label="امتحانات تحتوي ملاحظات"
          value={statValue(databaseStats?.examsWithNotes)}
          icon={FileText}
          tone="warning"
          hint="عدّ مباشر من قاعدة البيانات"
        />
        <StatCard
          label="إجمالي الأحرف"
          value={statValue(databaseStats?.totalCharacters)}
          icon={AlertTriangle}
          tone="danger"
          hint="مجموع النصوص من قاعدة البيانات"
        />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle>سجل ملاحظات مدخلي الدرجات</CardTitle>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                استخدم البحث للوصول إلى اسم طالب أو امتحان بسرعة.
              </p>
            </div>
            <div className="w-full space-y-2 lg:max-w-sm">
              <Label htmlFor="missing-students-notes-search">بحث</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="missing-students-notes-search"
                  name="search"
                  data-teacherpro-search="true"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ابحث باسم الطالب، نص الملاحظة، أو اسم الامتحان"
                  className="pr-9"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredNotes.length === 0 ? (
            <EmptyState
              title={notes.length === 0 ? "لا توجد ملاحظات بعد" : "لا توجد نتائج مطابقة"}
              description={
                notes.length === 0
                  ? "عند كتابة ملاحظات في صفحة تسجيل الدرجات ستظهر هنا تلقائياً."
                  : "غيّر كلمات البحث لعرض ملاحظات أخرى."
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredNotes.map((note) => {
                const currentExam = exams.find((exam) => exam.id === note.examId);
                const examDate = note.examDate || currentExam?.date || "";
                return (
                  <div
                    key={note.id}
                    className="rounded-3xl border bg-card p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{currentExam?.type || "امتحان"}</Badge>
                          <h3 className="text-base font-black">{currentExam?.name || note.examName}</h3>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>تاريخ الامتحان: {examDate ? formatAppDate(examDate, examDate) : "غير محدد"}</span>
                          <span>آخر تحديث: {formatDateTime(note.updatedAt)}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteNote(note)}
                      >
                        حذف الملاحظة
                      </Button>
                    </div>
                    <div className="mt-4 whitespace-pre-wrap rounded-2xl border bg-muted/30 p-4 text-sm leading-8">
                      {note.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
