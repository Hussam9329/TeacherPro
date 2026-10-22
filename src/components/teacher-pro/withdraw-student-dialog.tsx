"use client";

import { UserMinus } from "lucide-react";
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
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";

/** Same rule as the server: «انسحاب» is added once, at the end of the name. */
function withdrawnName(name: string): string {
  const trimmed = name.trim();
  return /(^|\s)انسحاب$/.test(trimmed) ? trimmed : `${trimmed} انسحاب`;
}

/**
 * «انسحاب؟»: confirms, then adds «انسحاب» to the student's name and archives
 * them. Used by «اغلاق الكودات» and «إدارة ملاحظات المكالمات».
 */
export function WithdrawStudentDialog({
  student,
  onClose,
  onDone,
}: {
  student: { id: string; name: string } | null;
  onClose: () => void;
  onDone: (studentId: string) => void;
}) {
  const confirm = async () => {
    if (!student) return;
    const result = await studentApi.withdraw(student.id);
    if (!result.ok) {
      toast.error(result.error || "تعذر تسجيل انسحاب الطالب.");
      return;
    }
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: "student-withdrawal",
      scopes: ["students", "follow-up", "dismissed", "dashboard"],
    });
    toast.success(`تم تسجيل انسحاب ${student.name} وأرشفته.`);
    onClose();
    onDone(student.id);
  };

  return (
    <AlertDialog open={Boolean(student)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>انسحاب «{student?.name}»؟</AlertDialogTitle>
          <AlertDialogDescription>
            راح يصير اسمه «{student ? withdrawnName(student.name) : ""}» وينأرشف: يختفي من القوائم وفرصه تصير 0.
            تكدر ترجعه بعدين بـ«استعادة من الأرشيف».
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            <UserMinus className="size-4" aria-hidden="true" />
            انسحاب
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
