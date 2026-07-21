export type StudentStatus = "نشط" | "مفصول" | "مؤرشف";
export type GradeStatus =
  | "درجة"
  | "غائب"
  | "غش"
  | "مجاز"
  | "ضمن فترة السماح"
  | "قبل تسجيل الطالب";
export type ExamType = "يومي" | "تراكمي" | "فاينل";
export type StudentLeaveType = "exam" | "period";

export interface AcademicCourseChapter {
  id: string;
  courseId: string;
  chapterId: string;
  active: boolean;
  archived: boolean;
}

export interface AcademicChapter {
  id: string;
  name: string;
  opportunities: number;
}

export interface AcademicStudent {
  id: string;
  courseId: string;
  status: StudentStatus;
  dismissalType: string;
  dismissalReason: string;
  dismissalNotes?: string;
  opportunities: number;
  baseOpportunities: number;
  createdAt: string;
  accountingGraceDays: number;
  gracePeriodStartDate?: string | null;
}

export interface AcademicExam {
  id: string;
  name: string;
  type: ExamType;
  date: string;
  fullMark: number;
  passMark: number;
  discountMark: number;
  opportunitiesPenalty: number | "فصل مؤقت";
  dismissalGrade: number | null;
  noDiscount: boolean;
  active: boolean;
  scheduledActivateAt?: string | null;
  scheduledDeactivateAt?: string | null;
  courseIds?: string[]; // الامتحانات قد تكون مرتبطة بأكثر من دورة
}

export interface AcademicGrade {
  id: string;
  studentId: string;
  examId: string;
  status: GradeStatus;
  score: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcademicOpportunityLog {
  id: string;
  studentId: string;
  examId: string;
  action: string;
  amount: number;
  reason: string;
  date: string;
  chapterId: string;
  chapterNameSnapshot?: string;
}

export interface AcademicStudentLeave {
  id: string;
  studentId: string;
  examId: string;
  leaveType: StudentLeaveType;
  reason: string;
  studyType: string;
  date: string;
  dateFrom: string;
  dateTo: string;
  notes: string;
  student?: Partial<AcademicStudent> | null;
  exam?: Partial<AcademicExam> | null;
}

export interface AcademicStudentNote {
  id: string;
  studentId: string;
  kind: string;
  text: string;
  date: string;
}

export interface AcademicReactivationLink {
  sourceGradeId: string;
  sourceExamId: string;
  sourceAutomaticLogId: string;
  reactivationMode: string;
}

export interface AcademicStateInput {
  students: AcademicStudent[];
  grades: AcademicGrade[];
  exams: AcademicExam[];
  courseChapters: AcademicCourseChapter[];
  chapters: AcademicChapter[];
  opportunityLogs: AcademicOpportunityLog[];
  studentLeaves: AcademicStudentLeave[];
  studentNotes: AcademicStudentNote[];
}

export interface AcademicRecalculationResult {
  students: AcademicStudent[];
  opportunityLogs: AcademicOpportunityLog[];
}

export type GradeImpactType =
  | "none"
  | "discount"
  | "temporary_dismissal"
  | "final_dismissal";

export interface GradeImpact {
  type: GradeImpactType;
  reason: string;
  penalty: number;
  priority: number;
}
