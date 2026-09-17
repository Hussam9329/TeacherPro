#!/usr/bin/env node
// Read-only planner. Takes an exported snapshot; never opens a database.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');
const projectRoot = path.resolve(__dirname, '..');
const REPAIR_ID = 'retained_dismissal_20260917_v1';
const REVIEWED_ARCHIVE_CODES = new Set(['BIO-915', 'BIO-1309', 'BIO-2462', 'BIO-2753']);
const REVIEWED_TRANSITION_CODES = new Set(['BIO-663', 'BIO-1301', 'BIO-859', 'BIO-860', 'BIO-1620']);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(projectRoot, 'src', request.slice(2)) : request, parent, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { recalculateAcademicState, isAutomaticOpportunityLog } = require('../src/lib/academic-engine.ts');
const { baghdadDateKey } = require('../src/lib/baghdad-time.ts');

const rows = value => Array.isArray(value) ? value : [];
const timestamp = value => {
  const number = Date.parse(String(value || ''));
  return Number.isFinite(number) ? number : null;
};
const reason = value => String(value || '').replace(/^تلقائي:\s*/, '').trim();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parseJson = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const sortIds = values => [...values].sort((a, b) => a.id.localeCompare(b.id));
const studentResult = student => ({ status: student.status, opportunities: student.opportunities, dismissalReason: student.dismissalReason || '' });
const logMeaning = log => ({ id: log.id, studentId: log.studentId, examId: log.examId || null,
  action: log.action, amount: log.amount, reason: log.reason || '', date: timestamp(log.date),
  chapterId: log.chapterId || null, chapterNameSnapshot: log.chapterNameSnapshot || null });

function studentState(snapshot, student) {
  return {
    students: [{ ...student, dismissalReason: student.dismissalReason || '', dismissalNotes: student.dismissalNotes || '' }],
    grades: rows(snapshot.grades).filter(row => row.studentId === student.id),
    exams: rows(snapshot.exams).map(exam => ({ ...exam,
      courseIds: rows(parseJson(exam.courseIds)), opportunitiesPenalty: Number(exam.opportunitiesPenalty),
    })),
    chapters: rows(snapshot.chapters),
    courseChapters: rows(snapshot.courseChapters),
    opportunityLogs: rows(snapshot.opportunityLogs).filter(row => row.studentId === student.id).map(log => ({ ...log,
      reason: log.reason || '', examId: log.examId || '', chapterId: log.chapterId || '',
    })),
    studentLeaves: rows(snapshot.studentLeaves).filter(row => row.studentId === student.id).map(leave => ({ ...leave,
      examId: leave.examId || '', dateFrom: leave.dateFrom || leave.date, dateTo: leave.dateTo || leave.dateFrom || leave.date,
    })),
    studentNotes: rows(snapshot.studentNotes).filter(row => row.studentId === student.id),
  };
}

function assignedChapter(exam, courseId) {
  const assignments = rows(exam?.examCourses).filter(link => link.courseId === courseId);
  return assignments.length === 1 && assignments[0].chapterId ? assignments[0].chapterId : null;
}

function replay(state, studentId) {
  return recalculateAcademicState({ ...state, students: state.students.map(student => student.id === studentId
    ? { ...student, status: 'نشط', dismissalReason: '' } : student) }, new Set([studentId]), {
    respectLegacyReactivationDates: true,
  });
}

function priorCorrection(snapshot, student, evidence) {
  const cause = rows(snapshot.exams).find(exam => exam.id === evidence.examId);
  return rows(snapshot.priorCorrections).map(audit => ({ audit, details: parseJson(audit.details) }))
    .filter(({ details }) => details?.studentId === student.id && details.before?.status === 'مفصول' &&
      details.after?.status === 'نشط' && rows(details.removedLogs).some(log => log.id === evidence.id &&
        log.examId === evidence.examId && log.action === 'فصل تلقائي' && reason(log.reason) === reason(evidence.reason)))
    .map(value => {
      if (reason(value.details.before.dismissalReason) === reason(student.dismissalReason)) return value;
      // A recorded old title can explain a reason mismatch; never fuzzy-match
      // a student's reason or infer an old title from its wording alone.
      const renameAudit = rows(snapshot.renameAudits).find(audit => {
        const details = parseJson(audit.details);
        return cause?.name && details?.examId === cause.id && typeof details.examName === 'string' && details.examName &&
          reason(student.dismissalReason).replace(cause.name, details.examName) === reason(value.details.before.dismissalReason);
      });
      return renameAudit ? { ...value, renameAudit } : null;
    }).filter(Boolean)
    .sort((a, b) => (timestamp(a.audit.time) || 0) - (timestamp(b.audit.time) || 0)).at(-1) || null;
}

function classifyStudent(snapshot, student) {
  const state = studentState(snapshot, student);
  const pending = rows(snapshot.smartNotes).filter(note => note.studentId === student.id &&
    note.category === 'DISMISSED_PENDING' && note.status === 'PENDING');
  const base = { studentId: student.id, code: student.code || '', before: studentResult(student),
    pendingNoteCount: pending.length, pendingNoteIds: pending.map(note => note.id) };
  const reject = (classification, details = {}) => ({ ...base, classification, ...details });
  if (student.status !== 'مفصول') return reject('not-dismissed');
  const links = state.courseChapters.filter(link => link.courseId === student.courseId && link.active && !link.archived);
  if (links.length !== 1) return reject('ambiguous-active-chapter');
  const currentChapterId = links[0].chapterId;
  const currentChapter = state.chapters.find(chapter => chapter.id === currentChapterId);
  if (!currentChapter || !Number.isSafeInteger(currentChapter.opportunities) || currentChapter.opportunities < 0 ||
      currentChapter.opportunities > 3) return reject('unsupported-active-limit');
  const evidenceRows = state.opportunityLogs.filter(log => log.action === 'فصل تلقائي' &&
    reason(log.reason) === reason(student.dismissalReason) && timestamp(log.date) !== null);
  if (!evidenceRows.length) return reject('no-exact-automatic-dismissal-evidence');
  const evidenceKeys = new Set(evidenceRows.map(log => JSON.stringify([log.examId, baghdadDateKey(log.date)])));
  if (evidenceKeys.size !== 1) return reject('ambiguous-dismissal-evidence');
  const evidence = evidenceRows[0];
  const cause = state.exams.find(exam => exam.id === evidence.examId);
  const originChapterId = assignedChapter(cause, student.courseId);
  if (!cause || !originChapterId) return reject('unassigned-cause-exam');
  const originLinks = state.courseChapters.filter(link => link.courseId === student.courseId && link.chapterId === originChapterId);
  if (originLinks.length !== 1) return reject('ambiguous-origin-chapter');
  const causeDay = baghdadDateKey(evidence.date);
  const later = date => !baghdadDateKey(date) || baghdadDateKey(date) >= causeDay;
  if (state.opportunityLogs.some(log => !isAutomaticOpportunityLog(log) &&
      (String(log.reason || '').startsWith('فصل الطالب') || log.action.startsWith('فصل')) && later(log.date)) ||
      state.studentNotes.some(note => note.kind === 'إجراء' && String(note.text || '').startsWith('فصل الطالب') && later(note.date))) {
    return reject('manual-dismissal-override');
  }
  const prior = priorCorrection(snapshot, student, evidence);
  let originState = state;
  let boundary = null;
  let originArchiveEntry = null;
  if (originChapterId !== currentChapterId) {
    const archive = rows(parseJson(originLinks[0].archive)).filter(entry => entry.studentId === student.id &&
      baghdadDateKey(entry.date) > causeDay).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!archive.length) return reject('missing-origin-transition-boundary');
    originArchiveEntry = archive[0];
    boundary = originArchiveEntry.date;
    const cutoff = timestamp(/^\d{4}-\d{2}-\d{2}$/.test(boundary) ? `${boundary}T00:00:00+03:00` : boundary);
    if (cutoff === null) return reject('invalid-origin-transition-boundary');
    const originalGrades = state.grades.filter(grade => timestamp(grade.createdAt) !== null && timestamp(grade.createdAt) < cutoff);
    const changed = originalGrades.filter(grade => assignedChapter(state.exams.find(exam => exam.id === grade.examId), student.courseId) === originChapterId &&
      (timestamp(grade.updatedAt) === null || timestamp(grade.updatedAt) >= cutoff));
    if (changed.length) return reject('origin-grade-edited-after-transition', { gradeIds: changed.map(grade => grade.id), boundary });
    // Leaves created later cannot prove that the original dismissal was false
    // before transfer. Their records remain untouched in the current preview.
    originState = { ...state,
      grades: originalGrades,
      courseChapters: state.courseChapters.map(link => link.courseId === student.courseId
        ? { ...link, active: link.chapterId === originChapterId, archived: false } : link),
      opportunityLogs: state.opportunityLogs.filter(log => timestamp(log.date) !== null && timestamp(log.date) < cutoff),
      studentLeaves: state.studentLeaves.filter(leave => timestamp(leave.createdAt) !== null && timestamp(leave.createdAt) < cutoff),
      studentNotes: state.studentNotes.filter(note => timestamp(note.date) !== null && timestamp(note.date) < cutoff),
    };
  }
  const origin = replay(originState, student.id);
  const originStudent = origin.students[0];
  if (originStudent.status !== 'نشط' || originStudent.dismissalReason) return reject('legitimate-origin-chapter-dismissal', {
    originChapterId, originResult: studentResult(originStudent), boundary,
    priorCorrectionId: prior?.audit.id || null,
    reviewPendingGrades: pending.filter(note => assignedChapter(state.exams.find(exam => exam.id === note.examId), student.courseId) === originChapterId).map(note => note.id),
  });
  let balanceCheckpoint = null;
  let transitionSource = null;
  let currentState = state;
  if (REVIEWED_TRANSITION_CODES.has(student.code)) {
    transitionSource = rows(snapshot.transitionEvidence).find(log => log.courseId === student.courseId &&
      log.chapterId === currentChapterId && log.action === 'إعادة تعيين' && log.ledgerVersion === 2 &&
      log.balanceAfter === currentChapter.opportunities && log.amount === currentChapter.opportunities &&
      log.examId === null && String(log.reason || '').startsWith('تسوية تاريخية:') &&
      /تحويل فصل|انتقال/.test(String(log.reason || '')) &&
      baghdadDateKey(log.date) === baghdadDateKey(boundary) && timestamp(log.date) !== null);
    const existingSetter = state.opportunityLogs.some(log => log.chapterId === currentChapterId &&
      (log.action === 'إعادة تعيين' || log.action === 'رصيد إعادة التفعيل' || log.action === 'رصيد بعد تعهد'));
    if (originChapterId === currentChapterId || !originArchiveEntry || originArchiveEntry.opportunities !== 0 ||
        !transitionSource?._rowHash || existingSetter) return reject('unproved-missing-transition', {
      originResult: studentResult(originStudent), boundary,
    });
    balanceCheckpoint = { id: `${REPAIR_ID}_checkpoint_${student.id}`, studentId: student.id, examId: null,
      action: 'إعادة تعيين', amount: currentChapter.opportunities, requestedAmount: null,
      appliedAmount: null, balanceBefore: null,
      balanceAfter: currentChapter.opportunities, reversalOfLogId: null, ledgerVersion: 2, settledGradeIds: '[]',
      reason: transitionSource.reason,
      date: transitionSource.date, chapterId: currentChapterId, chapterNameSnapshot: currentChapter.name };
    currentState = { ...state, opportunityLogs: [...state.opportunityLogs, { ...balanceCheckpoint, examId: '' }] };
  }
  const current = replay(currentState, student.id);
  const calculated = current.students[0];
  if (calculated.status !== 'نشط' || calculated.dismissalReason) return reject('legitimate-current-chapter-dismissal', {
    originChapterId, originResult: studentResult(originStudent), currentResult: studentResult(calculated), boundary,
  });
  if (!Number.isSafeInteger(calculated.opportunities) || calculated.opportunities < student.opportunities ||
      calculated.opportunities > currentChapter.opportunities) return reject('unsafe-computed-balance');
  const sourceLogs = rows(snapshot.opportunityLogs).filter(log => log.studentId === student.id);
  const existing = new Map(sourceLogs.map(log => [log.id, log]));
  const projectedCurrent = current.opportunityLogs.filter(log => isAutomaticOpportunityLog(log) && log.chapterId === currentChapterId);
  const projectedMap = new Map(projectedCurrent.map(log => [log.id, log]));
  const obsoleteIds = new Set(evidenceRows.map(log => log.id));
  if (prior) for (const log of rows(prior.details.removedLogs)) {
    const stored = existing.get(log.id);
    if (stored && isAutomaticOpportunityLog(stored) && stored.examId === log.examId &&
        stored.action === log.action && reason(stored.reason) === reason(log.reason)) obsoleteIds.add(log.id);
  }
  const removeLogs = sourceLogs.filter(log => isAutomaticOpportunityLog(log) && (obsoleteIds.has(log.id) ||
    (log.chapterId === currentChapterId && (!projectedMap.has(log.id) ||
      JSON.stringify(logMeaning(log)) !== JSON.stringify(logMeaning(projectedMap.get(log.id)))))));
  const removedIds = new Set(removeLogs.map(log => log.id));
  const insertLogs = projectedCurrent.filter(log => !existing.has(log.id) || removedIds.has(log.id));
  const persistedLogs = [...currentState.opportunityLogs.filter(log => !removedIds.has(log.id)), ...insertLogs];
  const second = replay({ ...currentState, students: current.students, opportunityLogs: persistedLogs }, student.id);
  const secondCurrent = second.opportunityLogs.filter(log => isAutomaticOpportunityLog(log) && log.chapterId === currentChapterId);
  if (JSON.stringify(studentResult(second.students[0])) !== JSON.stringify(studentResult(calculated)) ||
      JSON.stringify(sortIds(secondCurrent).map(logMeaning)) !== JSON.stringify(sortIds(projectedCurrent).map(logMeaning))) {
    return reject('unstable-replay');
  }
  // Ordinary production recalculation does not opt into legacy-date review.
  // Require its exact default behavior to agree too, so correction cannot
  // immediately regress on the next normal grade/leave mutation.
  const ordinary = recalculateAcademicState({ ...currentState, students: current.students,
    opportunityLogs: persistedLogs }, new Set([student.id]));
  const ordinaryCurrent = ordinary.opportunityLogs.filter(log => isAutomaticOpportunityLog(log) && log.chapterId === currentChapterId);
  if (JSON.stringify(studentResult(ordinary.students[0])) !== JSON.stringify(studentResult(calculated)) ||
      JSON.stringify(sortIds(ordinaryCurrent).map(logMeaning)) !== JSON.stringify(sortIds(projectedCurrent).map(logMeaning))) {
    return reject('ordinary-replay-differs', { reviewedResult: studentResult(calculated), ordinaryResult: studentResult(ordinary.students[0]) });
  }
  const ordinaryAgain = recalculateAcademicState({ ...currentState, students: ordinary.students,
    opportunityLogs: ordinary.opportunityLogs }, new Set([student.id]));
  const ordinaryAgainCurrent = ordinaryAgain.opportunityLogs.filter(log => isAutomaticOpportunityLog(log) && log.chapterId === currentChapterId);
  if (JSON.stringify(studentResult(ordinaryAgain.students[0])) !== JSON.stringify(studentResult(calculated)) ||
      JSON.stringify(sortIds(ordinaryAgainCurrent).map(logMeaning)) !== JSON.stringify(sortIds(projectedCurrent).map(logMeaning))) {
    return reject('ordinary-second-replay-differs');
  }
  const verifiedArchive = originChapterId !== currentChapterId && originArchiveEntry &&
    originArchiveEntry.opportunities > 0 && originArchiveEntry.opportunities === originStudent.opportunities;
  return { ...base, classification: 'eligible', chapterId: currentChapterId, originChapterId,
    after: studentResult(calculated), sourceStudentRowHash: student._rowHash || null,
    originResult: studentResult(originStudent), boundary, restorationEvidenceLogId: evidence.id,
    priorCorrectionId: prior?.audit.id || null,
    evidence: { kind: prior ? 'prior-correction' : balanceCheckpoint ? 'missing-chapter-transition'
        : verifiedArchive ? 'verified-historical-replay' : 'unreviewed-historical-replay',
      sourceDismissalLogId: evidence.id, sourceExamId: evidence.examId,
      sourceChapterId: originChapterId, priorCorrectionAuditId: prior?.audit.id || null,
      priorCorrectionAuditHash: prior?.audit._rowHash || null,
      renamedExamAuditId: prior?.renameAudit?.id || null,
      renamedExamAuditHash: prior?.renameAudit?._rowHash || null,
      originArchiveCourseChapterId: originLinks[0].id, originArchiveEntry,
      transitionDate: transitionSource?.date || boundary,
      sourceTransitionLogId: transitionSource?.id || null, sourceTransitionLogHash: transitionSource?._rowHash || null,
      sourceTransitionLog: transitionSource || null,
      originalChapterReplay: studentResult(originStudent), currentChapterReplay: studentResult(calculated) },
    reason: 'تصحيح بقاء فصل آلي ثبت زوال سببه بعد مراجعة الفصل الأصلي والحالي دون منح فرص أو تغيير الدرجات',
    removeLogs, removeLogIds: removeLogs.map(log => log.id), insertLogs, balanceCheckpoint,
    repeatedReplayStable: true, ordinaryReplayStable: true, newBalanceGrant: false, gradeChanges: 0,
  };
}

function buildPlan(snapshot) {
  const results = rows(snapshot.students).map(student => classifyStudent(snapshot, student));
  const classifications = {};
  for (const result of results) classifications[result.classification] = (classifications[result.classification] || 0) + 1;
  // This reviewed batch is bounded to the prior correction cohort and the
  // nine individually verified archive/transition cases. Other candidates
  // remain visible separately and never become executable by inference.
  const proven = results.filter(result => result.classification === 'eligible');
  const approved = result => result.priorCorrectionId ||
    (REVIEWED_ARCHIVE_CODES.has(result.code) && result.evidence.kind === 'verified-historical-replay') ||
    (REVIEWED_TRANSITION_CODES.has(result.code) && result.evidence.kind === 'missing-chapter-transition');
  const items = proven.filter(approved);
  const additionalCandidates = proven.filter(result => !approved(result));
  const targetIds = new Set(items.map(item => item.studentId));
  const targets = rows(snapshot.students).filter(student => targetIds.has(student.id));
  const expected = { Student: targets.map(student => ({ id: student.id, _rowHash: student._rowHash })) };
  for (const table of ['Grade', 'OpportunityLog', 'StudentLeave', 'StudentNote', 'GradeSmartNote']) {
    expected[table] = targets.map(student => ({ studentId: student.id, hash: student._sourceHashes?.[table] || null }));
  }
  for (const table of ['Exam', 'ExamCourse', 'CourseChapter', 'Chapter']) expected[table] = snapshot.fingerprints?.[table] || null;
  return { repairId: REPAIR_ID, capturedAt: snapshot.capturedAt,
    sourceFingerprint: hash(snapshot), databaseFingerprints: snapshot.fingerprints || {},
    expected,
    summary: { examined: results.length, eligible: items.length, additionalCandidates: additionalCandidates.length, classifications,
      balances: items.reduce((totals, item) => ({ ...totals, [item.after.opportunities]: (totals[item.after.opportunities] || 0) + 1 }), {}),
      pendingNotesPreserved: items.reduce((total, item) => total + item.pendingNoteCount, 0),
      removedLogs: items.reduce((total, item) => total + item.removeLogs.length, 0),
      insertedLogs: items.reduce((total, item) => total + item.insertLogs.length, 0),
      gradeChanges: 0, existingManualLedgerChanges: 0,
      transitionCheckpoints: items.filter(item => item.balanceCheckpoint).length, newBalanceGrants: 0 },
    items, additionalCandidates, skipped: results.filter(result => result.classification !== 'eligible'),
  };
}

module.exports = { buildPlan, classifyStudent };
if (require.main === module) {
  const input = process.argv[2] || '/tmp/teacherpro-dismissal-repair-snapshot.json';
  const output = process.argv[3] || '/tmp/teacherpro-retained-dismissals-plan.json';
  const plan = buildPlan(JSON.parse(fs.readFileSync(input, 'utf8')));
  fs.writeFileSync(output, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ output, ...plan.summary }, null, 2));
}
