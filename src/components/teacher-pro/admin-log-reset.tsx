"use client";

import React, { useState } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTeacherStore } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function AdminLogResetView() {
  const { clearLogs, currentUser } = useTeacherStore();
  const [password, setPassword] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const user = currentUser();
  const isAdmin = user?.username?.trim().toLowerCase() === "admin" || user?.roleId === "role_admin";

  const requestReset = () => {
    if (!password.trim()) {
      toast.error("أدخل الباسوورد الخاص أولاً");
      return;
    }
    setConfirmOpen(true);
  };

  const handleReset = async () => {
    setLoading(true);
    const result = await clearLogs(password);
    setLoading(false);
    if (result.ok) {
      setPassword("");
      setConfirmOpen(false);
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  if (!isAdmin) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-6 text-center text-sm font-semibold text-destructive">
          هذه التبويبة خاصة بمدير النظام فقط.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="border-destructive/25 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            تصفير سجلات النظام
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-2xl border border-destructive/20 bg-background/70 p-4 text-sm leading-7 text-muted-foreground">
            هذا الإجراء يحذف جميع سجلات الـ log من قاعدة البيانات ولا يمكن التراجع عنه.
            لا يتم التنفيذ إلا بعد إدخال الباسوورد الخاص ثم تأكيد العملية.
          </div>

          <div className="space-y-2">
            <Label htmlFor="log-reset-password">الباسوورد الخاص</Label>
            <Input
              id="log-reset-password"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="أدخل الباسوورد الخاص"
              className="h-12 rounded-2xl text-center text-lg tracking-[0.35em]"
              onKeyDown={(event) => {
                if (event.key === "Enter") requestReset();
              }}
            />
          </div>

          <Button
            type="button"
            variant="destructive"
            className="h-12 w-full rounded-2xl text-base font-black"
            onClick={requestReset}
            disabled={loading}
          >
            <Trash2 className="ml-2 h-4 w-4" />
            تصفير الlog
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد تصفير الlog</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف جميع سجلات العمليات والتدقيق نهائياً. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleReset();
              }}
              disabled={loading}
            >
              {loading ? "جاري التصفير..." : "نعم، صفّر الlog"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
