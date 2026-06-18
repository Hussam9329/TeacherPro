"use client";

import React, { useMemo, useState } from "react";
import { useTeacherStore, type Exam, type Grade, type Student } from "@/lib/teacher-store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";
import { ClipboardCheck, Eye, Loader2, PlusCircle, ShieldAlert } from "lucide-react";
import { toLatinDigits } from "@/lib/format";
import { normalizeStudentName, normalizeTelegramIdentifier, sanitizeTelegramInput } from "@/lib/student-utils";

const EXPECTED_COLUMNS = 3;
const SAMPLE_TEXT = `عبدالله عبدالرحمن محمود داود	@zzzcr8	11
علي جودت حمزة محمد	@a_qkv	20
رفل رحيم احمد مالح	@a1zz990	20
احمد عباس خزعل محيسن	@a2_7aki	20
احمد حليم عبدالعباس حمزه	@aa_90l	20
عباس عبدالحسين جبار حسن	@Aabbbs15	20
عباس سلام ناصر خضير	@a_b_s155	11
عبدالله مشتاق جبار راضي	@Abadllah33	18
عباس حسين علي محيسن	@Abbas_misse	20
ياسر جمال مانع زيدان	@abd20062024	14
زهراء حسام سعد جاسم	@Acdgcfh27	20
نادين عدنان حاكم جويت	@adam_nadine	20`;

type PreviewRow = {
  rowNumber: number;
  rawCells: string[];
  student: Student | null;
  score: number | null;
  existingGrade: Grade | null;
  errors: string[];
  warnings: string[];
};

function splitRows(rawText: string): string[][] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("	").map((cell) => cell.trim()));
}

function parseScore(value: string): number | null {
  const normalized = toLatinDigits(value || "").trim().replace(/,/g, ".");
  if (!normalized) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return null;
  return numeric;
}

function findMatchingStudent(students: Student[], rawName: string, rawTelegram: string) {
  const nameKey = normalizeStudentName(rawName);
  const telegramKey = normalizeTelegramIdentifier(rawTelegram);
  const nameMatches = students.filter((student) => normalizeStudentName(student.name) === nameKey);
  const telegramMatches = students.filter((student) => normalizeTelegramIdentifier(student.telegram) === telegramKey);
  const exactMatches = students.filter(
    (student) => normalizeStudentName(student.name) === nameKey && normalizeTelegramIdentifier(student.telegram) === telegramKey,
  );

  return { nameKey, telegramKey, nameMatches, telegramMatches, exactMatches };
}

function examLabel(exam: Exam) {
  return `${exam.name} — ${exam.fullMark} درجة`;
}

export function GradeBulkImportView() {
  const { exams, students, grades, courses, bulkAddGrades } = useTeacherStore();
  const [selectedExamId, setSelectedExamId] = useState("");
  const [rawText, setRawText] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewDone, setPreviewDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const selectedExam = useMemo(() => exams.find((exam) => exam.id === selectedExamId) || null, [exams, selectedExamId]);
  const activeExams = useMemo(() => exams.filter((exam) => exam.active), [exams]);

  const summary = useMemo(() => {
    const valid = previewRows.filter((row) => row.student && row.score !== null && row.errors.length === 0).length;
    const updates = previewRows.filter((row) => row.existingGrade && row.errors.length === 0).length;
    const errorRows = previewRows.filter((row) => row.errors.length > 0).length;
    const warningRows = previewRows.filter((row) => row.warnings.length > 0 && row.errors.length === 0).length;
    return { total: previewRows.length, valid, updates, errorRows, warningRows };
  }, [previewRows]);

  const canImport = previewDone && summary.valid > 0 && summary.errorRows === 0 && Boolean(selectedExam) && !isImporting;

  const buildPreview = () => {
    if (!selectedExam) {
      toast.error("اختر الامتحان أولاً");
      setPreviewRows([]);
      setPreviewDone(false);
      return;
    }

    const parsedRows = splitRows(rawText);
    if (parsedRows.length === 0) {
      toast.error("الصق درجات الطلاب أولاً");
      setPreviewRows([]);
      setPreviewDone(false);
      return;
    }

    const seenStudentIds = new Set<string>();
    const seenTelegramKeys = new Set<string>();

    const rows: PreviewRow[] = parsedRows.map((cells, index) => {
      const rowNumber = index + 1;
      const errors: string[] = [];
      const warnings: string[] = [];
      let student: Student | null = null;
      let score: number | null = null;
      let existingGrade: Grade | null = null;

      if (cells.length !== EXPECTED_COLUMNS) {
        errors.push(`عدد الأعمدة ${cells.length}، المطلوب ${EXPECTED_COLUMNS}: الاسم / التليكرام / الدرجة`);
        return { rowNumber, rawCells: cells, student, score, existingGrade, errors, warnings };
      }

      const [nameRaw, telegramRaw, scoreRaw] = cells;
      const telegram = sanitizeTelegramInput(telegramRaw);
      const match = findMatchingStudent(students, nameRaw, telegramRaw);

      if (!nameRaw.trim()) errors.push("اسم الطالب فارغ");
      if (!telegram) errors.push("معرف التليكرام فارغ");
      if (match.exactMatches.length === 1) {
        student = match.exactMatches[0];
      } else if (match.exactMatches.length > 1) {
        errors.push("يوجد أكثر من طالب بنفس الاسم ومعرف التليكرام");
      } else if (match.nameMatches.length > 0 && match.telegramMatches.length > 0) {
        errors.push("الاسم موجود والتليكرام موجود، لكنهما يعودان لطالبين مختلفين");
      } else if (match.nameMatches.length > 0) {
        errors.push("الاسم موجود لكن معرف التليكرام لا يطابق الطالب");
      } else if (match.telegramMatches.length > 0) {
        errors.push("معرف التليكرام موجود لكن الاسم لا يطابق الطالب");
      } else if (nameRaw.trim() || telegram) {
        errors.push("لا يوجد طالب مطابق للاسم ومعرف التليكرام");
      }

      score = parseScore(scoreRaw);
      if (score === null) {
        errors.push("الدرجة يجب أن تكون عدداً صحيحاً");
      } else if (score < 0 || score > selectedExam.fullMark) {
        errors.push(`الدرجة ${score} خارج حيز الامتحان 0 - ${selectedExam.fullMark}`);
      }

      if (student) {
        if (!selectedExam.courseIds.includes(student.courseId)) {
          const courseName = courses.find((course) => course.id === student?.courseId)?.name || "دورة غير معروفة";
          errors.push(`الطالب تابع لـ ${courseName} وليس ضمن دورات هذا الامتحان`);
        }
        if (seenStudentIds.has(student.id)) errors.push("الطالب مكرر داخل النص الملصوق");
        seenStudentIds.add(student.id);

        const telegramKey = normalizeTelegramIdentifier(student.telegram || telegramRaw);
        if (telegramKey) {
          if (seenTelegramKeys.has(telegramKey)) errors.push("معرف التليكرام مكرر داخل النص الملصوق");
          seenTelegramKeys.add(telegramKey);
        }

        existingGrade = grades.find((grade) => grade.studentId === student?.id && grade.examId === selectedExam.id) || null;
        if (existingGrade) warnings.push("توجد درجة سابقة لهذا الامتحان وسيتم تحديثها");
        if (student.status === "مفصول") warnings.push("الطالب مفصول حالياً، سيتم حفظ الدرجة فقط بدون تغيير حالة الفصل يدوياً");
      }

      return { rowNumber, rawCells: cells, student, score, existingGrade, errors, warnings };
    });

    setPreviewRows(rows);
    setPreviewDone(true);

    const errorsCount = rows.filter((row) => row.errors.length > 0).length;
    if (errorsCount > 0) toast.error(`المعاينة اكتملت مع ${errorsCount} سطر يحتاج تصحيح`);
    else toast.success(`المعاينة سليمة: ${rows.length} درجة جاهزة للإضافة`);
  };

  const handleBulkImport = async () => {
    if (!selectedExam || !canImport) return;
    const validRows = previewRows.filter((row) => row.student && row.score !== null && row.errors.length === 0);
    if (validRows.length === 0) return;

    setIsImporting(true);
    try {
      const payload = validRows.map((row) => ({
        studentId: row.student!.id,
        examId: selectedExam.id,
        status: "درجة" as const,
        score: row.score,
        notes: "إدخال جماعي",
        academicAccountingChecked: false,
      }));
      const result = bulkAddGrades(payload);
      toast.success(`تم حفظ ${result.added + result.updated} درجة: ${result.added} جديدة، ${result.updated} تحديث`);
      setConfirmOpen(false);
      setPreviewRows([]);
      setPreviewDone(false);
      setRawText("");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/15 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <ClipboardCheck className="h-6 w-6 text-primary" />
                إضافة درجات جماعية
              </CardTitle>
              <CardDescription>
                اختر الامتحان ثم الصق البيانات بثلاثة أعمدة مفصولة بزر Tab: اسم الطالب، معرف التليكرام، الدرجة.
              </CardDescription>
            </div>
            <Badge variant="secondary">معاينة قبل الحفظ</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(240px,360px)_1fr]">
            <div className="space-y-2">
              <Label htmlFor="bulk-grade-exam">اسم الامتحان</Label>
              <Select value={selectedExamId} onValueChange={(value) => {
                setSelectedExamId(value);
                setPreviewDone(false);
                setPreviewRows([]);
              }}>
                <SelectTrigger id="bulk-grade-exam" className="h-11 rounded-2xl">
                  <SelectValue placeholder="اختر الامتحان" />
                </SelectTrigger>
                <SelectContent>
                  {activeExams.length === 0 && <SelectItem value="__none" disabled>لا توجد امتحانات فعالة</SelectItem>}
                  {activeExams.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>{examLabel(exam)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedExam && (
                <div className="rounded-2xl border border-border/70 bg-muted/30 p-3 text-xs leading-6 text-muted-foreground">
                  الدرجة المسموحة: <b>0 - {selectedExam.fullMark}</b>، وعدد الدورات المرتبطة: <b>{selectedExam.courseIds.length}</b>.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="bulk-grade-text">الدرجات</Label>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRawText(SAMPLE_TEXT)}>
                  تعبئة مثال
                </Button>
              </div>
              <textarea
                id="bulk-grade-text"
                value={rawText}
                onChange={(event) => {
                  setRawText(event.target.value);
                  setPreviewDone(false);
                  setPreviewRows([]);
                }}
                placeholder={SAMPLE_TEXT}
                className="min-h-[220px] w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                dir="rtl"
              />
              <p className="text-xs text-muted-foreground">
                لا تضف عناوين أعمدة. كل سطر طالب واحد، والحقول مفصولة بـ Tab مثل النسخ من Excel.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={buildPreview} disabled={!selectedExamId || !rawText.trim()} className="rounded-2xl">
              <Eye className="ml-2 h-4 w-4" />
              معاينة وتحقق
            </Button>
            <Button type="button" onClick={() => setConfirmOpen(true)} disabled={!canImport} className="rounded-2xl">
              <PlusCircle className="ml-2 h-4 w-4" />
              الإضافة الجماعية
            </Button>
          </div>
        </CardContent>
      </Card>

      {previewDone && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
              نتيجة المعاينة
              <Badge variant="secondary">الكل: {summary.total}</Badge>
              <Badge className="bg-emerald-600 hover:bg-emerald-600">جاهز: {summary.valid}</Badge>
              {summary.updates > 0 && <Badge variant="outline">تحديثات: {summary.updates}</Badge>}
              {summary.warningRows > 0 && <Badge variant="outline">تحذيرات: {summary.warningRows}</Badge>}
              {summary.errorRows > 0 && <Badge variant="destructive">أخطاء: {summary.errorRows}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-2xl border">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-right">#</th>
                    <th className="p-3 text-right">الطالب</th>
                    <th className="p-3 text-right">التليكرام</th>
                    <th className="p-3 text-right">الدرجة</th>
                    <th className="p-3 text-right">الحالة</th>
                    <th className="p-3 text-right">الملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => {
                    const telegram = row.student?.telegram || sanitizeTelegramInput(row.rawCells[1] || "");
                    return (
                      <tr key={row.rowNumber} className="border-t align-top">
                        <td className="p-3 text-muted-foreground">{row.rowNumber}</td>
                        <td className="p-3 font-medium">{row.student?.name || row.rawCells[0] || "—"}</td>
                        <td className="p-3 font-mono text-xs">{telegram ? `@${telegram}` : "—"}</td>
                        <td className="p-3 font-semibold">{row.score ?? row.rawCells[2] ?? "—"}</td>
                        <td className="p-3">
                          {row.errors.length > 0 ? <Badge variant="destructive">غير صالح</Badge> : row.existingGrade ? <Badge variant="outline">تحديث</Badge> : <Badge className="bg-emerald-600 hover:bg-emerald-600">جديد</Badge>}
                        </td>
                        <td className="p-3">
                          <div className="space-y-1">
                            {row.errors.map((error) => (
                              <div key={error} className="flex items-start gap-1 text-xs text-destructive">
                                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>{error}</span>
                              </div>
                            ))}
                            {row.warnings.map((warning) => (
                              <div key={warning} className="text-xs text-amber-600">• {warning}</div>
                            ))}
                            {row.errors.length === 0 && row.warnings.length === 0 && <span className="text-xs text-muted-foreground">جاهز للحفظ</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الإضافة الجماعية</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حفظ {summary.valid} درجة للامتحان: {selectedExam?.name || "—"}. الدرجات السابقة لنفس الطالب والامتحان سيتم تحديثها.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isImporting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkImport} disabled={isImporting}>
              {isImporting ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <PlusCircle className="ml-2 h-4 w-4" />}
              نعم، أضف الدرجات
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
