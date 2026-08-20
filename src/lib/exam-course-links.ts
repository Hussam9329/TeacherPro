import { createHash } from 'crypto';

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
