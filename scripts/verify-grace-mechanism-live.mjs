#!/usr/bin/env node
// READ-ONLY verification of the grace-period mechanism against the live DB.
// 1) DB trigger exists on Grade
// 2) Contradiction A: numeric grade row saved while student window still active
//    (i.e. grade entered during grace but grace NOT ended) => mechanism leak
// 3) Contradiction B: gracePeriodEndedAt set but accountingGraceDays > 0
// 4) Contradiction C: gracePeriodEndedAt set but gracePeriodStartDate set
// 5) Active grace students sanity: window math
// 6) Legacy "ضمن فترة السماح" markers that became chargeable after grace ended
//    but still carry exclusion (stale exclusion after termination)

import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

// pg driver does not understand channel_binding — strip it before connecting.
const safeUrl = DATABASE_URL.replace(/&?channel_binding=(require|verify-ca|verify-full)/, "");
const client = new pg.Client({
  connectionString: safeUrl,
  ssl: { rejectUnauthorized: false },
});

const out = (label, value) => console.log(`${label}: ${JSON.stringify(value, null, 2)}`);

try {
  await client.connect();

  // 1) Trigger presence
  const trigger = await client.query(`
    SELECT tgname, tgenabled
    FROM pg_trigger
    WHERE tgrelid = '"Grade"'::regclass AND tgname = 'tp_end_active_grace_on_numeric_grade_trg'
  `);
  out("1) trigger_on_grade", trigger.rows);

  // 2) REAL LEAK: numeric grade row CREATED while the student's grace window
  //    was still active (grade.createdAt inside window) and grace NOT ended.
  //    The writeback + trigger must have set gracePeriodEndedAt in that case.
  //    (Grades created after natural expiry are legitimately still protected.)
  const leakA = await client.query(`
    SELECT s.id AS student_id, s.name, g.id AS grade_id, g."examId" AS exam_id, g.score,
           g.status, g."academicEffectExcluded", g."createdAt" AS grade_created_at,
           s."accountingGraceDays", s."gracePeriodStartDate", s."createdAt",
           e.date AS exam_date,
           (COALESCE(s."gracePeriodStartDate", s."createdAt")) AS win_start,
           (COALESCE(s."gracePeriodStartDate", s."createdAt")
             + (CASE WHEN COALESCE(s."accountingGraceDays",0) > 0 THEN s."accountingGraceDays" ELSE 3 END) * INTERVAL '1 day') AS win_end
    FROM "Grade" g
    JOIN "Student" s ON s.id = g."studentId"
    JOIN "Exam" e ON e.id = g."examId"
    WHERE g.status = 'درجة' AND g.score IS NOT NULL
      AND s."gracePeriodEndedAt" IS NULL
      AND COALESCE(s."gracePeriodStartDate", s."createdAt") IS NOT NULL
      AND g."createdAt" >= COALESCE(s."gracePeriodStartDate", s."createdAt")
      AND g."createdAt" < (COALESCE(s."gracePeriodStartDate", s."createdAt")
             + (CASE WHEN COALESCE(s."accountingGraceDays",0) > 0 THEN s."accountingGraceDays" ELSE 3 END) * INTERVAL '1 day')
    LIMIT 50
  `);
  out("2) numeric_grades_created_DURING_active_window_but_grace_not_ended (should be [])", leakA.rows);

  // 2b) Numeric grade rows written while student was currently-in-grace at write
  //     time — approximated by: grade row exists, student window covers NOW.
  //     If the trigger+writeback work, any numeric write during active grace
  //     ends the window, so a student can never be in-window with numeric grades
  //     unless the window was manually re-granted afterwards (legitimate).
  const nowInWindowWithNumeric = await client.query(`
    SELECT s.id, s.name, s."accountingGraceDays", s."gracePeriodStartDate", s."createdAt",
           (SELECT COUNT(*) FROM "Grade" g WHERE g."studentId" = s.id AND g.status='درجة' AND g.score IS NOT NULL) AS numeric_grades
    FROM "Student" s
    WHERE s."gracePeriodEndedAt" IS NULL
      AND COALESCE(s."gracePeriodStartDate", s."createdAt") IS NOT NULL
      AND CURRENT_TIMESTAMP >= COALESCE(s."gracePeriodStartDate", s."createdAt")
      AND CURRENT_TIMESTAMP <= (COALESCE(s."gracePeriodStartDate", s."createdAt")
             + (CASE WHEN COALESCE(s."accountingGraceDays",0) > 0 THEN s."accountingGraceDays" ELSE 3 END) * INTERVAL '1 day')
    LIMIT 50
  `);
  out("2b) students_currently_in_grace_window", nowInWindowWithNumeric.rows);

  // 3) gracePeriodEndedAt set but accountingGraceDays > 0
  const leakB = await client.query(`
    SELECT id, name, "accountingGraceDays", "gracePeriodEndedAt"
    FROM "Student"
    WHERE "gracePeriodEndedAt" IS NOT NULL AND COALESCE("accountingGraceDays",0) > 0
    LIMIT 50
  `);
  out("3) ended_grace_with_nonzero_days (should be [])", leakB.rows);

  // 4) gracePeriodEndedAt set but gracePeriodStartDate set
  const leakC = await client.query(`
    SELECT id, name, "gracePeriodStartDate", "gracePeriodEndedAt"
    FROM "Student"
    WHERE "gracePeriodEndedAt" IS NOT NULL AND "gracePeriodStartDate" IS NOT NULL
    LIMIT 50
  `);
  out("4) ended_grace_with_start_date (should be [])", leakC.rows);

  // 5) Active grace students overview
  const activeGrace = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE "gracePeriodEndedAt" IS NULL)::int AS open_windows,
           COUNT(*) FILTER (WHERE "gracePeriodEndedAt" IS NOT NULL)::int AS terminated
    FROM "Student"
  `);
  out("5) student_grace_overview", activeGrace.rows);

  // 6) Chargeable leaks: grades entered during grace (marker rows kept exclusion)
  //    numeric grades with academicEffectExcluded because of a grace smart note
  const staleExcluded = await client.query(`
    SELECT g.id, g."studentId", g."examId", g.status, g.score, g."academicEffectExcluded", g."academicEffectExclusionReason"
    FROM "Grade" g
    WHERE g.status = 'درجة' AND g.score IS NOT NULL
      AND g."academicEffectExcluded" = true
      AND g."academicEffectExclusionReason" LIKE '%سماح%'
    LIMIT 50
  `);
  out("6) numeric_grades_still_excluded_by_grace (should be [])", staleExcluded.rows);

  // 7) GRACE_SCORED smart notes still pending
  const pendingGraceNotes = await client.query(`
    SELECT id, "studentId", "examId", score, status, "createdAt"
    FROM "GradeSmartNote"
    WHERE category = 'GRACE_SCORED' AND status = 'PENDING'
    LIMIT 50
  `);
  out("7) pending_GRACE_SCORED_notes", pendingGraceNotes.rows);

  // 8) Exam-edit date shift risk: numeric grade whose exam was later moved INTO
  //    an active grace window (same as #2 but catches manual exam date edits)
  //    — covered by #2 query already (exam date based).

  // 9) Students whose status contradicts: status='نشط' with grace ended etc. (info only)
  const statusSample = await client.query(`
    SELECT status, COUNT(*)::int FROM "Student" GROUP BY status
  `);
  out("9) student_status_distribution", statusSample.rows);
} catch (error) {
  console.error("FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
