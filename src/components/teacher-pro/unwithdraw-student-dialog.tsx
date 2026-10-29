"use client";

import { UserCheck } from "lucide-react";
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
import { studentApi } from "@/lib/api";
import type { Student } from "@/lib/teacher-store";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { statusBeforeWithdrawal, unwithdrawnStudentName } from "@/lib/withdrawal-rules";

/**
 * «الغاء الانسحاب؟»: confirms, then removes «انسحاب» from an archived
 * student's name and returns them to the state they held before withdrawal.
 * Used on archived students' cards in «سجل الطلاب».
 */
export function UnwithdrawStudentDialog({
  student,
  onClose,
  onDone,
}: {
  student: Student | null;
  onClose: () => void;
  onDone: (student: Student | null) => void;
}) {
  const name = student ? unwithdrawnStudentName(student.name) : null;
  const status = student ? statusBeforeWithdrawal(student) : "نشط";

  const confirm = async () => {
    if (!student) return;
    const result = await studentApi.unwithdraw(student.id);
    if (!result.ok) {
      toast.error(result.error || "تعذر الغاء انسحاب الطالب.");
      return;
    }
    const updated = (result.data as { student?: Student } | null)?.student ?? null;
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: "student-unwithdrawal",
      scopes: ["students", "follow-up", "dismissed", "dashboard"],
    });
    toast.success(`تم الغاء انسحاب ${updated?.name || name} ورجع ${updated?.status || status}.`);
    onClose();
    onDone(updated);
  };

  return (
    <AlertDialog open={Boolean(student)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>الغاء انسحاب «{student?.name}»؟</AlertDialogTitle>
          <AlertDialogDescription>
            راح يصير اسمه «{name}» ويطلع من الأرشيف ويرجع {status} مثل ما كان قبل الانسحاب،
            وينعاد احتساب ملفه حسب الفصل النشط.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>
            <UserCheck className="size-4" aria-hidden="true" />
            الغاء الانسحاب
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
