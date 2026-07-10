import { createHash } from 'crypto';

import { db } from '@/lib/db';
import { isMissingDatabaseObjectError } from '@/lib/route-helpers';

export function parseCourseIds(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          const trimmed = value.trim();
          if (!trimmed) return [];
          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : trimmed.split(',');
          } catch {
            return trimmed.split(',');
          }
        })()
      : [];

  return Array.from(new Set(raw.map((item) => String(item).trim()).filter(Boolean)));
}

export function stringifyCourseIds(value: unknown): string {
  return JSON.stringify(parseCourseIds(value));
}

export function canonicalCourseIds(value: unknown): string {
  return JSON.stringify([...parseCourseIds(value)].sort());
}

function examCourseId(examId: string, courseId: string): string {
  const digest = createHash('sha1').update(`${examId}:${courseId}`).digest('hex').slice(0, 28);
  return `examcourse_${digest}`;
}

type ExamCourseLinkClient = {
  examCourse: {
    deleteMany(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
  };
};

const EXAM_COURSE_LINK_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "ExamCourse" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    CONSTRAINT "ExamCourse_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ExamCourse_examId_courseId_key" ON "ExamCourse"("examId", "courseId")`,
  `CREATE INDEX IF NOT EXISTS "ExamCourse_courseId_idx" ON "ExamCourse"("courseId")`,
  `DELETE FROM "ExamCourse" link
    WHERE NOT EXISTS (SELECT 1 FROM "Exam" exam WHERE exam."id" = link."examId")
       OR NOT EXISTS (SELECT 1 FROM "Course" course WHERE course."id" = link."courseId")`,
  `DO $$
  DECLARE
    exam_row RECORD;
    parsed jsonb;
    linked_course_id TEXT;
  BEGIN
    FOR exam_row IN SELECT "id", "courseIds" FROM "Exam" LOOP
      BEGIN
        parsed := COALESCE(NULLIF(exam_row."courseIds", ''), '[]')::jsonb;
      EXCEPTION WHEN others THEN
        parsed := '[]'::jsonb;
      END;

      IF jsonb_typeof(parsed) = 'array' THEN
        FOR linked_course_id IN SELECT value FROM jsonb_array_elements_text(parsed) AS value LOOP
          IF EXISTS (SELECT 1 FROM "Course" WHERE "id" = linked_course_id) THEN
            INSERT INTO "ExamCourse" ("id", "examId", "courseId")
            VALUES (concat('examcourse_', substring(md5(exam_row."id" || ':' || linked_course_id), 1, 28)), exam_row."id", linked_course_id)
            ON CONFLICT ("examId", "courseId") DO NOTHING;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END $$`,
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExamCourse_examId_fkey') THEN
      ALTER TABLE "ExamCourse"
        ADD CONSTRAINT "ExamCourse_examId_fkey"
        FOREIGN KEY ("examId") REFERENCES "Exam"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExamCourse_courseId_fkey') THEN
      ALTER TABLE "ExamCourse"
        ADD CONSTRAINT "ExamCourse_courseId_fkey"
        FOREIGN KEY ("courseId") REFERENCES "Course"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END $$`,
] as const;

let ensurePromise: Promise<void> | null = null;

export async function ensureExamCourseLinksSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      for (const statement of EXAM_COURSE_LINK_STATEMENTS) {
        await db.$executeRawUnsafe(statement);
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}

export async function withExamCourseLinksSchema<T>(operation: () => Promise<T>): Promise<T> {
  try {
    await ensureExamCourseLinksSchema();
    return await operation();
  } catch (error) {
    if (!isMissingDatabaseObjectError(error)) throw error;
    ensurePromise = null;
    await ensureExamCourseLinksSchema();
    return operation();
  }
}

export async function syncExamCourseLinks(client: ExamCourseLinkClient, examId: string, courseIdsInput: unknown): Promise<string[]> {
  const courseIds = parseCourseIds(courseIdsInput);
  await client.examCourse.deleteMany({
    where: {
      examId,
      ...(courseIds.length ? { courseId: { notIn: courseIds } } : {}),
    },
  });

  if (courseIds.length > 0) {
    await client.examCourse.createMany({
      data: courseIds.map((courseId) => ({
        id: examCourseId(examId, courseId),
        examId,
        courseId,
      })),
      skipDuplicates: true,
    });
  }

  return courseIds;
}
