/**
 * TeacherPro — API Service Layer
 * Handles all communication between the Zustand store and the backend API routes (Prisma/PostgreSQL).
 *
 * IMPORTANT: Mutations (POST/PUT/DELETE) return { ok: boolean, error?: string } so the
 * store can decide whether to update local state or show an error. This prevents the
 * "phantom delete" bug where the UI shows success but the database rejected the operation.
 */

// ─── Generic Helpers ──────────────────────────────────────────────────────────

function toUserFriendlyError(
  raw: unknown,
  fallback = "تعذر تنفيذ العملية حالياً. حاول مرة أخرى.",
): string {
  const message = typeof raw === "string" ? raw : fallback;
  const normalized = message.toLowerCase();

  if (!message.trim()) return fallback;
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("network error")
  ) {
    return "تعذر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مرة أخرى.";
  }
  if (normalized.includes("unexpected token") || normalized.includes("json")) {
    return "استجابة الخادم غير مفهومة. حاول تحديث الصفحة.";
  }
  if (normalized.includes("id is required")) {
    return "تعذر تحديد السجل المطلوب. حدّث الصفحة ثم حاول مرة أخرى.";
  }
  if (normalized.includes("foreign key") || normalized.includes("constraint")) {
    return "لا يمكن تنفيذ العملية لأن السجل مرتبط ببيانات أخرى.";
  }
  if (/^http\s?\d{3}$/i.test(message.trim())) {
    return "تعذر تنفيذ العملية على الخادم. حاول مرة أخرى.";
  }

  return message;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const err = (await res.json().catch(() => null)) as {
      error?: unknown;
      message?: unknown;
    } | null;
    return toUserFriendlyError(err?.error ?? err?.message, fallback);
  }
  const text = await res.text().catch(() => "");
  return toUserFriendlyError(text, fallback);
}

export interface ApiResult {
  ok: boolean;
  error?: string;
  status?: number;
  transient?: boolean;
  queued?: boolean;
  data?: unknown;
}

function isTransientHttpStatus(status: number): boolean {
  return (
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryTransientMutation(
  run: () => Promise<ApiResult>,
  attempts = 3,
): Promise<ApiResult> {
  let lastResult: ApiResult = {
    ok: false,
    error: "تعذر تنفيذ العملية حالياً.",
    transient: true,
    status: 0,
  };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = await run();
    if (lastResult.ok || !lastResult.transient || attempt === attempts)
      return lastResult;
    await delay(250 * attempt);
  }
  return lastResult;
}

async function apiPost(endpoint: string, data: unknown): Promise<ApiResult> {
  const result = await retryTransientMutation(async () => {
    try {
      const res = await fetch(`/api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await readApiError(
          res,
          `تعذر حفظ البيانات (رمز ${res.status})`,
        );
        console.warn(`[API] POST /api/${endpoint} failed:`, error);
        return {
          ok: false,
          error,
          status: res.status,
          transient: isTransientHttpStatus(res.status),
        };
      }
      const contentType = res.headers.get("content-type") || "";
      const responseData = contentType.includes("application/json")
        ? await res.json().catch(() => null)
        : null;
      return { ok: true, data: responseData };
    } catch (e) {
      const msg = toUserFriendlyError(
        e instanceof Error ? e.message : "Network error",
      );
      console.warn(`[API] POST /api/${endpoint} network error:`, e);
      return { ok: false, error: msg, status: 0, transient: true };
    }
  });
  // If all retries exhausted on a transient failure, queue to outbox
  // so the mutation survives page reloads and is retried when network returns.
  if (!result.ok && result.transient) {
    try {
      const { queueOnly } = require("./mutation-outbox");
      queueOnly({
        endpoint: `/api/${endpoint}`,
        method: "POST",
        payload: data,
      });
      return { ...result, queued: true };
    } catch {
      // mutation-outbox not available (SSR); return as-is.
    }
  }
  return result;
}

async function apiPut(
  endpoint: string,
  data: Record<string, unknown>,
): Promise<ApiResult> {
  const result = await retryTransientMutation(async () => {
    try {
      const res = await fetch(`/api/${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await readApiError(
          res,
          `تعذر تحديث البيانات (رمز ${res.status})`,
        );
        console.warn(`[API] PUT /api/${endpoint} failed:`, error);
        return {
          ok: false,
          error,
          status: res.status,
          transient: isTransientHttpStatus(res.status),
        };
      }
      return { ok: true };
    } catch (e) {
      const msg = toUserFriendlyError(
        e instanceof Error ? e.message : "Network error",
      );
      console.warn(`[API] PUT /api/${endpoint} network error:`, e);
      return { ok: false, error: msg, status: 0, transient: true };
    }
  });
  if (!result.ok && result.transient) {
    try {
      const { queueOnly } = require("./mutation-outbox");
      queueOnly({
        endpoint: `/api/${endpoint}`,
        method: "PUT",
        payload: data,
      });
      return { ...result, queued: true };
    } catch {
      // SSR; return as-is.
    }
  }
  return result;
}

async function apiDelete(
  endpoint: string,
  id: string,
  extraParams: Record<string, string | undefined> = {},
): Promise<ApiResult> {
  const params = new URLSearchParams();
  params.set("id", id);
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const queryString = params.toString();
  const fullEndpoint = `/api/${endpoint}?${queryString}`;

  const result = await retryTransientMutation(async () => {
    try {
      const res = await fetch(fullEndpoint, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const error = await readApiError(
          res,
          `تعذر حذف السجل (رمز ${res.status})`,
        );
        console.warn(`[API] DELETE /api/${endpoint} failed:`, error);
        return {
          ok: false,
          error,
          status: res.status,
          transient: isTransientHttpStatus(res.status),
        };
      }
      return { ok: true };
    } catch (e) {
      const msg = toUserFriendlyError(
        e instanceof Error ? e.message : "Network error",
      );
      console.warn(`[API] DELETE /api/${endpoint} network error:`, e);
      return { ok: false, error: msg, status: 0, transient: true };
    }
  });
  if (!result.ok && result.transient) {
    try {
      const { queueOnly } = require("./mutation-outbox");
      queueOnly({
        endpoint: fullEndpoint,
        method: "DELETE",
      });
      return { ...result, queued: true };
    } catch {
      // SSR; return as-is.
    }
  }
  return result;
}

interface ApiGetResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function apiGetResponse<T>(
  endpoint: string,
  quietStatuses: number[] = [],
): Promise<ApiGetResponse<T>> {
  try {
    const res = await fetch(`/api/${endpoint}`, { credentials: "same-origin" });
    if (!res.ok) {
      const error = await readApiError(res, "تعذر تحميل البيانات");
      if (!quietStatuses.includes(res.status)) {
        console.warn(`[API] GET /api/${endpoint} failed:`, error);
      }
      return { ok: false, status: res.status, data: null, error };
    }
    const json = await res.json();
    return { ok: true, status: res.status, data: json as T };
  } catch (e) {
    console.warn(`[API] GET /api/${endpoint} error:`, e);
    return {
      ok: false,
      status: 0,
      data: null,
      error: toUserFriendlyError(
        e instanceof Error ? e.message : "Network error",
      ),
    };
  }
}

async function apiGet<T>(endpoint: string): Promise<T | null> {
  const result = await apiGetResponse<T>(endpoint);
  return result.ok ? result.data : null;
}

export interface AuthApiUser {
  id: string;
  username: string;
  name: string;
  role: string;
  roleId: string | null;
  permissions: string[];
  active: boolean;
  isAdmin?: boolean;
}

export interface AuthApiResult extends ApiResult {
  user?: AuthApiUser;
  status?: number;
}

export const authApi = {
  login: async (username: string, password: string): Promise<AuthApiResult> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const error = await readApiError(res, "تعذر تسجيل الدخول");
        return { ok: false, error };
      }
      const json = (await res.json()) as { user?: AuthApiUser };
      return { ok: true, user: json.user };
    } catch (e) {
      return {
        ok: false,
        error: toUserFriendlyError(
          e instanceof Error ? e.message : "Network error",
        ),
      };
    }
  },
  logout: async (): Promise<ApiResult> => {
    try {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok)
        return {
          ok: false,
          error: await readApiError(res, "تعذر تسجيل الخروج"),
        };
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: toUserFriendlyError(
          e instanceof Error ? e.message : "Network error",
        ),
      };
    }
  },
  session: async (): Promise<AuthApiResult> => {
    try {
      const res = await fetch("/api/auth/session", {
        credentials: "same-origin",
      });
      if (!res.ok)
        return {
          ok: false,
          status: res.status,
          error: await readApiError(res, "تعذر التحقق من الجلسة حالياً"),
        };
      const json = (await res.json()) as { user?: AuthApiUser };
      return { ok: true, user: json.user };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        error: toUserFriendlyError(
          e instanceof Error ? e.message : "Network error",
        ),
      };
    }
  },
};

// ─── Data Loading from Server ─────────────────────────────────────────────────

export interface ServerData {
  courses?: Array<Record<string, unknown>>;
  chapters?: Array<Record<string, unknown>>;
  courseChapters?: Array<Record<string, unknown>>;
  students?: Array<Record<string, unknown>>;
  exams?: Array<Record<string, unknown>>;
  grades?: Array<Record<string, unknown>>;
  opportunityLogs?: Array<Record<string, unknown>>;
  studentLeaves?: Array<Record<string, unknown>>;
  studentCalls?: Array<Record<string, unknown>>;
  studentNotes?: Array<Record<string, unknown>>;
  correctionSheets?: Array<Record<string, unknown>>;
  users?: Array<Record<string, unknown>>;
  roles?: Array<Record<string, unknown>>;
  logs?: Array<Record<string, unknown>>;
}

export interface StudentListQuery {
  q?: string;
  status?: string;
  courseProgram?: string;
  courseTerm?: string;
  studyType?: string;
  location?: string;
  courseId?: string;
  courseIds?: string;
  page?: number;
  pageSize?: number;
}

export interface StudentListResponse {
  students: Array<Record<string, unknown>>;
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}

export interface GradeListQuery {
  examId?: string;
  studentId?: string;
  status?: string;
  q?: string;
  courseId?: string;
  nameLetter?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_STUDENT_PAGE_SIZE = 50;
const DEFAULT_GRADE_PAGE_SIZE = 100;
const LIST_ALL_PAGE_SIZE = 200;
const LIST_ALL_MAX_PAGES = 5;

export interface GradeListResponse {
  grades: Array<Record<string, unknown>>;
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}

function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    searchParams.set(key, String(value));
  });
  return searchParams.toString();
}

/**
 * Load all data from the server via parallel per-resource endpoints.
 *
 * Previously this tried /api/backup first (one huge JSON response with
 * all tables). Now it uses only lightweight per-resource endpoints in
 * parallel and deliberately skips heavy tables (students and grades) on
 * the first load. Those datasets are loaded by their own screens using
 * paginated/search endpoints.
 *
 * Why this matters: opening the app must not download thousands of students
 * and grades before the user even chooses a page. /api/backup remains
 * available only for the dedicated backup/export feature.
 *
 * Returns null if the session is invalid (401) or no data could be loaded.
 */
export async function loadAllFromServer(): Promise<ServerData | null> {
  // First check if the session is valid at all.
  const sessionCheck = await apiGetResponse<{ user: unknown }>(
    "auth/session",
    [401],
  );
  if (sessionCheck.status === 401) return null;

  const endpointLoaders = [
    apiGetResponse<Pick<ServerData, "courses">>("courses", [403]),
    apiGetResponse<Pick<ServerData, "chapters">>("chapters", [403]),
    // Heavy, fast-growing tables are intentionally not loaded here:
    // course-chapters, opportunity-logs, student-leaves, student-calls,
    // student-notes, correction-sheets, logs, students and grades.
    // Their screens/actions load them lazily so the first app open stays light.
    apiGetResponse<Pick<ServerData, "exams">>("exams", [403]),
    apiGetResponse<Pick<ServerData, "users">>("users", [403]),
    apiGetResponse<Pick<ServerData, "roles">>("roles", [403]),
  ];
  const results = await Promise.all(endpointLoaders);
  const merged = results.reduce<ServerData>((acc, result) => {
    if (result.ok && result.data) Object.assign(acc, result.data);
    return acc;
  }, {});

  // Opportunistically flush any pending mutations from a previous session.
  try {
    const { flushOutbox } = require("./mutation-outbox");
    void flushOutbox();
  } catch {
    // SSR; skip.
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

// ─── Course API ───────────────────────────────────────────────────────────────

export const courseApi = {
  add: (course: Record<string, unknown>) => apiPost("courses", course),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("courses", { id, ...updates }),
  remove: (id: string) => apiDelete("courses", id),
};

// ─── Chapter API ──────────────────────────────────────────────────────────────

export const chapterApi = {
  add: (chapter: { id: string; name: string; opportunities: number }) =>
    apiPost("chapters", chapter),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("chapters", { id, ...updates }),
  remove: (id: string) => apiDelete("chapters", id),
};

// ─── CourseChapter API ────────────────────────────────────────────────────────

export const courseChapterApi = {
  list: () => apiGet<Pick<ServerData, "courseChapters">>("course-chapters?page=1&pageSize=200"),
  add: (cc: {
    id: string;
    courseId: string;
    chapterId: string;
    active: boolean;
    archived: boolean;
    archive: string;
  }) => apiPost("course-chapters", cc),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("course-chapters", { id, ...updates }),
  remove: (id: string) => apiDelete("course-chapters", id),
};

// ─── Student API ──────────────────────────────────────────────────────────────

export const studentApi = {
  list: async (
    query: StudentListQuery = {},
  ): Promise<StudentListResponse | null> => {
    const queryString = buildQueryString({
      q: query.q,
      status: query.status,
      courseProgram: query.courseProgram,
      courseTerm: query.courseTerm,
      studyType: query.studyType,
      location: query.location,
      courseId: query.courseId,
      courseIds: query.courseIds,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_STUDENT_PAGE_SIZE,
    });
    return apiGet<StudentListResponse>(
      `students${queryString ? `?${queryString}` : ""}`,
    );
  },
  add: (student: Record<string, unknown>) => apiPost("students", student),
  listAll: async (
    query: StudentListQuery = {},
  ): Promise<StudentListResponse | null> => {
    const pageSize = Math.min(Math.max(Number(query.pageSize || LIST_ALL_PAGE_SIZE), 1), LIST_ALL_PAGE_SIZE);
    const collected: Array<Record<string, unknown>> = [];
    let page = 1;
    let totalCount = 0;
    let totalPages = 1;

    while (page <= totalPages && page <= LIST_ALL_MAX_PAGES) {
      const result = await studentApi.list({ ...query, page, pageSize });
      if (!result) return null;
      totalCount = Number(result.totalCount || 0);
      totalPages = Math.max(1, Number(result.totalPages || 1));
      collected.push(...(result.students || []));
      if (!result.hasMore) break;
      page += 1;
    }

    return {
      students: collected,
      totalCount,
      page: 1,
      pageSize,
      totalPages,
      hasMore: collected.length < totalCount,
    };
  },
  bulkAdd: (students: Array<Record<string, unknown>>) =>
    apiPost("students/bulk", { students }),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("students", { id, ...updates }),
  remove: (id: string) => apiDelete("students", id),
};

// ─── Exam API ─────────────────────────────────────────────────────────────────

export const examApi = {
  add: (exam: Record<string, unknown>) => apiPost("exams", exam),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("exams", { id, ...updates }),
  remove: (id: string) => apiDelete("exams", id),
};

// ─── Grade API ────────────────────────────────────────────────────────────────

export const gradeApi = {
  list: async (
    query: GradeListQuery = {},
  ): Promise<GradeListResponse | null> => {
    const queryString = buildQueryString({
      examId: query.examId,
      studentId: query.studentId,
      status: query.status,
      q: query.q,
      courseId: query.courseId,
      nameLetter: query.nameLetter,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_GRADE_PAGE_SIZE,
    });
    return apiGet<GradeListResponse>(
      `grades${queryString ? `?${queryString}` : ""}`,
    );
  },
  add: (grade: Record<string, unknown>) => apiPost("grades", grade),
  listAll: async (
    query: GradeListQuery = {},
  ): Promise<GradeListResponse | null> => {
    const pageSize = Math.min(Math.max(Number(query.pageSize || LIST_ALL_PAGE_SIZE), 1), LIST_ALL_PAGE_SIZE);
    const collected: Array<Record<string, unknown>> = [];
    let page = 1;
    let totalCount = 0;
    let totalPages = 1;

    while (page <= totalPages && page <= LIST_ALL_MAX_PAGES) {
      const result = await gradeApi.list({ ...query, page, pageSize });
      if (!result) return null;
      totalCount = Number(result.totalCount || 0);
      totalPages = Math.max(1, Number(result.totalPages || 1));
      collected.push(...(result.grades || []));
      if (!result.hasMore) break;
      page += 1;
    }

    return {
      grades: collected,
      totalCount,
      page: 1,
      pageSize,
      totalPages,
      hasMore: collected.length < totalCount,
    };
  },
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("grades", { id, ...updates }),
  remove: (id: string, studentId?: string, examId?: string) =>
    apiDelete("grades", id, { studentId, examId }),
  removeAbsentByExam: async (examId: string): Promise<ApiResult> => {
    try {
      const params = new URLSearchParams({ examId, status: "غائب" });
      const res = await fetch(`/api/grades?${params.toString()}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const error = await readApiError(
          res,
          `تعذر إلغاء حالات الغياب (رمز ${res.status})`,
        );
        console.warn("[API] DELETE /api/grades absent-by-exam failed:", error);
        return {
          ok: false,
          error,
          status: res.status,
          transient: isTransientHttpStatus(res.status),
        };
      }
      return { ok: true };
    } catch (e) {
      const msg = toUserFriendlyError(
        e instanceof Error ? e.message : "Network error",
      );
      console.warn("[API] DELETE /api/grades absent-by-exam network error:", e);
      return { ok: false, error: msg, status: 0, transient: true };
    }
  },
};

// ─── OpportunityLog API ───────────────────────────────────────────────────────

export const opportunityLogApi = {
  list: () => apiGet<Pick<ServerData, "opportunityLogs">>("opportunity-logs?page=1&pageSize=200"),
  add: (log: Record<string, unknown>) => apiPost("opportunity-logs", log),
  bulkAdjust: (payload: {
    students?: Array<Record<string, unknown>>;
    opportunityLogs?: Array<Record<string, unknown>>;
    studentNotes?: Array<Record<string, unknown>>;
  }) => apiPost("opportunities/bulk-adjust", payload),
  remove: (id: string) => apiDelete("opportunity-logs", id),
};

// ─── Follow-up API ───────────────────────────────────────────────────────────

export const studentLeaveApi = {
  list: () => apiGet<Pick<ServerData, "studentLeaves">>("student-leaves?page=1&pageSize=200"),
  add: (leave: Record<string, unknown>) => apiPost("student-leaves", leave),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("student-leaves", { id, ...updates }),
  remove: (id: string) => apiDelete("student-leaves", id),
};

export const studentCallApi = {
  list: () => apiGet<Pick<ServerData, "studentCalls">>("student-calls?page=1&pageSize=200"),
  add: (call: Record<string, unknown>) => apiPost("student-calls", call),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("student-calls", { id, ...updates }),
  remove: (id: string) => apiDelete("student-calls", id),
};

export const studentNoteApi = {
  list: () => apiGet<Pick<ServerData, "studentNotes">>("student-notes?page=1&pageSize=200"),
  add: (note: Record<string, unknown>) => apiPost("student-notes", note),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("student-notes", { id, ...updates }),
  remove: (id: string) => apiDelete("student-notes", id),
};

// ─── CorrectionSheet API ──────────────────────────────────────────────────────

export const correctionSheetApi = {
  list: () => apiGet<Pick<ServerData, "correctionSheets">>("correction-sheets?page=1&pageSize=200"),
  add: (sheet: Record<string, unknown>) => apiPost("correction-sheets", sheet),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("correction-sheets", { id, ...updates }),
  remove: (id: string) => apiDelete("correction-sheets", id),
};

// ─── User API ─────────────────────────────────────────────────────────────────

export const userApi = {
  add: (user: Record<string, unknown>) => apiPost("users", user),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("users", { id, ...updates }),
  remove: (id: string) => apiDelete("users", id),
};

// ─── Role API ─────────────────────────────────────────────────────────────────

export const roleApi = {
  add: (role: Record<string, unknown>) => apiPost("roles", role),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("roles", { id, ...updates }),
  remove: (id: string) => apiDelete("roles", id),
};

// ─── Log API ──────────────────────────────────────────────────────────────────

export const logApi = {
  list: () => apiGet<Pick<ServerData, "logs">>("logs?page=1&pageSize=200"),
  add: async (log: Record<string, unknown>): Promise<ApiResult> => {
    // Use direct fetch instead of apiPost so that 403 responses (server-only
    // audit entries) don't trigger console.warn noise. The UI creates local
    // log entries for immediate feedback, but the server correctly rejects
    // sensitive (module/action) pairs with 403. We treat 403 as a successful
    // local-only audit entry so it doesn't trigger sync-error notifications
    // or outbox retries. Real audit records for sensitive actions are
    // written by the corresponding server route after the DB mutation.
    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(log),
      });
      if (res.ok) return { ok: true };
      if (res.status === 403) return { ok: true }; // server-only entry — expected
      // Other errors (4xx except 403, 5xx) are real failures.
      const error = await readApiError(res, `تعذر حفظ السجل (رمز ${res.status})`);
      return { ok: false, error, status: res.status, transient: isTransientHttpStatus(res.status) };
    } catch (e) {
      const msg = toUserFriendlyError(e instanceof Error ? e.message : 'Network error');
      return { ok: false, error: msg, status: 0, transient: true };
    }
  },
  clear: (password: string, options?: Record<string, unknown>) =>
    apiPost('logs/clear', { password, ...(options || {}) }),
  restoreLastClear: async (password: string): Promise<ApiResult> => {
    try {
      const res = await fetch('/api/logs/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const error = await readApiError(res, `تعذر استعادة السجلات (رمز ${res.status})`);
        return { ok: false, error, status: res.status, transient: isTransientHttpStatus(res.status) };
      }
      return { ok: true };
    } catch (e) {
      const msg = toUserFriendlyError(e instanceof Error ? e.message : 'Network error');
      return { ok: false, error: msg, status: 0, transient: true };
    }
  },
};
