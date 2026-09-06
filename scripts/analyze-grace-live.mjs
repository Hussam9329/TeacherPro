#!/usr/bin/env node
// Focused READ-ONLY analysis of grace-mechanism health on the live DB.
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const safeUrl = DATABASE_URL.replace(/&?channel_binding=(require|verify-ca|verify-full)/, "");
const client = new pg.Client({ connectionString: safeUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  // A) Students currently inside an ACTIVE grace window — do they have numeric
  //    grades created during that same window? (real ongoing leak if > 0)
  const activeLeaks = await client.query(`
    SELECT s.id, s.name, s."accountingGraceDays", s."gracePeriodStartDate", s."createdAt",
           (COALESCE(s."gracePeriodStartDate", s."createdAt")
             + (CASE WHEN COALESCE(s."accountingGraceDays",0) > 0 THEN s."accountingGraceDays" ELSE 3 END) * INTERVAL '1 day') AS win_end,
           (SELECT COUNT(*)::int FROM "Grade" g
              WHERE g."studentId" = s.id AND g.status='درجة' AND g.score IS NOT NULL
                AND g."createdAt" >= COALESCE(s."gracePeriodStartDate", s."createdAt")
                AND g."createdAt" < (COALESCE(s."gracePeriodStartDate", s."createdAt")
                      + (CASE WHEN COALESCE(s."accountingGraceDays",0) > 0 THEN s."accountingGraceDays" ELSE 3 END) * INTERVAL '1 day')) AS numeric_during_window
    FROM "Student" s
    WHERE s."gracePeriodEndedAt" IS NULL
      AND COALESCE(s."gracePeriodStartDate", s."createdAt") IS NOT NULL
      AND CURRENT_TIMESTAMP >= COALESCE(s."gracePeriodStartDate", s."createdAt")
      AND CURRENT_TIMESTAMP <= (COALESCE(s."gracePeriodStartDate", s."createdAt")
             + (CASE WHEN COALESCE(s."accountingGraceDays",0) > 0 THEN s."accountingGraceDays" ELSE 3 END) * INTERVAL '1 day')
  `);
  const withLeak = activeLeaks.rows.filter((r) => r.numeric_during_window > 0);
  console.log("A) students_currently_in_active_window:", activeLeaks.rows.length);
  console.log("   of_those_with_numeric_grade_created_during_window (REAL LEAK):", withLeak.length);
  if (withLeak.length) console.log(JSON.stringify(withLeak, null, 2));

  // B) The excluded numeric grades (reason mentions سماح): classify each by the
  //    student's CURRENT window state.
  const excluded = await client.query(`
    SELECT g.id AS grade_id, g."studentId", g.score, g."createdAt" AS grade_created_at,
           s."gracePeriodEndedAt", s."accountingGraceDays", s."gracePeriodStartDate", s."createdAt" AS reg_date
    FROM "Grade" g
    JOIN "Student" s ON s.id = g."studentId"
    WHERE g.status = 'درجة' AND g.score IS NOT NULL
      AND g."academicEffectExcluded" = true
      AND g."academicEffectExclusionReason" LIKE '%سماح%'
  `);
  const now = Date.now();
  const buckets = { window_still_open: 0, window_expired_naturally: 0, window_terminated_by_grade: 0 };
  const openSamples = [];
  for (const row of excluded.rows) {
    if (row.gracePeriodEndedAt) { buckets.window_terminated_by_grade += 1; continue; }
    const start = new Date(row.gracePeriodStartDate || row.reg_date).getTime();
    const days = Number(row.accountingGraceDays || 0) > 0 ? Number(row.accountingGraceDays) : 3;
    const end = start + days * 86400000;
    if (now <= end) {
      buckets.window_still_open += 1;
      if (openSamples.length < 5) openSamples.push(row);
    } else {
      buckets.window_expired_naturally += 1;
    }
  }
  console.log("B) numeric_excluded_by_grace_total:", excluded.rows.length);
  console.log("   buckets:", buckets);
  if (openSamples.length) console.log("   window_still_open_samples:", JSON.stringify(openSamples, null, 2));

  // C) For students whose window was TERMINATED by a numeric grade (gracePeriodEndedAt set),
  //    do any of their OLD "ضمن فترة السماح" marker rows still sit excluded?
  //    (by design yes/protected — informational only)
  const terminated = await client.query(`
    SELECT COUNT(DISTINCT s.id)::int AS students, COUNT(g.id)::int AS grace_markers
    FROM "Student" s
    JOIN "Grade" g ON g."studentId" = s.id AND g.status = 'ضمن فترة السماح'
    WHERE s."gracePeriodEndedAt" IS NOT NULL
  `);
  console.log("C) terminated_students_with_grace_markers:", terminated.rows[0]);

  // D) Recent numeric grades (last 14 days) — did the writeback/trigger end grace
  //    when the student was in-window at write time? Look for post-mechanism leaks.
  const recent = await client.query(`
    SELECT COUNT(*)::int AS recent_numeric_grades
    FROM "Grade" g
    WHERE g.status='درجة' AND g.score IS NOT NULL AND g."createdAt" > CURRENT_TIMESTAMP - INTERVAL '14 days'
  `);
  console.log("D) recent_numeric_grades_last_14d:", recent.rows[0]);

  // E) Students with open windows that are FUTURE-dated (manual grace starting later) — info
  const upcoming = await client.query(`
    SELECT COUNT(*)::int FROM "Student" s
    WHERE s."gracePeriodEndedAt" IS NULL AND s."gracePeriodStartDate" > CURRENT_TIMESTAMP
  `);
  console.log("E) upcoming_manual_grace_windows:", upcoming.rows[0]);

  // F) The 6 terminated students — sanity: numeric grade exists & window closed
  const terminatedStudents = await client.query(`
    SELECT s.id, s.name, s."gracePeriodEndedAt", s."accountingGraceDays",
           (SELECT COUNT(*)::int FROM "Grade" g WHERE g."studentId"=s.id AND g.status='درجة' AND g.score IS NOT NULL) AS numeric_grades,
           (SELECT MAX(g."createdAt") FROM "Grade" g WHERE g."studentId"=s.id AND g.status='درجة' AND g.score IS NOT NULL) AS last_numeric_at
    FROM "Student" s WHERE s."gracePeriodEndedAt" IS NOT NULL
  `);
  console.log("F) terminated_students_detail:", JSON.stringify(terminatedStudents.rows, null, 2));
} catch (error) {
  console.error("FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
