"use client";

import type React from "react";
import { type Student } from "@/lib/teacher-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { CalendarCheck, ScanLine } from "lucide-react";
import { FormDialogHero } from "@/components/teacher-pro/form-dialog";
import { type Exam } from "@/lib/teacher-store";
import { type PendingConfirm } from "./grade-entry-shared";

export type GradeEntryDialogsProps = {
  pendingConfirm: PendingConfirm | null;
  setPendingConfirm: React.Dispatch<React.SetStateAction<PendingConfirm | null>>;
  leaveRequest: { studentId: string; reason: string; } | null;
  leaveSaving: boolean;
  setLeaveRequest: React.Dispatch<React.SetStateAction<{ studentId: string; reason: string; } | null>>;
  leaveRequestStudent: Student | undefined;
  selectedExam: Exam | undefined;
  saveExamLeave: () => Promise<void>;
  quickScanOpen: boolean;
  setQuickScanOpen: React.Dispatch<React.SetStateAction<boolean>>;
  quickScanValue: string;
  setQuickScanValue: React.Dispatch<React.SetStateAction<string>>;
  submitQuickScan: () => void;
};

export function GradeEntryDialogs({
  pendingConfirm,
  setPendingConfirm,
  leaveRequest,
  leaveSaving,
  setLeaveRequest,
  leaveRequestStudent,
  selectedExam,
  saveExamLeave,
  quickScanOpen,
  setQuickScanOpen,
  quickScanValue,
  setQuickScanValue,
  submitQuickScan,
}: GradeEntryDialogsProps) {
  return (
    <>
      <AlertDialog
        open={Boolean(pendingConfirm)}
        onOpenChange={(open) => {
          if (open) return;
          pendingConfirm?.onCancel?.();
          setPendingConfirm(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingConfirm?.title || "تأكيد العملية"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className={
                pendingConfirm?.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => {
                const action = pendingConfirm?.onConfirm;
                setPendingConfirm(null);
                action?.();
              }}
            >
              {pendingConfirm?.confirmLabel || "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={Boolean(leaveRequest)}
        onOpenChange={(open) => {
          if (!open && !leaveSaving) setLeaveRequest(null);
        }}
      >
        <DialogContent dir="rtl" className="tp-form-dialog">
          <FormDialogHero
            icon={CalendarCheck}
            title={<>مجاز: {leaveRequestStudent?.name}</>}
            description={`تنسجل إجازة لهذا الامتحان بس (${selectedExam?.name || ""}). إذا عنده درجة عليه تنحفظ نسخة منها وترجع إذا انشالت الإجازة.`}
          />
          <div className="tp-form-dialog__body gap-2">
            <Label htmlFor="grade-entry-leave-reason">سبب الإجازة</Label>
            <Input
              id="grade-entry-leave-reason"
              autoFocus
              value={leaveRequest?.reason || ""}
              onChange={(event) =>
                setLeaveRequest((prev) => (prev ? { ...prev, reason: event.target.value } : prev))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveExamLeave();
              }}
              placeholder="مثلاً: مراجعة طبية"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setLeaveRequest(null)} disabled={leaveSaving}>
              إلغاء
            </Button>
            <Button type="button" onClick={() => void saveExamLeave()} disabled={leaveSaving}>
              {leaveSaving ? "جارٍ الحفظ..." : "تسجيل مجاز"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={quickScanOpen} onOpenChange={setQuickScanOpen}>
        <DialogContent dir="rtl" className="tp-form-dialog">
          <FormDialogHero
            icon={ScanLine}
            title="بحث / مسح QR"
            description="امسح QR/باركود أو اكتب كود الطالب للبحث."
          />
          <div className="tp-form-dialog__body">
            <Input
              autoFocus
              aria-label="كود الطالب"
              value={quickScanValue}
              onChange={(event) => setQuickScanValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitQuickScan();
              }}
              placeholder="كود الطالب أو النص المقروء من الماسح"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setQuickScanOpen(false)}
            >
              إلغاء
            </Button>
            <Button type="button" onClick={submitQuickScan}>
              بحث
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
