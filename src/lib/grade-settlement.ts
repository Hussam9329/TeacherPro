import { baghdadDateKey } from './baghdad-time';
type Ledger = { id?: string; studentId?: string; action?: string; date?: string | Date; reason?: string | null; chapterId?: string | null; ledgerVersion?: number | null; settledGradeIds?: string | null };
export function historicalGradeExclusion(grade: { notes?: string | null }, exam: { date?: string | Date | null }, boundary?: string | null): string | null {
 if (String(grade.notes || '').startsWith('تسوية تاريخية بلا أثر:')) return 'درجة تاريخية محفوظة بلا أثر على الرصيد';
 if (boundary && !String(grade.notes || '').startsWith('أثر أكاديمي فعّال بعد التسوية:') && baghdadDateKey(exam.date) && baghdadDateKey(exam.date) <= boundary) return 'امتحان سابق لحد التسوية التاريخية';
 return null;
}
/** Shared explanation for historical/structured settlements. Educational scores
 * remain visible; this only describes whether they may affect today's balance. */
export function gradeSettlementExclusion(
 grade: { id?: string; studentId?: string; notes?: string | null },
 exam: { date?: string | Date | null },
 logs: readonly Ledger[] = [],
 chapterId?: string | null,
): string | null {
 if (String(grade.notes || '').startsWith('تسوية تاريخية بلا أثر:')) return 'درجة تاريخية محفوظة بلا أثر على الرصيد';
 const ordered = logs.filter(l => !grade.studentId || l.studentId === grade.studentId).sort((a,b) => String(a.date).localeCompare(String(b.date)));
 const settlement = ordered.filter(l => l.ledgerVersion === 2 && (!chapterId || l.chapterId === chapterId) &&
  ['إعادة تعيين','رصيد إعادة التفعيل','رصيد بعد تعهد'].includes(l.action || '')).at(-1);
 if (settlement?.settledGradeIds && grade.id) {
  try { if (JSON.parse(settlement.settledGradeIds).includes(grade.id)) return 'شملتها تسوية الرصيد أو إعادة التفعيل'; } catch { /* engine rejects corrupt ledgers; presentation does not invent an effect */ }
 }
 const legacyBoundary = ordered.filter(l => String(l.reason || '').startsWith('تسوية تاريخية:')).at(-1);
 const boundary = legacyBoundary && (!settlement || String(settlement.date) < String(legacyBoundary.date)) ? baghdadDateKey(legacyBoundary.date) : '';
 return historicalGradeExclusion(grade, exam, boundary);
}
