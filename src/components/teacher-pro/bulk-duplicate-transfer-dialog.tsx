"use client";

import { useState } from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { studentApi } from "@/lib/api";
import {
  bulkTransferKind,
  type BulkDuplicateMatch,
  type BulkTransferCourse,
} from "@/lib/bulk-duplicate-match";
import { useTeacherStore, type CourseTransferPolicy, type Student } from "@/lib/teacher-store";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";

export type BulkTransferTarget = {
  rowNumber: number;
  match: BulkDuplicateMatch;
  course: BulkTransferCourse;
  newCourseName: string;
};

const ARCHIVED = "مؤرشف";

/**
 * «تحويل يدوي…» inside «إضافة طلاب جماعية»: moves the existing student to
 * the row's course with the same request and rules as «تعديل الطالب».
 * Another course always starts a new file; inside the same course you choose
 * to keep the file or start a new one. On success the row leaves the text.
 */
export function BulkDuplicateTransferDialog({
  target,
  onClose,
  onRemoveRow,
}: {
  target: BulkTransferTarget | null;
  onClose: () => void;
  /** The row is done with: drop it from the pasted text. */
  onRemoveRow: (rowNumber: number) => void;
}) {
  const mergeStudentsCache = useTeacherStore((state) => state.mergeStudentsCache);
  const [policy, setPolicy] = useState<CourseTransferPolicy | "">("");
  const [saving, setSaving] = useState(false);
  const kind = target ? bulkTransferKind(target.match, target.course) : "none";
  const chosenPolicy: CourseTransferPolicy | "" = kind === "course" ? "reset" : policy;

  const close = () => {
    if (saving) return;
    setPolicy("");
    onClose();
  };

  const transfer = async () => {
    if (!target || saving || kind === "none" || !chosenPolicy) return;
    setSaving(true);
    try {
      // The latest record and its token, so a change made meanwhile is refused.
      const snapshot = await studentApi.editSnapshot(target.match.id).catch(() => null);
      const current = snapshot?.student as unknown as Student | undefined;
      if (!current || current.id !== target.match.id || !current.mutationToken) {
        toast.error("تعذر تحميل الطالب. تحقق من الاتصال وأعد المحاولة.");
        return;
      }
      if (current.status === ARCHIVED) {
        toast.error(`${current.name} مؤرشف؛ استعده أو الغِ انسحابه أولاً.`);
        return;
      }
      const { course } = target;
      const result = await studentApi.update(current.id, {
        courseTransferPolicy: chosenPolicy,
        expectedMutationToken: current.mutationToken,
        courseId: course.courseId,
        courseProgram: course.courseProgram,
        courseTerm: course.courseTerm,
        studyType: course.studyType,
        locationScope: course.locationScope,
        mainSite: course.locationScope,
        baghdadMode: course.baghdadMode,
        subSite: course.subSite,
      });
      if (!result.ok) {
        toast.error(
          result.outcomeUnknown
            ? "ما وصلت نتيجة الحفظ؛ تأكد من دورة الطالب بـ«سجل الطلاب» قبل ما تعيد."
            : result.error || "تعذر تحويل الطالب.",
        );
        return;
      }
      const updated = (result.data as { student?: Student } | null)?.student;
      if (updated) mergeStudentsCache([updated]);
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "bulk-duplicate-transfer",
        scopes: ["students", "opportunities", "dashboard", "logs"],
      });
      toast.success(`تم تحويل ${current.name} إلى ${target.newCourseName || "الدورة الجديدة"}`, {
        description: chosenPolicy === "reset" ? "بدأ بملف جديد." : "بقي ملفه كما هو.",
      });
      onRemoveRow(target.rowNumber);
      setPolicy("");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => { if (!open) close(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>تحويل «{target?.match.name}»؟</AlertDialogTitle>
          <AlertDialogDescription>
            الدورة الحالية: {target?.match.courseName || "—"} ← الجديدة: {target?.newCourseName || "—"}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {kind === "course" ? (
          <p className="text-sm leading-7">
            دورة مختلفة: يتحول <b>كطالب جديد</b>؛ ملفه الحالي يتأرشف ويبدأ ملف جديد بفرص الفصل النشط للدورة الجديدة.
          </p>
        ) : kind === "context" ? (
          <RadioGroup
            value={policy}
            onValueChange={(value) => setPolicy(value as CourseTransferPolicy)}
            className="grid gap-2"
            aria-label="نوع التحويل"
          >
            <Label className="flex items-start gap-2 rounded-lg border p-3 font-normal leading-6">
              <RadioGroupItem value="keep" className="mt-1" />
              <span><b>الإبقاء على ملفه</b>: تتحدث بيانات الدراسة وتبقى درجاته وفرصه.</span>
            </Label>
            <Label className="flex items-start gap-2 rounded-lg border p-3 font-normal leading-6">
              <RadioGroupItem value="reset" className="mt-1" />
              <span><b>البدء كطالب جديد</b>: ملفه الحالي يتأرشف ويبدأ ملف جديد.</span>
            </Label>
          </RadioGroup>
        ) : (
          <p className="text-sm leading-7">نفس الدورة ونفس بيانات الدراسة؛ ماكو شي يتحول. تگدر تشيل السطر من الإضافة.</p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>إلغاء</AlertDialogCancel>
          {kind === "none" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (target) onRemoveRow(target.rowNumber);
                close();
              }}
            >
              شيل السطر
            </Button>
          ) : (
            <Button type="button" onClick={() => void transfer()} disabled={saving || !chosenPolicy}>
              {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <ArrowLeftRight aria-hidden="true" className="size-4" />}
              {kind === "course" ? "تأكيد النقل كطالب جديد" : "تأكيد التحويل"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
