import { db } from '@/lib/db';
import { gradeSettlementExclusion } from './grade-settlement';
/** Read-only annotations: never persist these derived fields into Grade. */
export async function annotateGradeSettlementEffects<T extends { id: string; studentId: string; examId: string; notes?: string | null }>(grades: T[]): Promise<void> {
 if (!grades.length) return;
 const studentIds = [...new Set(grades.map(g => g.studentId))];
 const [logs, students, exams, links] = await Promise.all([
  db.opportunityLog.findMany({ where: { studentId: { in: studentIds }, OR: [{ ledgerVersion: 2 }, { reason: { startsWith: 'تسوية تاريخية:' } }] }, select: { id: true, studentId: true, action: true, reason: true, date: true, chapterId: true, ledgerVersion: true, settledGradeIds: true }, orderBy: { date: 'asc' } }),
  db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, courseId: true } }),
  db.exam.findMany({ where: { id: { in: [...new Set(grades.map(g => g.examId))] } }, select: { id: true, date: true } }),
  db.courseChapter.findMany({ where: { active: true, archived: false }, select: { courseId: true, chapterId: true } }),
 ]);
 const examsById = new Map(exams.map(e => [e.id, e]));
 const chapterByCourse = new Map(links.map(l => [l.courseId, l.chapterId]));
 const chapterByStudent = new Map(students.map(s => [s.id, chapterByCourse.get(s.courseId)]));
 const logsByStudent = new Map<string, typeof logs>();
 for (const log of logs) { const group = logsByStudent.get(log.studentId) || []; group.push(log); logsByStudent.set(log.studentId, group); }
 for (const grade of grades) {
  const reason = gradeSettlementExclusion(grade, examsById.get(grade.examId) || {}, logsByStudent.get(grade.studentId), chapterByStudent.get(grade.studentId));
  Object.assign(grade, { effectiveImpactExcluded: Boolean(reason), effectiveImpactExclusionReason: reason });
 }
}
