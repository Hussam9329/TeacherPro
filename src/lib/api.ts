import {
  beginTeacherProInteractionBlocker,
  inferTeacherProScopesFromEndpoint,
} from "./teacherpro-sync";
import { mutationCanBeReplayed } from "./mutation-replay-policy";

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
    return "تعذر الاتصال بالنظام. تحقق من الإنترنت ثم حاول مرة أخرى.";
  }
  if (normalized.includes("unexpected token") || normalized.includes("json")) {
    return "استجابة النظام غير مفهومة. حاول تحديث الصفحة.";
  }
  if (normalized.includes("id is required")) {
    return "تعذر تحديد السجل المطلوب. حدّث الصفحة ثم حاول مرة أخرى.";
  }
  if (normalized.includes("foreign key") || normalized.includes("constraint")) {
    return "لا يمكن تنفيذ العملية لأن السجل مرتبط ببيانات أخرى.";
  }
  if (/^http\s?\d{3}$/i.test(message.trim())) {
    return "تعذر تنفيذ العملية على النظام. حاول مرة أخرى.";
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
  syncScopes?: string[];
  outcomeUnknown?: boolean;
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

function isTransientHttpResponse(res: Response): boolean {
  const explicit = String(
    res.headers.get("x-teacherpro-retryable") || "",
  ).toLowerCase();
  if (explicit === "0" || explicit === "false" || explicit === "no") {
    return false;
  }
  if (explicit === "1" || explicit === "true" || explicit === "yes") {
    return true;
  }
  return isTransientHttpStatus(res.status);
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
  const releaseBlocker = beginTeacherProInteractionBlocker("api-post");
  try {
    const runOnce = async (): Promise<ApiResult> => {
      try {
        const res = await fetch(`/api/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const errorData = await res.clone().json().catch(() => null);
          const error = await readApiError(
            res,
            `تعذر حفظ البيانات (رمز ${res.status})`,
          );
          console.warn(`[API] POST /api/${endpoint} failed:`, error);
          return {
            ok: false,
            error,
            status: res.status,
            transient: isTransientHttpResponse(res),
            data: errorData,
          };
        }
        const contentType = res.headers.get("content-type") || "";
        const responseData = contentType.includes("application/json")
          ? await res.json().catch(() => null)
          : null;
        return {
          ok: true,
          data: responseData,
          syncScopes: inferTeacherProScopesFromEndpoint(`/api/${endpoint}`),
        };
      } catch (e) {
        const msg = toUserFriendlyError(
          e instanceof Error ? e.message : "Network error",
        );
        console.warn(`[API] POST /api/${endpoint} network error:`, e);
        return { ok: false, error: msg, status: 0, transient: true };
      }
    };
    const replaySafe = mutationCanBeReplayed(`/api/${endpoint}`, "POST", data);
    const result = replaySafe
      ? await retryTransientMutation(runOnce)
      : await runOnce();

    // If all retries exhausted on a transient failure, queue to outbox
    // so the mutation survives page reloads and is retried when network returns.
    if (!result.ok && result.transient && replaySafe) {
      try {
        const { queueOnly } = require("./mutation-outbox");
        queueOnly({
          endpoint: `/api/${endpoint}`,
          method: "POST",
          payload: data,
        });
        return {
          ...result,
          queued: true,
          syncScopes: inferTeacherProScopesFromEndpoint(`/api/${endpoint}`),
        };
      } catch {
        // mutation-outbox not available (SSR); return as-is.
      }
    }
    if (!result.ok && result.transient && !replaySafe) {
      return {
        ...result,
        outcomeUnknown: true,
        error:
          "انقطع الاتصال أثناء عملية غير قابلة للتكرار بأمان. حدّث البيانات للتحقق هل نُفذت، ثم أعدها يدوياً فقط إذا لم تظهر.",
      };
    }
    return result;
  } finally {
    releaseBlocker();
  }
}

async function apiPut(
  endpoint: string,
  data: Record<string, unknown>,
): Promise<ApiResult> {
  const releaseBlocker = beginTeacherProInteractionBlocker("api-put");
  try {
    const runOnce = async (): Promise<ApiResult> => {
      try {
        const res = await fetch(`/api/${endpoint}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const errorData = await res.clone().json().catch(() => null);
          const error = await readApiError(
            res,
            `تعذر تحديث البيانات (رمز ${res.status})`,
          );
          console.warn(`[API] PUT /api/${endpoint} failed:`, error);
          return {
            ok: false,
            error,
            status: res.status,
            transient: isTransientHttpResponse(res),
            data: errorData,
          };
        }
        const contentType = res.headers.get("content-type") || "";
        const responseData = contentType.includes("application/json")
          ? await res.json().catch(() => null)
          : null;
        return {
          ok: true,
          data: responseData,
          syncScopes: inferTeacherProScopesFromEndpoint(`/api/${endpoint}`),
        };
      } catch (e) {
        const msg = toUserFriendlyError(
          e instanceof Error ? e.message : "Network error",
        );
        console.warn(`[API] PUT /api/${endpoint} network error:`, e);
        return { ok: false, error: msg, status: 0, transient: true };
      }
    };
    const replaySafe = mutationCanBeReplayed(`/api/${endpoint}`, "PUT", data);
    const result = replaySafe
      ? await retryTransientMutation(runOnce)
      : await runOnce();

    if (!result.ok && result.transient && replaySafe) {
      try {
        const { queueOnly } = require("./mutation-outbox");
        queueOnly({
          endpoint: `/api/${endpoint}`,
          method: "PUT",
          payload: data,
        });
        return {
          ...result,
          queued: true,
          syncScopes: inferTeacherProScopesFromEndpoint(`/api/${endpoint}`),
        };
      } catch {
        // SSR; return as-is.
      }
    }
    if (!result.ok && result.transient && !replaySafe) {
      return {
        ...result,
        outcomeUnknown: true,
        error:
          "انقطع الاتصال بعد إرسال تعديل محمي من التكرار. حدّث البيانات للتحقق من النتيجة؛ لا تعِد الحفظ قبل المراجعة.",
      };
    }
    return result;
  } finally {
    releaseBlocker();
  }
}

async function apiDelete(
  endpoint: string,
  id: string,
  extraParams: Record<string, string | undefined> = {},
): Promise<ApiResult> {
  const releaseBlocker = beginTeacherProInteractionBlocker("api-delete");
  try {
    const params = new URLSearchParams();
    params.set("id", id);
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const queryString = params.toString();
    const fullEndpoint = `/api/${endpoint}?${queryString}`;

    const runOnce = async (): Promise<ApiResult> => {
      try {
        const res = await fetch(fullEndpoint, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok) {
          const errorData = await res.clone().json().catch(() => null);
          const error = await readApiError(
            res,
            `تعذر حذف السجل (رمز ${res.status})`,
          );
          console.warn(`[API] DELETE /api/${endpoint} failed:`, error);
          return {
            ok: false,
            error,
            status: res.status,
            transient: isTransientHttpResponse(res),
            data: errorData,
          };
        }
        const contentType = res.headers.get("content-type") || "";
        const responseData = contentType.includes("application/json")
          ? await res.json().catch(() => null)
          : null;
        return {
          ok: true,
          data: responseData,
          syncScopes: inferTeacherProScopesFromEndpoint(fullEndpoint),
        };
      } catch (e) {
        const msg = toUserFriendlyError(
          e instanceof Error ? e.message : "Network error",
        );
        console.warn(`[API] DELETE /api/${endpoint} network error:`, e);
        return { ok: false, error: msg, status: 0, transient: true };
      }
    };
    const replaySafe = mutationCanBeReplayed(fullEndpoint, "DELETE");
    const result = replaySafe
      ? await retryTransientMutation(runOnce)
      : await runOnce();

    if (!result.ok && result.transient && replaySafe) {
      try {
        const { queueOnly } = require("./mutation-outbox");
        queueOnly({
          endpoint: fullEndpoint,
          method: "DELETE",
        });
        return {
          ...result,
          queued: true,
          syncScopes: inferTeacherProScopesFromEndpoint(fullEndpoint),
        };
      } catch {
        // SSR; return as-is.
      }
    }
    if (!result.ok && result.transient && !replaySafe) {
      return {
        ...result,
        outcomeUnknown: true,
        error:
          "انقطع الاتصال أثناء الحذف، لذلك لا يمكن تأكيد النتيجة بأمان. حدّث البيانات للتحقق قبل تكرار الحذف.",
      };
    }
    return result;
  } finally {
    releaseBlocker();
  }
}

interface ApiGetResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  aborted?: boolean;
}

type ApiGetOptions = {
  signal?: AbortSignal;
  quietAbort?: boolean;
  params?: Record<string, string | number | undefined>;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function apiGetResponse<T>(
  endpoint: string,
  quietStatuses: number[] = [],
  options: ApiGetOptions = {},
): Promise<ApiGetResponse<T>> {
  try {
    let url = `/api/${endpoint}`;
    if (options.params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null) search.set(key, String(value));
      }
      const qs = search.toString();
      if (qs) url += `?${qs}`;
    }
    const res = await fetch(url, {
      credentials: "same-origin",
      signal: options.signal,
    });
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
    if (isAbortError(e)) {
      if (!options.quietAbort) {
        console.debug(`[API] GET /api/${endpoint} aborted`);
      }
      return { ok: false, status: 0, data: null, aborted: true };
    }
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

async function apiGet<T>(
  endpoint: string,
  options: ApiGetOptions = {},
): Promise<T | null> {
  const result = await apiGetResponse<T>(endpoint, [], options);
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
  /** Used by OpportunitiesView for database-paginated opportunity filters. */
  opportunityStatus?: string;
  opportunityCount?: string;
  opportunityMode?: boolean;
  registryIssue?: string;
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
  statusFilter?: string;
  q?: string;
  courseId?: string;
  courseProgram?: string;
  courseTerm?: string;
  studyType?: string;
  nameLetter?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_STUDENT_PAGE_SIZE = 50;
const DEFAULT_GRADE_PAGE_SIZE = 100;
const LIST_ALL_PAGE_SIZE = 500;

export interface StudentStatsResponse {
  total: number;
  active: number;
  dismissed: number;
  archived?: number;
  noActiveChapter: number;
  source: "database";
}

export interface StudentDeleteImpactResponse {
  student: { id: string; name: string; code: string; status: string };
  counts: {
    grades: number;
    leaves: number;
    calls: number;
    notes: number;
    opportunityLogs: number;
    correctionSheets: number;
    telegramSubmissions: number;
  };
  totalRelations: number;
  hasRelations: boolean;
  archiveRecommended: boolean;
  blockingReasons: string[];
  source: "database";
}

export interface OpportunityCountSet {
  total: number;
  hasOpportunities: number;
  noOpportunities: number;
  dismissed: number;
  active: number;
  noActiveChapter: number;
  activeChapterConflicts: number;
  zeroOpportunityLimit: number;
  overLimit: number;
  fullOpportunities: number;
  belowFullOpportunities: number;
}

export interface OpportunityStatsResponse extends OpportunityCountSet {
  system: OpportunityCountSet;
  filtered: OpportunityCountSet;
  source: "database";
}

export interface OpportunityStudentActionResponse {
  student?: Record<string, unknown> | null;
  opportunityLog?: Record<string, unknown> | null;
  source: "database";
}

export interface OpportunityBulkTargetsResponse {
  totalMatching: number;
  eligibleWithActiveChapter: number;
  noActiveChapter: number;
  activeChapterConflicts: number;
  zeroOpportunityLimit: number;
  invalidOpportunitySource: number;
  excludedDismissed: number;
  excludedFullOpportunities: number;
  skipped: number;
  targetCount: number;
  previewToken: string;
  source: "database";
}

export interface OpportunityBulkAdjustResponse {
  updatedStudents: number;
  savedOpportunityLogs: number;
  savedStudentNotes: number;
  totalMatching: number;
  eligibleWithActiveChapter: number;
  noActiveChapter: number;
  activeChapterConflicts: number;
  zeroOpportunityLimit: number;
  invalidOpportunitySource: number;
  skipped: number;
  source: "database";
}

export interface GradeCoverageStatsResponse {
  withGrade: number;
  withoutGrade: number;
  total: number;
  source: "database";
}

export interface MissingStudentsNotesStatsResponse {
  total: number;
  examsWithNotes: number;
  totalLines: number;
  source: "database";
  generatedAt?: string;
}

export interface ExamRecordStat {
  total: number;
  passCount: number;
  notPassedCount: number;
  protectedCount: number;
}

export interface ExamStatsResponse {
  statsByExamId: Record<string, ExamRecordStat>;
  source: "database";
  generatedAt?: string;
}

export interface PledgeStatsResponse {
  dismissed: number;
  temporary: number;
  final: number;
  pledged: number;
  pending: number;
  reactivated: number;
  source: "database";
  generatedAt?: string;
}

export interface PledgeRowsQuery {
  q?: string;
  typeFilter?: "all" | "temporary" | "final";
  statusFilter?: "all" | "pledged" | "pending" | "reactivated";
}

export interface PledgeRowsResponse {
  rows: Array<Record<string, unknown>>;
  stats: PledgeStatsResponse;
  totalCount: number;
  source: "database";
  generatedAt?: string;
}

export interface PledgeActionResponse {
  student?: Record<string, unknown> | null;
  studentNote?: Record<string, unknown> | null;
  actionNote?: Record<string, unknown> | null;
  opportunityLogs?: Array<Record<string, unknown>>;
  reactivated?: boolean;
  deletedCount?: number;
  source: "database";
}

export interface StudentProfileStatsResponse {
  studentId: string;
  grades: number;
  exams: number;
  absent: number;
  absences?: number;
  success: number;
  failed: number;
  graceGrades: number;
  noDiscountGrades: number;
  opportunities: number;
  baseOpportunities: number;
  opportunityLimit: number | null;
  opportunitySource: "student-record";
  opportunityLimitSource:
    "active-chapter" | "no-active-chapter" | "active-chapter-conflict";
  opportunityHealth:
    | "ready"
    | "zero-limit"
    | "missing-active-chapter"
    | "active-chapter-conflict";
  hasActiveChapter: boolean;
  activeChapterConflictCount: number;
  activeChapter: { id: string; name: string; opportunities: number } | null;
  isOpportunityFull: boolean;
  isOpportunityOverLimit: boolean;
  deductedMovements: number;
  deductions?: number;
  addedMovements: number;
  calls?: number;
  leaves?: number;
  pledges?: number;
  notes?: number;
  dismissals?: number;
  reactivations?: number;
  timeline?: number;
  actions: number;
  source: "database";
  generatedAt?: string;
}

export interface StudentAcademicUpdateImpactResponse {
  studentId: string;
  studentName: string;
  requiresConfirmation: boolean;
  changes: { dateChanged: boolean; graceChanged: boolean };
  current: {
    createdAt: string;
    accountingGraceDays: number;
    gracePeriodStartDate?: string | null;
  };
  proposed: {
    createdAt: string;
    accountingGraceDays: number;
    gracePeriodStartDate?: string | null;
  };
  impact: {
    totalGrades: number;
    changedGrades: number;
    becameProtected: number;
    becameChargeable: number;
    movedBeforeRegistration: number;
    returnedAfterRegistration: number;
    movedIntoGrace: number;
    leftGrace: number;
    sample: Array<{
      examId: string;
      examName: string;
      examDate: string;
      before: string;
      after: string;
    }>;
  };
  previewToken: string;
  projection: {
    current: {
      opportunities: number;
      status: string;
      dismissalType: string;
      dismissalReason: string;
      automaticOpportunityLogs: number;
    };
    projected: {
      opportunities: number;
      status: string;
      dismissalType: string;
      dismissalReason: string;
      automaticOpportunityLogs: number;
    };
  } | null;
  source: "database";
  generatedAt?: string;
}

export interface StudentEnrollmentArchiveRecord {
  id: string;
  studentId: string;
  fromCourseId: string;
  fromCourseName: string;
  toCourseId?: string | null;
  toCourseName: string;
  resetKind: string;
  reason: string;
  createdById?: string | null;
  createdByName?: string | null;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

export interface StudentProfileLogResponse {
  studentId: string;
  grades: Array<Record<string, unknown>>;
  exams?: Array<Record<string, unknown>>;
  opportunityLogs: Array<Record<string, unknown>>;
  studentLeaves: Array<Record<string, unknown>>;
  studentCalls: Array<Record<string, unknown>>;
  studentNotes: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
  enrollmentArchives?: StudentEnrollmentArchiveRecord[];
  source: "database";
  generatedAt?: string;
}

export interface SyncVersionResponse {
  ok: true;
  version: string;
  latestAt: string | null;
  counts: Record<string, number>;
  maxDates: Record<string, string>;
  source: "database";
  generatedAt: string;
}

export interface AcademicRepairResponse {
  ok: true;
  totalStudents: number;
  recalculatedStudents: number;
  automaticOpportunityLogs: number;
  batches: number;
  message: string;
  source: "database";
  generatedAt?: string;
}

export interface CallStatsQuery {
  courseId?: string;
  examId?: string;
  statusFilter?: string;
  q?: string;
  filterQ?: string;
}

export interface CallStatsResponse {
  total: number;
  contacted: number;
  unanswered: number;
  wrong: number;
  noAction: number;
  source: "database";
}

export interface CallCandidatesQuery extends CallStatsQuery {
  page?: number;
  pageSize?: number;
}

export interface CallCandidatesResponse {
  rows?: Array<Record<string, unknown>>;
  students: Array<Record<string, unknown>>;
  grades: Array<Record<string, unknown>>;
  exams?: Array<Record<string, unknown>>;
  studentCalls: Array<Record<string, unknown>>;
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  source: "database";
}

export interface CallCourseExamsResponse {
  exams: Array<Record<string, unknown>>;
  source: "database";
}

export interface CourseOverviewRow {
  id: string;
  course: Record<string, unknown>;
  counts: {
    students: number;
    activeStudents: number;
    dismissedStudents: number;
    archivedStudents: number;
    exams: number;
    activeExams: number;
    inactiveExams: number;
    courseChapters: number;
    activeChapters: number;
    archivedCourseChapters: number;
  };
  usage: {
    programs: Record<string, number>;
    studyTypes: Record<string, number>;
    locations: Record<string, number>;
  };
  activeChapter: { id: string; name: string; opportunities: number } | null;
  deleteSafety: {
    canDelete: boolean;
    blockers: string[];
    recommendedAction: string;
  };
  configWarnings: string[];
  examSamples?: string[];
}

export interface CourseOverviewResponse {
  rows: CourseOverviewRow[];
  total: number;
  stats: {
    total: number;
    active: number;
    inactive: number;
    withStudents: number;
    deletable: number;
  };
  source: "database";
  generatedAt?: string;
}

export interface CourseStudentSyncPreview {
  configTouched: boolean;
  totalStudents: number;
  eligibleStudents: number;
  compatibleStudents: number;
  blockedStudents: number;
  skippedArchived: number;
  studentsToUpdate: number;
  unchangedStudents: number;
  fieldChanges: {
    courseTerm: number;
    baghdadMode: number;
    mainSite: number;
    subSite: number;
  };
  blockerSamples: string[];
  canSync: boolean;
  canSave: boolean;
  blockingMessage?: string | null;
  previewToken: string;
  source: "database";
}

export interface ChapterOpportunityPreview {
  chapterId: string;
  chapterName: string;
  previousOpportunities: number;
  nextOpportunities: number;
  changed: boolean;
  activeCourses: number;
  courseIds: string[];
  courseNames: string[];
  affectedStudents: number;
  activeStudents: number;
  dismissedStudents: number;
  skippedArchived: number;
  currentlyAboveNewCap: number;
  baselinesToChange: number;
  previewToken: string;
  source: "database";
}

export interface CourseChapterActionPreview {
  action: "activate" | "deactivate";
  courseChapterId: string;
  course: { id: string; name: string };
  chapter: { id: string; name: string; opportunities: number };
  currentActive: boolean;
  canExecute: boolean;
  blockingMessage?: string | null;
  impact: {
    activeStudents: number;
    dismissedStudents: number;
    archivedStudents: number;
    affectedStudents: number;
    balancesThatWillBeZeroed: number;
    archiveEntries: number;
    otherActiveLinksToDisable: number;
  };
  message: string;
  previewToken: string;
  source: "database";
}

export interface ExamCreateContextRow {
  id: string;
  course: Record<string, unknown>;
  activeChapterCount: number;
  activeChapter: { id: string; name: string; opportunities: number } | null;
  activeStudents: number;
  siteCounts: Record<string, number>;
  canSelectForExam: boolean;
  blockers: string[];
}

export interface ExamCreateContextResponse {
  source: "database";
  rows: ExamCreateContextRow[];
  stats: {
    totalCourses: number;
    selectableCourses: number;
    blockedCourses: number;
    activeStudents: number;
  };
}

export interface ChapterOverviewResponse {
  source: "database";
  generatedAt?: string;
  stats: {
    courses: number;
    chapters: number;
    links: number;
    coursesWithoutActiveChapter: number;
    coursesWithMultipleActiveChapters: number;
    studentsZeroZeroWithActive: number;
    studentsAboveChapterCap: number;
    deletableChapters: number;
  };
  courseRows: Array<{
    id: string;
    course: { id: string; name: string; active: boolean };
    counts: {
      students: number;
      activeStudents: number;
      dismissedStudents: number;
      archivedStudents: number;
      nonArchivedStudents: number;
      linkedChapters: number;
      activeLinks: number;
      zeroZeroWithActive: number;
      aboveCap: number;
      nonZeroWithoutActive: number;
    };
    activeLink: ChapterCourseLinkOverview | null;
    links: ChapterCourseLinkOverview[];
    warnings: string[];
    health: { needsRepair: boolean; canSafelyActivate: boolean };
  }>;
  chapterRows: Array<{
    id: string;
    chapter: { id: string; name: string; opportunities: number };
    counts: {
      linkedCourses: number;
      activeLinks: number;
      archivedLinks: number;
      archiveEntries: number;
      opportunityLogs: number;
    };
    deleteSafety: {
      canDelete: boolean;
      blockers: string[];
      recommendedAction: string;
    };
  }>;
}

export interface ChapterCourseLinkOverview {
  id: string;
  courseId: string;
  chapterId: string;
  active: boolean;
  archived: boolean;
  archiveCount: number;
  chapter: { id: string; name: string; opportunities: number };
  deleteSafety: { canDelete: boolean; blockers: string[] };
}

export interface GradeListResponse {
  grades: Array<Record<string, unknown>>;
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}

export interface GradeEntrySheetResponse {
  exam: Record<string, unknown>;
  students: Array<Record<string, unknown>>;
  grades: Array<Record<string, unknown>>;
  studentLeaves: Array<Record<string, unknown>>;
  opportunityLogs: Array<Record<string, unknown>>;
  courseChapters: Array<Record<string, unknown>>;
  source: "database";
}

interface PaginatedApiEnvelope extends Record<string, unknown> {
  total?: number;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  limit?: number;
  totalPages?: number;
  hasMore?: boolean;
}

async function apiGetAllPages<T extends Record<string, unknown>>(
  endpoint: string,
  collectionKey: keyof T,
  requestedPageSize = 500,
): Promise<T | null> {
  const collected: unknown[] = [];
  let page = 1;
  let totalPages = 1;
  let lastResponse: (T & PaginatedApiEnvelope) | null = null;

  while (page <= totalPages) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const response = await apiGet<T & PaginatedApiEnvelope>(
      `${endpoint}${separator}page=${page}&pageSize=${requestedPageSize}`,
    );
    if (!response) return null;

    lastResponse = response;
    const pageItems = response[collectionKey];
    if (Array.isArray(pageItems)) collected.push(...pageItems);

    const effectivePageSize = Number(
      response.pageSize || response.limit || requestedPageSize,
    );
    const total = Number(
      response.totalCount ?? response.total ?? collected.length,
    );
    totalPages = Math.max(
      1,
      Number(response.totalPages || 0) ||
        Math.ceil(total / Math.max(1, effectivePageSize)),
    );

    if (!response.hasMore || page >= totalPages) break;
    page += 1;

    // Defensive guard against malformed paginated responses. This is not a data cap;
    // normal APIs stop through hasMore/totalPages above.
    if (page > 10000) {
      console.warn(
        `[API] Aborted all-pages read for /api/${endpoint}: invalid pagination metadata.`,
      );
      break;
    }
  }

  return {
    ...(lastResponse || ({} as T)),
    [collectionKey]: collected,
    totalCount: Number(
      lastResponse?.totalCount ?? lastResponse?.total ?? collected.length,
    ),
    total: Number(
      lastResponse?.total ?? lastResponse?.totalCount ?? collected.length,
    ),
    page: 1,
    pageSize: collected.length,
    totalPages: 1,
    hasMore: false,
  } as T;
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
  list: () => apiGetAllPages<Pick<ServerData, "courses">>("courses", "courses"),
  overview: (options: ApiGetOptions = {}) =>
    apiGet<CourseOverviewResponse>("courses/overview", options),
  add: (course: Record<string, unknown>) => apiPost("courses", course),
  previewUpdate: (id: string, updates: Record<string, unknown>) =>
    apiPut("courses", { id, ...updates, previewOnly: true }),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("courses", { id, ...updates }),
  remove: (id: string) => apiDelete("courses", id),
  /**
   * يرجع الفصل النشط الوحيد غير المؤرشف للدورة من قاعدة البيانات مباشرةً.
   * استخدمه في نافذة تعديل الطالب بدل الاعتماد على كاش Zustand المحلي.
   */
  activeChapterForCourse: (courseId: string, options: ApiGetOptions = {}) =>
    apiGet<{
      courseId: string;
      hasActiveChapter: boolean;
      conflict: boolean;
      activeChapter: {
        id: string;
        name: string;
        opportunities: number;
        chapterId: string;
      } | null;
      source: "database";
      generatedAt: string;
    }>("courses/active-chapter", { ...options, params: { courseId } }),
};

// ─── Chapter API ──────────────────────────────────────────────────────────────

export const chapterApi = {
  overview: (options: ApiGetOptions = {}) =>
    apiGet<ChapterOverviewResponse>("chapters/overview", options),
  add: (chapter: { name: string; opportunities: number }) =>
    apiPost("chapters", chapter),
  previewUpdate: (id: string, updates: Record<string, unknown>) =>
    apiPut("chapters", { id, ...updates, previewOnly: true }),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("chapters", { id, ...updates }),
  remove: (id: string, options: { confirmImpact?: boolean } = {}) =>
    apiDelete("chapters", id, {
      confirmImpact: options.confirmImpact ? "1" : undefined,
    }),
};

// ─── CourseChapter API ────────────────────────────────────────────────────────

export const courseChapterApi = {
  list: () =>
    apiGetAllPages<Pick<ServerData, "courseChapters">>(
      "course-chapters",
      "courseChapters",
    ),
  add: (cc: {
    id?: string;
    courseId: string;
    chapterId: string;
    active?: boolean;
    archived?: boolean;
    archive?: string;
  }) => apiPost("course-chapters", cc),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("course-chapters", { id, ...updates }),
  previewAction: (courseChapterId: string, action: "activate" | "deactivate") =>
    apiPost("course-chapters/activate", {
      courseChapterId,
      action,
      previewOnly: true,
    }),
  activate: (
    courseChapterId: string,
    action: "activate" | "deactivate",
    options: { confirmImpact: boolean; previewToken: string },
  ) =>
    apiPost("course-chapters/activate", {
      courseChapterId,
      action,
      confirmImpact: options.confirmImpact,
      previewToken: options.previewToken,
    }),
  remove: (id: string, options: { confirmImpact?: boolean } = {}) =>
    apiDelete("course-chapters", id, {
      confirmImpact: options.confirmImpact ? "1" : undefined,
    }),
};

// ─── Student API ──────────────────────────────────────────────────────────────

export const studentStatsApi = {
  get: () => apiGet<StudentStatsResponse>("students/stats"),
};

export interface StudentRegisterContextRow {
  id: string;
  course: Record<string, unknown>;
  activeChapter: { opportunities: number; name: string } | null;
  activeChapterCount: number;
  studentCount: number;
  canRegister: boolean;
  warnings: string[];
  counts: { total: number; active: number; dismissed: number };
}

export interface StudentRegisterContextResponse {
  rows: StudentRegisterContextRow[];
  courses: StudentRegisterContextRow[];
  stats: {
    active: number;
    selectable: number;
    withoutActiveChapter: number;
    withChapterConflict: number;
  };
  source: "database";
}

export const studentRegisterApi = {
  context: () =>
    apiGet<StudentRegisterContextResponse>("students/register-context"),
};

export const studentApi = {
  list: async (
    query: StudentListQuery = {},
    options: ApiGetOptions = {},
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
      opportunityStatus: query.opportunityStatus,
      opportunityCount: query.opportunityCount,
      opportunityMode: query.opportunityMode ? "1" : undefined,
      registryIssue: query.registryIssue,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_STUDENT_PAGE_SIZE,
    });
    return apiGet<StudentListResponse>(
      `students${queryString ? `?${queryString}` : ""}`,
      options,
    );
  },
  add: (student: Record<string, unknown>) => apiPost("students", student),
  statusAction: (payload: Record<string, unknown>) =>
    apiPost("students/status-action", payload),
  updateImpact: (payload: Record<string, unknown>) =>
    apiPost("students/update-impact", payload) as Promise<
      ApiResult & { data?: StudentAcademicUpdateImpactResponse }
    >,
  listAll: async (
    query: StudentListQuery = {},
  ): Promise<StudentListResponse | null> => {
    const pageSize = Math.min(
      Math.max(Number(query.pageSize || LIST_ALL_PAGE_SIZE), 1),
      LIST_ALL_PAGE_SIZE,
    );
    const collected: Array<Record<string, unknown>> = [];
    let page = 1;
    let totalCount = 0;
    let totalPages = 1;

    while (page <= totalPages) {
      const result = await studentApi.list({ ...query, page, pageSize });
      if (!result) return null;
      totalCount = Number(result.totalCount || 0);
      totalPages = Math.max(1, Number(result.totalPages || 1));
      collected.push(...(result.students || []));
      if (!result.hasMore || page >= totalPages) break;
      page += 1;
    }

    return {
      students: collected,
      totalCount,
      page: 1,
      pageSize: collected.length,
      totalPages: 1,
      hasMore: false,
    };
  },
  bulkAdd: (students: Array<Record<string, unknown>>) =>
    apiPost("students/bulk", { students }),
  deleteImpact: (id: string) =>
    apiGet<StudentDeleteImpactResponse>(
      `students/delete-impact?id=${encodeURIComponent(id)}`,
    ),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("students", { id, ...updates }),
  remove: (id: string) => apiDelete("students", id),
};

// ─── Exam API ─────────────────────────────────────────────────────────────────

export const examCreateContextApi = {
  get: (options: ApiGetOptions = {}) =>
    apiGet<ExamCreateContextResponse>("exams/create-context", options),
};

export const examApi = {
  add: (exam: Record<string, unknown>) => apiPost("exams", exam),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("exams", { id, ...updates }),
  remove: (id: string, options: { confirmImpact?: boolean } = {}) =>
    apiDelete("exams", id, {
      confirmImpact: options.confirmImpact ? "1" : undefined,
    }),
};

// ─── Grade API ────────────────────────────────────────────────────────────────

export const gradeEntrySheetApi = {
  get: (examId: string, options: ApiGetOptions = {}) =>
    apiGet<GradeEntrySheetResponse>(
      `grades/entry-sheet?examId=${encodeURIComponent(examId)}`,
      options,
    ),
};

export const gradeApi = {
  list: async (
    query: GradeListQuery = {},
    options: ApiGetOptions = {},
  ): Promise<GradeListResponse | null> => {
    const queryString = buildQueryString({
      examId: query.examId,
      studentId: query.studentId,
      status: query.status,
      statusFilter: query.statusFilter,
      q: query.q,
      courseId: query.courseId,
      courseProgram: query.courseProgram,
      courseTerm: query.courseTerm,
      studyType: query.studyType,
      nameLetter: query.nameLetter,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_GRADE_PAGE_SIZE,
    });
    return apiGet<GradeListResponse>(
      `grades${queryString ? `?${queryString}` : ""}`,
      options,
    );
  },
  add: (grade: Record<string, unknown>) => apiPost("grades", grade),
  markMissingAbsent: (examId: string, studentIds: string[]) =>
    apiPost("grades/mark-missing-absent", { examId, studentIds }),
  listAll: async (
    query: GradeListQuery = {},
  ): Promise<GradeListResponse | null> => {
    const pageSize = Math.min(
      Math.max(Number(query.pageSize || LIST_ALL_PAGE_SIZE), 1),
      LIST_ALL_PAGE_SIZE,
    );
    const collected: Array<Record<string, unknown>> = [];
    let page = 1;
    let totalCount = 0;
    let totalPages = 1;

    while (page <= totalPages) {
      const result = await gradeApi.list({ ...query, page, pageSize });
      if (!result) return null;
      totalCount = Number(result.totalCount || 0);
      totalPages = Math.max(1, Number(result.totalPages || 1));
      collected.push(...(result.grades || []));
      if (!result.hasMore || page >= totalPages) break;
      page += 1;
    }

    return {
      grades: collected,
      totalCount,
      page: 1,
      pageSize: collected.length,
      totalPages: 1,
      hasMore: false,
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
          transient: isTransientHttpResponse(res),
        };
      }
      const contentType = res.headers.get("content-type") || "";
      const responseData = contentType.includes("application/json")
        ? await res.json().catch(() => null)
        : null;
      return {
        ok: true,
        data: responseData,
        syncScopes: inferTeacherProScopesFromEndpoint(
          `/api/grades?${params.toString()}`,
        ),
      };
    } catch (e) {
      const msg = toUserFriendlyError(
        e instanceof Error ? e.message : "Network error",
      );
      console.warn("[API] DELETE /api/grades absent-by-exam network error:", e);
      return { ok: false, error: msg, status: 0, transient: true };
    }
  },
};

// ─── Database Stats APIs ─────────────────────────────────────────────────────

export const gradeCoverageStatsApi = {
  get: (
    query: {
      examId?: string;
      courseId?: string;
      courseProgram?: string;
      courseTerm?: string;
      studyType?: string;
      nameLetter?: string;
      q?: string;
    } = {},
    options: ApiGetOptions = {},
  ) => {
    const queryString = buildQueryString({
      examId: query.examId,
      courseId: query.courseId,
      courseProgram: query.courseProgram,
      courseTerm: query.courseTerm,
      studyType: query.studyType,
      nameLetter: query.nameLetter,
      q: query.q,
    });
    return apiGet<GradeCoverageStatsResponse>(
      `grades/stats${queryString ? `?${queryString}` : ""}`,
      options,
    );
  },
};

export const missingStudentsNotesStatsApi = {
  get: (options: ApiGetOptions = {}) =>
    apiGet<MissingStudentsNotesStatsResponse>(
      "grade-entry-missing-notes/stats",
      options,
    ),
};

export const examStatsApi = {
  get: (examIds: string[] = [], options: ApiGetOptions = {}) => {
    const queryString = buildQueryString({
      examIds: examIds.filter(Boolean).join(","),
    });
    return apiGet<ExamStatsResponse>(
      `exams/stats${queryString ? `?${queryString}` : ""}`,
      options,
    );
  },
};

export const pledgeStatsApi = {
  get: () => apiGet<PledgeStatsResponse>("student-notes/pledge-stats"),
};

export const pledgeApi = {
  list: (query: PledgeRowsQuery = {}, options: ApiGetOptions = {}) => {
    const queryString = buildQueryString({
      q: query.q,
      typeFilter: query.typeFilter,
      statusFilter: query.statusFilter,
    });
    return apiGet<PledgeRowsResponse>(
      `student-notes/pledges${queryString ? `?${queryString}` : ""}`,
      options,
    );
  },
  action: (payload: Record<string, unknown>) =>
    apiPost("student-notes/pledges", payload) as Promise<
      ApiResult & { data?: PledgeActionResponse }
    >,
};

export const studentProfileStatsApi = {
  get: (studentId: string) => {
    const queryString = buildQueryString({ studentId });
    return apiGet<StudentProfileStatsResponse>(
      `students/profile-stats${queryString ? `?${queryString}` : ""}`,
    );
  },
};

export const studentProfileLogApi = {
  get: (studentId: string) => {
    const queryString = buildQueryString({ studentId });
    return apiGet<StudentProfileLogResponse>(
      `students/profile-log${queryString ? `?${queryString}` : ""}`,
    );
  },
};

export const academicRepairApi = {
  run: () =>
    apiPost("students/academic-repair", {}) as Promise<
      ApiResult & { data?: AcademicRepairResponse }
    >,
};

export const syncVersionApi = {
  get: () => apiGet<SyncVersionResponse>("sync/version"),
};

export const opportunityStatsApi = {
  get: (
    query: {
      courseId?: string;
      status?: string;
      opportunityCount?: string;
      q?: string;
    } = {},
  ) => {
    const queryString = buildQueryString({
      courseId: query.courseId,
      status: query.status,
      opportunityCount: query.opportunityCount,
      q: query.q,
    });
    return apiGet<OpportunityStatsResponse>(
      `opportunities/stats${queryString ? `?${queryString}` : ""}`,
    );
  },
  bulkTargets: (
    query: {
      courseId?: string;
      status?: string;
      opportunityCount?: string;
      q?: string;
      actionType?: "add" | "deduct";
      excludeDismissed?: boolean;
      excludeFullOpportunities?: boolean;
      reactivateDismissedOnAdd?: boolean;
    } = {},
  ) => {
    const queryString = buildQueryString({
      courseId: query.courseId,
      status: query.status,
      opportunityCount: query.opportunityCount,
      q: query.q,
      actionType: query.actionType,
      excludeDismissed:
        query.excludeDismissed === undefined
          ? undefined
          : String(query.excludeDismissed),
      excludeFullOpportunities:
        query.excludeFullOpportunities === undefined
          ? undefined
          : String(query.excludeFullOpportunities),
      reactivateDismissedOnAdd:
        query.reactivateDismissedOnAdd === undefined
          ? undefined
          : String(query.reactivateDismissedOnAdd),
    });
    return apiGet<OpportunityBulkTargetsResponse>(
      `opportunities/bulk-targets${queryString ? `?${queryString}` : ""}`,
    );
  },
  bulkAdjustByFilters: (payload: {
    courseId?: string;
    status?: string;
    opportunityCount?: string;
    q?: string;
    actionType: "add" | "deduct";
    amount: number;
    reason: string;
    excludeDismissed?: boolean;
    excludeFullOpportunities?: boolean;
    reactivateDismissedOnAdd?: boolean;
    confirmImpact?: boolean;
    previewToken?: string;
  }) =>
    apiPost("opportunities/bulk-adjust", {
      mode: "filter",
      ...payload,
    }) as Promise<ApiResult & { data?: OpportunityBulkAdjustResponse }>,
  studentAction: (payload: {
    studentId?: string;
    logId?: string;
    actionType: "add" | "deduct" | "reset" | "undo";
    amount?: number;
    reason?: string;
  }) =>
    apiPost("opportunities/student-action", payload) as Promise<
      ApiResult & { data?: OpportunityStudentActionResponse }
    >,
};

export const callCourseExamsApi = {
  get: (courseId?: string, options: ApiGetOptions = {}) => {
    const queryString = buildQueryString({ courseId });
    return apiGet<CallCourseExamsResponse>(
      `student-calls/course-exams${queryString ? `?${queryString}` : ""}`,
      options,
    );
  },
};

export const callStatsApi = {
  get: (query: CallStatsQuery = {}, options: ApiGetOptions = {}) => {
    const queryString = buildQueryString({
      courseId: query.courseId,
      examId: query.examId,
      statusFilter: query.statusFilter,
      q: query.q,
      filterQ: query.filterQ,
    });
    return apiGet<CallStatsResponse>(
      `student-calls/stats${queryString ? `?${queryString}` : ""}`,
      options,
    );
  },
};

export const callCandidatesApi = {
  get: (query: CallCandidatesQuery = {}, options: ApiGetOptions = {}) => {
    const queryString = buildQueryString({
      courseId: query.courseId,
      examId: query.examId,
      statusFilter: query.statusFilter,
      q: query.q,
      filterQ: query.filterQ,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 120,
    });
    return apiGet<CallCandidatesResponse>(
      `student-calls/candidates${queryString ? `?${queryString}` : ""}`,
      options,
    );
  },
  listAll: async (
    query: CallCandidatesQuery = {},
  ): Promise<CallCandidatesResponse | null> => {
    const pageSize = Math.min(Math.max(Number(query.pageSize || 200), 1), 200);
    const collectedStudents: Array<Record<string, unknown>> = [];
    const collectedGrades: Array<Record<string, unknown>> = [];
    const collectedCalls: Array<Record<string, unknown>> = [];
    const collectedRows: Array<Record<string, unknown>> = [];
    const collectedExams = new Map<string, Record<string, unknown>>();
    let page = 1;
    let totalCount = 0;
    let totalPages = 1;

    while (page <= totalPages) {
      const result = await callCandidatesApi.get({ ...query, page, pageSize });
      if (!result) return null;
      totalCount = Number(result.totalCount || 0);
      totalPages = Math.max(1, Number(result.totalPages || 1));
      collectedStudents.push(...(result.students || []));
      collectedGrades.push(...(result.grades || []));
      collectedCalls.push(...(result.studentCalls || []));
      collectedRows.push(...(result.rows || []));
      (result.exams || []).forEach((exam) => {
        const id = String(exam.id || "");
        if (id && !collectedExams.has(id)) collectedExams.set(id, exam);
      });
      if (!result.hasMore || page >= totalPages) break;
      page += 1;
    }

    return {
      rows: collectedRows,
      students: collectedStudents,
      grades: collectedGrades,
      exams: Array.from(collectedExams.values()),
      studentCalls: collectedCalls,
      totalCount,
      page: 1,
      pageSize: collectedStudents.length,
      totalPages: 1,
      hasMore: false,
      source: "database",
    };
  },
};

// ─── OpportunityLog API ───────────────────────────────────────────────────────

export const opportunityLogApi = {
  list: (query?: { studentId?: string; pageSize?: number }) => {
    if (query?.studentId) {
      const qs = new URLSearchParams();
      qs.set("studentId", query.studentId);
      qs.set("pageSize", String(query.pageSize || 100));
      return apiGetAllPages<Pick<ServerData, "opportunityLogs">>(
        `opportunity-logs?${qs.toString()}`,
        "opportunityLogs",
      );
    }
    return apiGetAllPages<Pick<ServerData, "opportunityLogs">>(
      "opportunity-logs",
      "opportunityLogs",
    );
  },
  add: (log: Record<string, unknown>) => apiPost("opportunity-logs", log),
  bulkAdjust: (payload: {
    students?: Array<Record<string, unknown>>;
    opportunityLogs?: Array<Record<string, unknown>>;
    studentNotes?: Array<Record<string, unknown>>;
  }) => apiPost("opportunities/bulk-adjust", payload),
  remove: async (
    id: string,
    options: { confirmImpact?: boolean; previewToken?: string } = {},
  ) => {
    if (options.previewToken) {
      return apiDelete("opportunity-logs", id, {
        confirmImpact: options.confirmImpact ? "1" : undefined,
        previewToken: options.previewToken,
      });
    }
    const previewResult = await apiDelete("opportunity-logs", id);
    if (!options.confirmImpact || previewResult.status !== 409) {
      return previewResult;
    }
    const previewToken = String(
      (previewResult.data as { previewToken?: unknown } | null)?.previewToken || "",
    );
    if (!previewToken) return previewResult;
    return apiDelete("opportunity-logs", id, {
      confirmImpact: "1",
      previewToken,
    });
  },
};

// ─── Follow-up API ───────────────────────────────────────────────────────────

export const studentLeaveApi = {
  list: () =>
    apiGetAllPages<Pick<ServerData, "studentLeaves">>(
      "student-leaves",
      "studentLeaves",
    ),
  add: (leave: Record<string, unknown>) => apiPost("student-leaves", leave),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("student-leaves", { id, ...updates }),
  remove: (id: string) => apiDelete("student-leaves", id),
};

export const studentCallApi = {
  list: () =>
    apiGetAllPages<Pick<ServerData, "studentCalls">>(
      "student-calls",
      "studentCalls",
    ),
  add: (call: Record<string, unknown>) => apiPost("student-calls", call),
  upsert: (call: Record<string, unknown>) => apiPost("student-calls", call),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("student-calls", { id, ...updates }),
  remove: (id: string) => apiDelete("student-calls", id),
};

export const studentNoteApi = {
  list: () =>
    apiGetAllPages<Pick<ServerData, "studentNotes">>(
      "student-notes",
      "studentNotes",
    ),
  add: (note: Record<string, unknown>) => apiPost("student-notes", note),
  update: (id: string, updates: Record<string, unknown>) =>
    apiPut("student-notes", { id, ...updates }),
  remove: (id: string) => apiDelete("student-notes", id),
};

// ─── CorrectionSheet API ──────────────────────────────────────────────────────

export const correctionSheetApi = {
  list: () =>
    apiGetAllPages<Pick<ServerData, "correctionSheets">>(
      "correction-sheets",
      "correctionSheets",
    ),
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

export type LogListQuery = {
  q?: string;
  module?: string;
  user?: string;
  page?: number;
  pageSize?: number;
};

export const logApi = {
  list: (query: LogListQuery = {}, options: ApiGetOptions = {}) => {
    const queryString = buildQueryString({
      q: query.q,
      module: query.module,
      user: query.user,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
    });
    return apiGet<
      Pick<ServerData, "logs"> & {
        modules?: string[];
        users?: string[];
        totalCount?: number;
        systemTotalCount?: number;
        page?: number;
        pageSize?: number;
        totalPages?: number;
        hasMore?: boolean;
        source?: string;
      }
    >(`logs${queryString ? `?${queryString}` : ""}`, options);
  },
  add: async (log: Record<string, unknown>): Promise<ApiResult> => {
    // Use direct fetch instead of apiPost so that 403 responses (server-only
    // audit entries) don't trigger console.warn noise. The UI creates local
    // log entries for immediate feedback, but the server correctly rejects
    // sensitive (module/action) pairs with 403. We treat 403 as a successful
    // local-only audit entry so it doesn't trigger sync-error notifications
    // or outbox retries. Real audit records for sensitive actions are
    // written by the corresponding server route after the DB mutation.
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(log),
      });
      if (res.ok) return { ok: true };
      if (res.status === 403) return { ok: true }; // server-only entry — expected
      // Other errors (4xx except 403, 5xx) are real failures.
      const error = await readApiError(
        res,
        `تعذر حفظ السجل (رمز ${res.status})`,
      );
      return {
        ok: false,
        error,
        status: res.status,
        transient: isTransientHttpResponse(res),
      };
    } catch (e) {
      const msg = toUserFriendlyError(
        e instanceof Error ? e.message : "Network error",
      );
      return { ok: false, error: msg, status: 0, transient: true };
    }
  },
  clear: (password: string, options?: Record<string, unknown>) =>
    apiPost("logs/clear", { password, ...(options || {}) }),
  restoreLastClear: async (password: string): Promise<ApiResult> => {
    try {
      const res = await fetch("/api/logs/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const error = await readApiError(
          res,
          `تعذر استعادة السجلات (رمز ${res.status})`,
        );
        return {
          ok: false,
          error,
          status: res.status,
          transient: isTransientHttpResponse(res),
        };
      }
      return { ok: true };
    } catch (e) {
      const msg = toUserFriendlyError(
        e instanceof Error ? e.message : "Network error",
      );
      return { ok: false, error: msg, status: 0, transient: true };
    }
  },
};
