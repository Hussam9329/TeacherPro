export type StudentExportPage<T extends { id: string }> = {
  students: T[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  snapshotAt: string;
};

export type StudentExportPageRequest = {
  cursor?: string;
  snapshotAt?: string;
  pageSize: number;
  signal?: AbortSignal;
};

export type StudentExportProgress = {
  loaded: number;
  total: number;
};

export class StudentExportIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudentExportIntegrityError";
  }
}

function abortError(): Error {
  const error = new Error("تم إلغاء عملية التصدير.");
  error.name = "AbortError";
  return error;
}

/**
 * Collects a complete server export without relying on one oversized response.
 * Every page belongs to the same insertion snapshot, IDs must be unique, and
 * the final row count must equal the authoritative database count.
 */
export async function collectStudentExportPages<T extends { id: string }>(
  fetchPage: (
    request: StudentExportPageRequest,
  ) => Promise<StudentExportPage<T>>,
  options: {
    pageSize?: number;
    signal?: AbortSignal;
    onProgress?: (progress: StudentExportProgress) => void;
    maxPages?: number;
  } = {},
): Promise<T[]> {
  const pageSize = Math.min(500, Math.max(50, options.pageSize || 500));
  const maxPages = Math.max(1, options.maxPages || 10_000);
  const rows: T[] = [];
  const ids = new Set<string>();
  let cursor: string | undefined;
  let snapshotAt: string | undefined;
  let expectedTotal: number | null = null;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    if (options.signal?.aborted) throw abortError();

    const page = await fetchPage({
      cursor,
      snapshotAt,
      pageSize,
      signal: options.signal,
    });
    if (options.signal?.aborted) throw abortError();

    const pageTotal = Number(page.totalCount);
    if (!Number.isSafeInteger(pageTotal) || pageTotal < 0) {
      throw new StudentExportIntegrityError(
        "أعاد النظام عدداً غير صالح لصفوف التصدير.",
      );
    }
    if (!page.snapshotAt || Number.isNaN(Date.parse(page.snapshotAt))) {
      throw new StudentExportIntegrityError(
        "تعذر تثبيت لقطة بيانات التصدير.",
      );
    }

    if (expectedTotal === null) {
      expectedTotal = pageTotal;
      snapshotAt = page.snapshotAt;
    } else if (
      pageTotal !== expectedTotal ||
      page.snapshotAt !== snapshotAt
    ) {
      throw new StudentExportIntegrityError(
        "تغيّرت نتائج الفلاتر أثناء التصدير؛ أعد المحاولة للحصول على ملف كامل.",
      );
    }

    for (const row of page.students || []) {
      const id = String(row?.id || "");
      if (!id || ids.has(id)) {
        throw new StudentExportIntegrityError(
          "اكتشف النظام صفاً مكرراً أو غير صالح وأوقف إنشاء الملف الناقص.",
        );
      }
      ids.add(id);
      rows.push(row);
    }

    options.onProgress?.({ loaded: rows.length, total: expectedTotal });

    if (!page.hasMore) {
      if (rows.length !== expectedTotal) {
        throw new StudentExportIntegrityError(
          `لم يكتمل التصدير: تم تحميل ${rows.length} من أصل ${expectedTotal} طالب.`,
        );
      }
      return rows;
    }

    const nextCursor = String(page.nextCursor || "");
    if (!nextCursor || nextCursor === cursor || page.students.length === 0) {
      throw new StudentExportIntegrityError(
        "توقف تسلسل التصدير قبل اكتمال جميع الطلاب.",
      );
    }
    cursor = nextCursor;
  }

  throw new StudentExportIntegrityError(
    "تجاوز التصدير الحد الآمن لعدد الصفحات قبل الاكتمال.",
  );
}
