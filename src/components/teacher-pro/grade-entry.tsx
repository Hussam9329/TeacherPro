"use client";

import React, { useState, useMemo } from "react";
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
import { toast } from "sonner";
import { toLatinDigits } from "@/lib/format";
import { useActionLock } from "@/hooks/use-action-lock";

export function GradeEntryView() {
  const {
    exams,
    students,
    grades,
    addGrade,
    updateGrade,
    courseName,
    classification,
  } = useTeacherStore();
  const { locked: isSavingGrade, runLocked: runSaveGradeLocked } =
    useActionLock();

  const [selectedExamId, setSelectedExamId] = useState("");

  const selectedExam = exams.find((e) => e.id === selectedExamId);
  const activeExams = exams.filter((e) => e.active);

  // Get students for the selected exam
  const examStudents = useMemo(() => {
    if (!selectedExam) return [];
    return students
      .filter(
        (s) =>
          selectedExam.courseIds.includes(s.courseId) && s.status === "نشط",
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [selectedExam, students]);

  // Get or create grade for student
  const getGrade = (studentId: string) =>
    grades.find(
      (g) => g.studentId === studentId && g.examId === selectedExamId,
    );

  const [editGrade, setEditGrade] = useState<string | null>(null);
  const [editScore, setEditScore] = useState("");
  const [editStatus, setEditStatus] = useState("درجة");
  const [editNotes, setEditNotes] = useState("");

  const handleSaveGrade = runSaveGradeLocked(async (studentId: string) => {
    if (!selectedExamId) return;

    const status = editStatus as "درجة" | "غائب" | "مجاز" | "غش";
    const score = status === "درجة" ? Number(editScore) || 0 : null;

    addGrade({
      studentId,
      examId: selectedExamId,
      status,
      score,
      accountingChecked: false,
      notes: editNotes,
    });

    setEditGrade(null);
    setEditScore("");
    setEditNotes("");
    toast.success("تم حفظ الدرجة");
  });

  const startEdit = (studentId: string) => {
    const existing = getGrade(studentId);
    setEditGrade(studentId);
    setEditStatus(existing?.status || "درجة");
    setEditScore(existing?.score?.toString() || "");
    setEditNotes(existing?.notes || "");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>تسجيل الدرجات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="grade-entry-exam">اختر الامتحان</Label>
              <Select name="examId" value={selectedExamId} onValueChange={setSelectedExamId}>
                <SelectTrigger id="grade-entry-exam">
                  <SelectValue placeholder="اختر الامتحان" />
                </SelectTrigger>
                <SelectContent>
                  {activeExams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} ({e.type}) - {e.date}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedExam && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-2xl bg-muted/60">
                <div>
                  <span className="text-muted-foreground text-xs">النوع:</span>{" "}
                  <Badge>{selectedExam.type}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">النجاح:</span>{" "}
                  {selectedExam.passMark}
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">الخصم:</span>{" "}
                  {selectedExam.discountMark}
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">الفصل:</span>{" "}
                  {selectedExam.dismissalGrade || "لا يوجد"}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Grade Entry Table */}
      {selectedExam && (
        <Card>
          <CardHeader>
            <CardTitle>إدخال الدرجات - {examStudents.length} طالب</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {examStudents.map((student) => {
                const grade = getGrade(student.id);
                const isEditing = editGrade === student.id;
                const cls = grade ? classification(grade, selectedExam) : null;

                return (
                  <div
                    key={student.id}
                    className="p-3 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {student.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {student.code} - {courseName(student.courseId)}
                        </p>
                      </div>

                      {grade && !isEditing && (
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              cls?.type === "ok"
                                ? "default"
                                : cls?.type === "danger"
                                  ? "destructive"
                                  : cls?.type === "warn"
                                    ? "secondary"
                                    : "outline"
                            }
                          >
                            {cls?.text || grade.status}
                          </Badge>
                          {grade.score !== null && (
                            <span className="text-sm font-bold">
                              {grade.score}/{selectedExam.fullMark}
                            </span>
                          )}
                        </div>
                      )}

                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Select
                            name={`status-${student.id}`}
                            value={editStatus}
                            onValueChange={setEditStatus}
                          >
                            <SelectTrigger
                              id={`grade-entry-status-${student.id}`}
                              className="w-28 h-8"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="درجة">درجة</SelectItem>
                              <SelectItem value="غائب">غائب</SelectItem>
                              <SelectItem value="مجاز">مجاز</SelectItem>
                              <SelectItem value="غش">غش</SelectItem>
                            </SelectContent>
                          </Select>
                          {editStatus === "درجة" && (
                            <Input
                              id={`grade-entry-score-${student.id}`}
                              name={`score-${student.id}`}
                              type="number"
                              autoComplete="off"
                              className="w-20 h-8"
                              value={editScore}
                              onChange={(e) =>
                                setEditScore(toLatinDigits(e.target.value))
                              }
                              placeholder="الدرجة"
                              title="اكتب درجة الطالب رقماً فقط"
                            />
                          )}
                          <Input
                            id={`grade-entry-notes-${student.id}`}
                            name={`notes-${student.id}`}
                            autoComplete="off"
                            className="w-32 h-8"
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            placeholder="ملاحظات"
                            title="اكتب سبب الإجازة أو أي ملاحظة إدارية مهمة"
                          />
                          <Button
                            size="sm"
                            onClick={() => handleSaveGrade(student.id)}
                            disabled={isSavingGrade}
                            title="يحفظ الدرجة ويطبق القوانين تلقائياً"
                          >
                            {isSavingGrade ? "جاري الحفظ..." : "حفظ"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditGrade(null)}
                            title="يغلق الإدخال بدون حفظ تغيير جديد"
                          >
                            إلغاء
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(student.id)}
                        >
                          {grade ? "تعديل" : "إدخال"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
