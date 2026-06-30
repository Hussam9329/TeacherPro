/**
 * TeacherPro — API Service Layer
 * Handles all communication between the Zustand store and the backend API routes (Prisma/PostgreSQL).
 *
 * IMPORTANT: Mutations (POST/PUT/DELETE) return { ok: boolean, error?: string } so the
 * store can decide whether to update local state or show an error. This prevents the
 * "phantom delete" bug where the UI shows success but the database rejected the operation.
 */

// ─── Generic Helpers ──────────────────────────────────────────────────────────

function toUserFriendlyError(raw: unknown, fallback = 'تعذر تنفيذ العملية حالياً. حاول مرة أخرى.'): string {
  const message = typeof raw === 'string' ? raw : fallback;
  const normalized = message.toLowerCase();

  if (!message.trim()) return fallback;
  if (normalized.includes('failed to fetch') || normalized.includes('networkerror') || normalized.includes('network error')) {
    return 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مرة أخرى.';
  }
  if (normalized.includes('unexpected token') || normalized.includes('json')) {
    return 'استجابة الخادم غير مفهومة. حاول تحديث الصفحة.';
  }
  if (normalized.includes('id is required')) {
    return 'تعذر تحديد السجل المطلوب. حدّث الصفحة ثم حاول مرة أخرى.';
  }
  if (normalized.includes('foreign key') || normalized.includes('constraint')) {
    return 'لا يمكن تنفيذ العملية لأن السجل مرتبط ببيانات أخرى.';
  }
  if (/^http\s?\d{3}$/i.test(message.trim())) {
    return 'تعذر تنفيذ العملية على الخادم. حاول مرة أخرى.';
  }

  return message;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const err = await res.json().catch(() => null) as { error?: unknown; message?: unknown } | null;
    return toUserFriendlyError(err?.error ?? err?.message, fallback);
  }
  const text = await res.text().catch(() => '');
  return toUserFriendlyError(text, fallback);
}

export interface ApiResult {
  ok: boolean;
  error?: string;
  status?: number;
  transient?: boolean;
  queued?: boolean;
}

function isTransientHttpStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryTransientMutation(run: () => Promise<ApiResult>, attempts = 3): Promise<ApiResult> {
  let lastResult: ApiResult = { ok: false, error: 'تعذر تنفيذ العملية حالياً.', transient: true, status: 0 };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = await run();
    if (lastResult.ok || !lastResult.transient || attempt === attempts) return lastResult;
    await delay(250 * attempt);
  }
  return lastResult;
}

async function apiPost(endpoint: string, data: unknown): Promise<ApiResult> {
  const result = await retryTransientMutation(async () => {
    try {
      const res = await fetch(`/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await readApiError(res, `تعذر حفظ البيانات (رمز ${res.status})`);
        console.warn(`[API] POST /api/${endpoint} failed:`, error);
        return { ok: false, error, status: res.status, transient: isTransientHttpStatus(res.status) };
      }
      return { ok: true };
    } catch (e) {
      const msg = toUserFriendlyError(e instanceof Error ? e.message : 'Network error');
      console.warn(`[API] POST /api/${endpoint} network error:`, e);
      return { ok: false, error: msg, status: 0, transient: true };
    }
  });
  // If all retries exhausted on a transient failure, queue to outbox
  // so the mutation survives page reloads and is retried when network returns.
  if (!result.ok && result.transient) {
    try {
      const { queueOnly } = require('./mutation-outbox');
      queueOnly({
        endpoint: `/api/${endpoint}`,
        method: 'POST',
        payload: data,
      });
      return { ...result, queued: true };
    } catch {
      // mutation-outbox not available (SSR); return as-is.
    }
  }
  return result;
}

async function apiPut(endpoint: string, data: Record<string, unknown>): Promise<ApiResult> {
  const result = await retryTransientMutation(async () => {
    try {
      const res = await fetch(`/api/${endpoint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await readApiError(res, `تعذر تحديث البيانات (رمز ${res.status})`);
        console.warn(`[API] PUT /api/${endpoint} failed:`, error);
        return { ok: false, error, status: res.status, transient: isTransientHttpStatus(res.status) };
      }
      return { ok: true };
    } catch (e) {
      const msg = toUserFriendlyError(e instanceof Error ? e.message : 'Network error');
      console.warn(`[API] PUT /api/${endpoint} network error:`, e);
      return { ok: false, error: msg, status: 0, transient: true };
    }
  });
  if (!result.ok && result.transient) {
    try {
      const { queueOnly } = require('./mutation-outbox');
      queueOnly({
        endpoint: `/api/${endpoint}`,
        method: 'PUT',
        payload: data,
      });
      return { ...result, queued: true };
    } catch {
      // SSR; return as-is.
    }
  }
  return result;
}

async function apiDelete(endpoint: string, id: string, extraParams: Record<string, string | undefined> = {}): Promise<ApiResult> {
  const params = new URLSearchParams();
  params.set('id', id);
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const queryString = params.toString();
  const fullEndpoint = `/api/${endpoint}?${queryString}`;

  const result = await retryTransientMutation(async () => {
    try {
      const res = await fetch(fullEndpoint, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const error = await readApiError(res, `تعذر حذف السجل (رمز ${res.status})`);
        console.warn(`[API] DELETE /api/${endpoint} failed:`, error);
        return { ok: false, error, status: res.status, transient: isTransientHttpStatus(res.status) };
      }
      return { ok: true };
    } catch (e) {
      const msg = toUserFriendlyError(e instanceof Error ? e.message : 'Network error');
      console.warn(`[API] DELETE /api/${endpoint} network error:`, e);
      return { ok: false, error: msg, status: 0, transient: true };
    }
  });
  if (!result.ok && result.transient) {
    try {
      const { queueOnly } = require('./mutation-outbox');
      queueOnly({
        endpoint: fullEndpoint,
        method: 'DELETE',
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

async function apiGetResponse<T>(endpoint: string, quietStatuses: number[] = []): Promise<ApiGetResponse<T>> {
  try {
    const res = await fetch(`/api/${endpoint}`, { credentials: 'same-origin' });
    if (!res.ok) {
      const error = await readApiError(res, 'تعذر تحميل البيانات');
      if (!quietStatuses.includes(res.status)) {
        console.warn(`[API] GET /api/${endpoint} failed:`, error);
      }
      return { ok: false, status: res.status, data: null, error };
    }
    const json = await res.json();
    return { ok: true, status: res.status, data: json as T };
  } catch (e) {
    console.warn(`[API] GET /api/${endpoint} error:`, e);
    return { ok: false, status: 0, data: null, error: toUserFriendlyError(e instanceof Error ? e.message : 'Network error') };
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const error = await readApiError(res, 'تعذر تسجيل الدخول');
        return { ok: false, error };
      }
      const json = await res.json() as { user?: AuthApiUser };
      return { ok: true, user: json.user };
    } catch (e) {
      return { ok: false, error: toUserFriendlyError(e instanceof Error ? e.message : 'Network error') };
    }
  },
  logout: async (): Promise<ApiResult> => {
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) return { ok: false, error: await readApiError(res, 'تعذر تسجيل الخروج') };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: toUserFriendlyError(e instanceof Error ? e.message : 'Network error') };
    }
  },
  session: async (): Promise<AuthApiResult> => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (!res.ok) return { ok: false, status: res.status, error: await readApiError(res, 'تعذر التحقق من الجلسة حالياً') };
      const json = await res.json() as { user?: AuthApiUser };
      return { ok: true, user: json.user };
    } catch (e) {
      return { ok: false, status: 0, error: toUserFriendlyError(e instanceof Error ? e.message : 'Network error') };
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

/**
 * Load all data from the server via parallel per-resource endpoints.
 *
 * Previously this tried /api/backup first (one huge JSON response with
 * all tables). Now it always uses the per-resource endpoints in parallel
 * because:
 *   - Parallel small requests are faster than one huge request on Vercel
 *   - Each endpoint respects per-resource permissions (non-admin users
 *     get 403 on resources they can't see, which is silently skipped)
 *   - /api/backup remains available for the dedicated backup/export feature
 *
 * Returns null if the session is invalid (401) or no data could be loaded.
 */
export async function loadAllFromServer(): Promise<ServerData | null> {
  // First check if the session is valid at all.
  const sessionCheck = await apiGetResponse<{ user: unknown }>('auth/session', [401]);
  if (sessionCheck.status === 401) return null;

  const endpointLoaders = [
    apiGetResponse<Pick<ServerData, 'courses'>>('courses', [403]),
    apiGetResponse<Pick<ServerData, 'chapters'>>('chapters', [403]),
    apiGetResponse<Pick<ServerData, 'courseChapters'>>('course-chapters', [403]),
    apiGetResponse<Pick<ServerData, 'students'>>('students', [403]),
    apiGetResponse<Pick<ServerData, 'exams'>>('exams', [403]),
    apiGetResponse<Pick<ServerData, 'grades'>>('grades', [403]),
    apiGetResponse<Pick<ServerData, 'opportunityLogs'>>('opportunity-logs', [403]),
    apiGetResponse<Pick<ServerData, 'studentLeaves'>>('student-leaves', [403]),
    apiGetResponse<Pick<ServerData, 'studentCalls'>>('student-calls', [403]),
    apiGetResponse<Pick<ServerData, 'studentNotes'>>('student-notes', [403]),
    apiGetResponse<Pick<ServerData, 'correctionSheets'>>('correction-sheets', [403]),
    apiGetResponse<Pick<ServerData, 'users'>>('users', [403]),
    apiGetResponse<Pick<ServerData, 'roles'>>('roles', [403]),
    apiGetResponse<Pick<ServerData, 'logs'>>('logs', [403]),
  ];
  const results = await Promise.all(endpointLoaders);
  const merged = results.reduce<ServerData>((acc, result) => {
    if (result.ok && result.data) Object.assign(acc, result.data);
    return acc;
  }, {});

  // Opportunistically flush any pending mutations from a previous session.
  try {
    const { flushOutbox } = require('./mutation-outbox');
    void flushOutbox();
  } catch {
    // SSR; skip.
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

// ─── Course API ───────────────────────────────────────────────────────────────

export const courseApi = {
  add: (course: Record<string, unknown>) =>
    apiPost('courses', course),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('courses', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('courses', id),
};


// ─── Chapter API ──────────────────────────────────────────────────────────────

export const chapterApi = {
  add: (chapter: { id: string; name: string; opportunities: number }) =>
    apiPost('chapters', chapter),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('chapters', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('chapters', id),
};

// ─── CourseChapter API ────────────────────────────────────────────────────────

export const courseChapterApi = {
  add: (cc: { id: string; courseId: string; chapterId: string; active: boolean; archived: boolean; archive: string }) =>
    apiPost('course-chapters', cc),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('course-chapters', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('course-chapters', id),
};

// ─── Student API ──────────────────────────────────────────────────────────────

export const studentApi = {
  add: (student: Record<string, unknown>) =>
    apiPost('students', student),
  bulkAdd: (students: Array<Record<string, unknown>>) =>
    apiPost('students/bulk', { students }),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('students', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('students', id),
};

// ─── Exam API ─────────────────────────────────────────────────────────────────

export const examApi = {
  add: (exam: Record<string, unknown>) =>
    apiPost('exams', exam),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('exams', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('exams', id),
};

// ─── Grade API ────────────────────────────────────────────────────────────────

export const gradeApi = {
  add: (grade: Record<string, unknown>) =>
    apiPost('grades', grade),
  bulkAdd: (grades: Array<Record<string, unknown>>) =>
    apiPost('grades/bulk', { grades }),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('grades', { id, ...updates }),
  remove: (id: string, studentId?: string, examId?: string) =>
    apiDelete('grades', id, { studentId, examId }),
  removeAbsentByExam: async (examId: string): Promise<ApiResult> => {
    try {
      const params = new URLSearchParams({ examId, status: 'غائب' });
      const res = await fetch(`/api/grades?${params.toString()}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const error = await readApiError(res, `تعذر إلغاء حالات الغياب (رمز ${res.status})`);
        console.warn('[API] DELETE /api/grades absent-by-exam failed:', error);
        return { ok: false, error, status: res.status, transient: isTransientHttpStatus(res.status) };
      }
      return { ok: true };
    } catch (e) {
      const msg = toUserFriendlyError(e instanceof Error ? e.message : 'Network error');
      console.warn('[API] DELETE /api/grades absent-by-exam network error:', e);
      return { ok: false, error: msg, status: 0, transient: true };
    }
  },
};

// ─── OpportunityLog API ───────────────────────────────────────────────────────

export const opportunityLogApi = {
  add: (log: Record<string, unknown>) =>
    apiPost('opportunity-logs', log),
  bulkAdjust: (payload: { students?: Array<Record<string, unknown>>; opportunityLogs?: Array<Record<string, unknown>>; studentNotes?: Array<Record<string, unknown>> }) =>
    apiPost('opportunities/bulk-adjust', payload),
  remove: (id: string) =>
    apiDelete('opportunity-logs', id),
};


// ─── Follow-up API ───────────────────────────────────────────────────────────

export const studentLeaveApi = {
  add: (leave: Record<string, unknown>) =>
    apiPost('student-leaves', leave),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('student-leaves', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('student-leaves', id),
};

export const studentCallApi = {
  add: (call: Record<string, unknown>) =>
    apiPost('student-calls', call),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('student-calls', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('student-calls', id),
};

export const studentNoteApi = {
  add: (note: Record<string, unknown>) =>
    apiPost('student-notes', note),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('student-notes', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('student-notes', id),
};

// ─── CorrectionSheet API ──────────────────────────────────────────────────────

export const correctionSheetApi = {
  add: (sheet: Record<string, unknown>) =>
    apiPost('correction-sheets', sheet),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('correction-sheets', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('correction-sheets', id),
};

// ─── User API ─────────────────────────────────────────────────────────────────

export const userApi = {
  add: (user: Record<string, unknown>) =>
    apiPost('users', user),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('users', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('users', id),
};

// ─── Role API ─────────────────────────────────────────────────────────────────

export const roleApi = {
  add: (role: Record<string, unknown>) =>
    apiPost('roles', role),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('roles', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('roles', id),
};

// ─── Log API ──────────────────────────────────────────────────────────────────

export const logApi = {
  add: async (log: Record<string, unknown>): Promise<ApiResult> => {
    const result = await apiPost('logs', log);

    // Some audit entries are intentionally server-only after the security
    // hardening phase. The UI may still create a local log for immediate
    // history, but the backend correctly rejects saving that specific
    // (module/action) from the client with 403. Treat that as a successful
    // local-only audit entry so it does not trigger repeated "Server sync"
    // errors or outbox retries. Real audit records for sensitive actions are
    // written by the corresponding server route after the DB mutation.
    if (!result.ok && result.status === 403) {
      return { ok: true };
    }

    return result;
  },
  clear: (password: string) =>
    apiPost('logs/clear', { password }),
};
