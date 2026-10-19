"use client";

import type { Dispatch, SetStateAction } from "react";
import { type Student } from "@/lib/teacher-store";
import { type StudentDeleteImpactResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { X, Archive, UserX } from "lucide-react";
import { FormDialogHero } from "./form-dialog";
import { formatStudentDeleteImpact } from "./student-registry-helpers";

export type StudentRegistryStatusDialogsProps = {
  deleteDialog: { open: boolean; id: string; studentName: string; };
  setDeleteDialog: Dispatch<SetStateAction<{ open: boolean; id: string; studentName: string; }>>;
  deleteImpactLoading: boolean;
  deleteImpact: StudentDeleteImpactResponse | null;
  handleDeleteConfirm: () => Promise<void>;
  isDeletingStudent: boolean;
  restoreDialog: { student: Student | null; open: boolean; };
  setRestoreDialog: Dispatch<SetStateAction<{ student: Student | null; open: boolean; }>>;
  isStatusActionSaving: boolean;
  handleRestoreArchived: (student: Student) => Promise<void>;
  dismissDialog: { student: Student | null; open: boolean; };
  closeDismissDialog: () => void;
  dismissReason: string;
  setDismissReason: Dispatch<SetStateAction<string>>;
  dismissNotes: string;
  setDismissNotes: Dispatch<SetStateAction<string>>;
  handleDismiss: () => Promise<void>;
};

export function StudentRegistryStatusDialogs({
  deleteDialog,
  setDeleteDialog,
  deleteImpactLoading,
  deleteImpact,
  handleDeleteConfirm,
  isDeletingStudent,
  restoreDialog,
  setRestoreDialog,
  isStatusActionSaving,
  handleRestoreArchived,
  dismissDialog,
  closeDismissDialog,
  dismissReason,
  setDismissReason,
  dismissNotes,
  setDismissNotes,
  handleDismiss,
}: StudentRegistryStatusDialogsProps) {
  return (
    <>
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(o) => setDeleteDialog((prev) => ({ ...prev, open: o }))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>أرشفة الطالب بدل الحذف النهائي</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right leading-relaxed">
                <p>
                  لن يتم حذف الطالب &quot;{deleteDialog.studentName}&quot;
                  نهائياً. سيتم أرشفته وإخفاؤه من القوائم اليومية فقط، مع إبقاء
                  سجلاته وتقاريره محفوظة ويمكن استعادته لاحقاً.
                </p>
                <div className="rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-danger">
                  الحذف النهائي معطّل لحماية الدرجات والإجازات والمكالمات
                  والملاحظات وسجلات الفرص من الضياع أو ظهور حالات “طالب محذوف”.
                </div>
                <div className="rounded-2xl border bg-muted/40 p-3 text-foreground">
                  <div className="mb-2 font-bold">
                    البيانات المرتبطة بالطالب
                  </div>
                  {deleteImpactLoading ? (
                    <div className="text-muted-foreground">
                      جاري فحص بيانات الطالب المرتبطة...
                    </div>
                  ) : formatStudentDeleteImpact(deleteImpact).length > 0 ? (
                    <ul className="list-inside list-disc space-y-1">
                      {formatStudentDeleteImpact(deleteImpact).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : deleteImpact ? (
                    <div className="text-muted-foreground">
                      ماكو علاقات مسجلة، ومع ذلك سيتم استخدام الأرشفة كسلوك
                      آمن.
                    </div>
                  ) : (
                    <div className="text-muted-foreground">
                      تعذر عرض تفاصيل العلاقات حالياً، لكن الأرشفة ستبقى آمنة
                      لأنها لا تحذف السجلات.
                    </div>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="tp-student-registry__confirm-actions">
            <AlertDialogCancel className="tp-student-registry__dialog-button">
              <X aria-hidden="true" className="size-4" />
              إلغاء
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={
                isDeletingStudent ||
                deleteImpactLoading ||
                !deleteImpact?.previewToken
              }
              className="tp-student-registry__dialog-button bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Archive aria-hidden="true" className="size-4" />
              {isDeletingStudent ? "جاري الأرشفة..." : "أرشفة الطالب"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={restoreDialog.open}
        onOpenChange={(open) => {
          if (!open) setRestoreDialog({ student: null, open: false });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد استعادة الطالب من الأرشيف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد استعادة «{restoreDialog.student?.name || "الطالب المحدد"}»
              من الأرشيف؟ هذه العملية مختلفة عن استرجاع الطالب المفصول.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={isStatusActionSaving || !restoreDialog.student}
              onClick={(event) => {
                event.preventDefault();
                if (restoreDialog.student)
                  void handleRestoreArchived(restoreDialog.student);
              }}
            >
              {isStatusActionSaving
                ? "جاري الاستعادة..."
                : "استعادة من الأرشيف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={dismissDialog.open}
        onOpenChange={(o) => {
          if (!o) closeDismissDialog();
        }}
      >
        <DialogContent dir="rtl" className="tp-form-dialog">
          <FormDialogHero icon={UserX} title={`فصل الطالب - ${dismissDialog.student?.name ?? ""}`} />
          <div className="tp-form-dialog__body">
            <div className="rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-sm leading-6 text-danger">
              عند تأكيد الفصل سيصبح الطالب <strong>مفصولاً</strong> وفرصه{" "}
              <strong>0</strong>. لا توجد أنواع أو درجات للفصل، وسجل الفصل
              السابق لا يغيّر هذا القرار.
            </div>
            <div className="space-y-2">
              <Label htmlFor="dismiss-reason">سبب الفصل</Label>
              <Input
                id="dismiss-reason"
                name="dismissReason"
                autoComplete="off"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="سبب الفصل"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dismiss-notes">ملاحظات الفصل</Label>
              <textarea
                id="dismiss-notes"
                name="dismissNotes"
                value={dismissNotes}
                onChange={(e) => setDismissNotes(e.target.value)}
                placeholder="ملاحظات خاصة بالطالب المفصول"
                className="min-h-24 w-full rounded-2xl border bg-background/70 px-3 py-2 text-sm shadow-xs outline-none focus:border-primary"
              />
            </div>
          </div>
          <DialogFooter className="tp-student-registry__confirm-actions">
            <Button
              variant="outline"
              className="tp-student-registry__dialog-button"
              onClick={closeDismissDialog}
            >
              <X aria-hidden="true" className="size-4" />
              إلغاء
            </Button>
            <Button
              variant="destructive"
              className="tp-student-registry__dialog-button border-danger-solid bg-danger-solid text-danger-on shadow-md shadow-danger-vivid/30 hover:border-danger-solid/90 hover:bg-danger-solid/90 hover:text-danger-on"
              onClick={handleDismiss}
              disabled={isStatusActionSaving}
            >
              <UserX aria-hidden="true" className="size-4" />
              {isStatusActionSaving ? "جاري الفصل..." : "تأكيد الفصل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
