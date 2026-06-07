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
}

async function apiPost(endpoint: string, data: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await readApiError(res, `تعذر حفظ البيانات (رمز ${res.status})`);
      console.warn(`[API] POST /api/${endpoint} failed:`, error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    const msg = toUserFriendlyError(e instanceof Error ? e.message : 'Network error');
    console.warn(`[API] POST /api/${endpoint} network error:`, e);
    return { ok: false, error: msg };
  }
}

async function apiPut(endpoint: string, data: Record<string, unknown>): Promise<ApiResult> {
  try {
    const res = await fetch(`/api/${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await readApiError(res, `تعذر تحديث البيانات (رمز ${res.status})`);
      console.warn(`[API] PUT /api/${endpoint} failed:`, error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    const msg = toUserFriendlyError(e instanceof Error ? e.message : 'Network error');
    console.warn(`[API] PUT /api/${endpoint} network error:`, e);
    return { ok: false, error: msg };
  }
}

async function apiDelete(endpoint: string, id: string): Promise<ApiResult> {
  try {
    const res = await fetch(`/api/${endpoint}?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await readApiError(res, `تعذر حذف السجل (رمز ${res.status})`);
      console.warn(`[API] DELETE /api/${endpoint} failed:`, error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    const msg = toUserFriendlyError(e instanceof Error ? e.message : 'Network error');
    console.warn(`[API] DELETE /api/${endpoint} network error:`, e);
    return { ok: false, error: msg };
  }
}

async function apiGet<T>(endpoint: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/${endpoint}`);
    if (!res.ok) {
      console.warn(`[API] GET /api/${endpoint} failed:`, await readApiError(res, 'تعذر تحميل البيانات'));
      return null;
    }
    const json = await res.json();
    return json as T;
  } catch (e) {
    console.warn(`[API] GET /api/${endpoint} error:`, e);
    return null;
  }
}

// ─── Data Loading from Server ─────────────────────────────────────────────────

export interface ServerData {
  courses?: Array<Record<string, unknown>>;
  groups?: Array<Record<string, unknown>>;
  sites?: Array<Record<string, unknown>>;
  chapters?: Array<Record<string, unknown>>;
  courseChapters?: Array<Record<string, unknown>>;
  students?: Array<Record<string, unknown>>;
  exams?: Array<Record<string, unknown>>;
  grades?: Array<Record<string, unknown>>;
  opportunityLogs?: Array<Record<string, unknown>>;
  correctionSheets?: Array<Record<string, unknown>>;
  users?: Array<Record<string, unknown>>;
  roles?: Array<Record<string, unknown>>;
  demoCopies?: Array<Record<string, unknown>>;
  logs?: Array<Record<string, unknown>>;
  whatsappReports?: Array<Record<string, unknown>>;
  whatsappQueue?: Array<Record<string, unknown>>;
}

/**
 * Load all data from the server via the backup endpoint.
 * Returns null if the API is unavailable or returns empty data.
 */
export async function loadAllFromServer(): Promise<ServerData | null> {
  const data = await apiGet<ServerData>('backup');
  if (!data) return null;
  // An empty-but-valid database response is still a successful connection.
  // The store decides which default records should be filled in locally/seeded safely.
  return data;
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

// ─── Group API ────────────────────────────────────────────────────────────────

export const groupApi = {
  add: (group: { id: string; name: string; courseId: string; electronicGroup: string; active: boolean }) =>
    apiPost('groups', group),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('groups', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('groups', id),
};

// ─── Site API ─────────────────────────────────────────────────────────────────

export const siteApi = {
  add: (site: { id: string; courseId: string; main: string; sub: string; active: boolean }) =>
    apiPost('sites', site),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('sites', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('sites', id),
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
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('grades', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('grades', id),
};

// ─── OpportunityLog API ───────────────────────────────────────────────────────

export const opportunityLogApi = {
  add: (log: Record<string, unknown>) =>
    apiPost('opportunity-logs', log),
  remove: (id: string) =>
    apiDelete('opportunity-logs', id),
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
  add: (log: Record<string, unknown>) =>
    apiPost('logs', log),
};

// ─── DemoCopy API ─────────────────────────────────────────────────────────────

export const demoCopyApi = {
  add: (demo: Record<string, unknown>) =>
    apiPost('demo-copies', demo),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut('demo-copies', { id, ...updates }),
  remove: (id: string) =>
    apiDelete('demo-copies', id),
};

// ─── Push all localStorage data to server (initial sync) ─────────────────────

export async function pushAllToServer(data: {
  courses: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  sites: Array<Record<string, unknown>>;
  chapters: Array<Record<string, unknown>>;
  courseChapters: Array<Record<string, unknown>>;
  students: Array<Record<string, unknown>>;
  exams: Array<Record<string, unknown>>;
  grades: Array<Record<string, unknown>>;
  opportunityLogs: Array<Record<string, unknown>>;
  correctionSheets: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  roles: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
  whatsappReports: Array<Record<string, unknown>>;
  whatsappQueue: Array<Record<string, unknown>>;
}): Promise<void> {
  // Push each entity type in parallel
  const promises: Promise<ApiResult>[] = [];

  for (const course of data.courses) {
    promises.push(apiPost('courses', course));
  }
  for (const group of data.groups) {
    promises.push(apiPost('groups', group));
  }
  for (const site of data.sites) {
    promises.push(apiPost('sites', site));
  }
  for (const chapter of data.chapters) {
    promises.push(apiPost('chapters', chapter));
  }
  for (const cc of data.courseChapters) {
    promises.push(apiPost('course-chapters', cc));
  }
  for (const student of data.students) {
    promises.push(apiPost('students', student));
  }
  for (const exam of data.exams) {
    promises.push(apiPost('exams', exam));
  }
  for (const grade of data.grades) {
    promises.push(apiPost('grades', grade));
  }
  for (const log of data.opportunityLogs) {
    promises.push(apiPost('opportunity-logs', log));
  }
  for (const sheet of data.correctionSheets) {
    promises.push(apiPost('correction-sheets', sheet));
  }
  for (const user of data.users) {
    promises.push(apiPost('users', user));
  }
  for (const role of data.roles) {
    promises.push(apiPost('roles', role));
  }
  for (const log of data.logs) {
    promises.push(apiPost('logs', log));
  }
  for (const report of data.whatsappReports) {
    void report;
  }
  for (const msg of data.whatsappQueue) {
    void msg;
  }

  await Promise.allSettled(promises);
}
