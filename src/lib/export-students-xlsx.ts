/**
 * export-students-xlsx.ts — تصدير بيانات الطلاب إلى ملف Excel (.xlsx)
 * ينتج ملفاً يحتوي على:
 *   - ورقة "الطلاب": كل بيانات الطلاب (بنفس بنية قالب الاستيراد)
 *   - ورقة "الدرجات": درجات كل طالب
 *   - ورقة "حركات الفرص": سجل خصومات/إضافات الفرص
 *   - ورقة "الإجازات": إجازات الطلاب
 *   - ورقة "الملاحظات": ملاحظات الطلاب (تشمل التعهدات والإجراءات)
 */

import * as XLSX from "xlsx";
import type {
  Student,
  Course,
  Exam,
  Grade,
  OpportunityLog,
  StudentLeave,
  StudentNote,
  StudentCall,
} from "@/lib/teacher-store";
import { formatAppDate } from "@/lib/format";

type ExportData = {
  students: Student[];
  courses: Course[];
  exams: Exam[];
  grades: Grade[];
  opportunityLogs: OpportunityLog[];
  studentLeaves: StudentLeave[];
  studentNotes: StudentNote[];
  studentCalls: StudentCall[];
  courseName: (id: string) => string;
  examName: (id: string) => string;
};

function safe(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return "";
  return formatAppDate(value);
}

/** بناء صف لكل طالب بنفس بنية قالب الاستيراد */
function buildStudentRow(student: Student, courseName: (id: string) => string) {
  return {
    "اسم الطالب": safe(student.name),
    "كود الطالب": safe(student.code),
    "الجنس": safe(student.gender),
    "اسم الدورة": courseName(student.courseId) || safe(student.courseId),
    "المدرسة": safe(student.school),
    "رقم الهاتف": safe(student.phone),
    "رقم ولي الأمر": safe(student.parentPhone),
    "تليقرام": safe(student.telegram),
    "نوع الدورة": safe(student.courseProgram),
    "الكورس": safe(student.courseTerm),
    "نوع الدراسة": safe(student.studyType),
    "الموقع العام": safe(student.locationScope),
    "نمط بغداد": safe(student.baghdadMode),
    "الموقع الرئيسي": safe(student.mainSite),
    "الموقع الفرعي": safe(student.subSite),
    "حالة الطالب": safe(student.status),
    "الفرص الحالية": student.opportunities ?? 0,
    "الفرص الأساسية": student.baseOpportunities ?? 0,
    "أيام السماح": student.accountingGraceDays ?? 0,
    "تاريخ التسجيل": dateOnly(student.createdAt),
    "نوع الفصل": safe(student.dismissalType),
    "سبب الفصل": safe(student.dismissalReason),
    "ملاحظات الفصل": safe(student.dismissalNotes),
    "المعرف": safe(student.id),
  };
}

function buildGradeRow(
  grade: Grade,
  students: Student[],
  exams: Exam[],
): Record<string, string | number> {
  const student = students.find((s) => s.id === grade.studentId);
  const exam = exams.find((e) => e.id === grade.examId);
  return {
    "كود الطالب": safe(student?.code),
    "اسم الطالب": safe(student?.name),
    "اسم الامتحان": safe(exam?.name),
    "نوع الامتحان": safe(exam?.type),
    "تاريخ الامتحان": dateOnly(exam?.date),
    "الدرجة الكاملة": exam?.fullMark ?? "",
    "درجة النجاح": exam?.passMark ?? "",
    "درجة الخصم": exam?.discountMark ?? "",
    "الحالة": safe(grade.status),
    "الدرجة": grade.score ?? "",
    "ملاحظات": safe(grade.notes),
    "تاريخ الإدخال": dateOnly(grade.createdAt),
  };
}

function buildOpportunityRow(
  log: OpportunityLog,
  students: Student[],
  exams: Exam[],
): Record<string, string | number> {
  const student = students.find((s) => s.id === log.studentId);
  const exam = exams.find((e) => e.id === log.examId);
  return {
    "كود الطالب": safe(student?.code),
    "اسم الطالب": safe(student?.name),
    "التاريخ": dateOnly(log.date),
    "النوع": safe(log.action),
    "القيمة": log.amount,
    "الامتحان": safe(exam?.name),
    "السبب": safe(log.reason),
    "الفصل": safe(log.chapterId),
  };
}

function buildLeaveRow(
  leave: StudentLeave,
  students: Student[],
  exams: Exam[],
): Record<string, string> {
  const student = students.find((s) => s.id === leave.studentId);
  const exam = exams.find((e) => e.id === leave.examId);
  return {
    "كود الطالب": safe(student?.code),
    "اسم الطالب": safe(student?.name),
    "الامتحان": safe(exam?.name),
    "نوع الإجازة": safe(leave.leaveType),
    "من تاريخ": dateOnly(leave.dateFrom),
    "إلى تاريخ": dateOnly(leave.dateTo),
    "السبب": safe(leave.reason),
  };
}

function buildNoteRow(
  note: StudentNote,
  students: Student[],
): Record<string, string> {
  const student = students.find((s) => s.id === note.studentId);
  return {
    "كود الطالب": safe(student?.code),
    "اسم الطالب": safe(student?.name),
    "التاريخ": dateOnly(note.date),
    "النوع": safe(note.kind),
    "النص": safe(note.text),
    "نوع الفصل المرتبط": safe(note.dismissalType),
    "سبب الفصل المرتبط": safe(note.dismissalReason),
    "تاريخ الفصل المرتبط": dateOnly(note.dismissalDate),
  };
}

function buildCallRow(
  call: StudentCall,
  students: Student[],
  exams: Exam[],
): Record<string, string> {
  const student = students.find((s) => s.id === call.studentId);
  const exam = exams.find((e) => e.id === call.examId);
  return {
    "كود الطالب": safe(student?.code),
    "اسم الطالب": safe(student?.name),
    "الامتحان": safe(exam?.name),
    "التصنيف": safe(call.category),
    "الحالة": safe(call.status),
    "تم الاتصال": call.completed ? "نعم" : "لا",
    "تاريخ المكالمة": dateOnly(call.createdAt),
    "ملاحظات": safe(call.notes),
  };
}

function autoSizeColumns(ws: XLSX.WorkSheet) {
  const colWidths: { wch: number }[] = [];
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let col = range.s.c; col <= range.e.c; col++) {
    let maxLen = 10;
    for (let row = range.s.r; row <= range.e.r; row++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellRef];
      if (cell && cell.v !== undefined) {
        const len = String(cell.v).length;
        if (len > maxLen) maxLen = Math.min(len, 50);
      }
    }
    colWidths.push({ wch: maxLen + 2 });
  }
  ws["!cols"] = colWidths;
}

export function exportStudentsXlsx(data: ExportData) {
  const {
    students,
    courses,
    exams,
    grades,
    opportunityLogs,
    studentLeaves,
    studentNotes,
    studentCalls,
    courseName,
    examName,
  } = data;

  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: "TeacherPro - بيانات الطلاب",
    Author: "TeacherPro",
    CreatedDate: new Date(),
  };

  // ورقة الطلاب
  const studentRows = students.map((s) => buildStudentRow(s, courseName));
  const wsStudents = XLSX.utils.json_to_sheet(
    studentRows.length > 0
      ? studentRows
      : [{ "اسم الطالب": "لا يوجد طلاب", "كود الطالب": "" }],
    { origin: "A1" },
  );
  wsStudents["!dir"] = 1; // RTL
  autoSizeColumns(wsStudents);
  XLSX.utils.book_append_sheet(wb, wsStudents, "الطلاب");

  // ورقة الدرجات
  const gradeRows = grades.map((g) => buildGradeRow(g, students, exams));
  const wsGrades = XLSX.utils.json_to_sheet(
    gradeRows.length > 0
      ? gradeRows
      : [{ "كود الطالب": "لا توجد درجات" }],
  );
  wsGrades["!dir"] = 1;
  autoSizeColumns(wsGrades);
  XLSX.utils.book_append_sheet(wb, wsGrades, "الدرجات");

  // ورقة حركات الفرص
  const oppRows = opportunityLogs.map((l) =>
    buildOpportunityRow(l, students, exams),
  );
  const wsOpp = XLSX.utils.json_to_sheet(
    oppRows.length > 0
      ? oppRows
      : [{ "كود الطالب": "لا توجد حركات فرص" }],
  );
  wsOpp["!dir"] = 1;
  autoSizeColumns(wsOpp);
  XLSX.utils.book_append_sheet(wb, wsOpp, "حركات الفرص");

  // ورقة الإجازات
  const leaveRows = studentLeaves.map((l) =>
    buildLeaveRow(l, students, exams),
  );
  const wsLeaves = XLSX.utils.json_to_sheet(
    leaveRows.length > 0
      ? leaveRows
      : [{ "كود الطالب": "لا توجد إجازات" }],
  );
  wsLeaves["!dir"] = 1;
  autoSizeColumns(wsLeaves);
  XLSX.utils.book_append_sheet(wb, wsLeaves, "الإجازات");

  // ورقة الملاحظات
  const noteRows = studentNotes.map((n) => buildNoteRow(n, students));
  const wsNotes = XLSX.utils.json_to_sheet(
    noteRows.length > 0
      ? noteRows
      : [{ "كود الطالب": "لا توجد ملاحظات" }],
  );
  wsNotes["!dir"] = 1;
  autoSizeColumns(wsNotes);
  XLSX.utils.book_append_sheet(wb, wsNotes, "الملاحظات");

  // ورقة المكالمات
  const callRows = studentCalls.map((c) =>
    buildCallRow(c, students, exams),
  );
  const wsCalls = XLSX.utils.json_to_sheet(
    callRows.length > 0
      ? callRows
      : [{ "كود الطالب": "لا توجد مكالمات" }],
  );
  wsCalls["!dir"] = 1;
  autoSizeColumns(wsCalls);
  XLSX.utils.book_append_sheet(wb, wsCalls, "المكالمات");

  // توليد الملف وتحميله
  const fileName = `teacherpro-students-${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName, { bookType: "xlsx", type: "binary" });
}
