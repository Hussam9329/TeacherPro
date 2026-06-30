/**
 * Grade-entry missing-students notes.
 *
 * Originally stored only in localStorage. Now the source of truth is the
 * server (POST /api/grade-entry-missing-notes), with localStorage as a
 * offline cache + outbox for transient network failures.
 *
 * Migration: legacy localStorage entries ('teacherpro-grade-entry-notes-v1')
 * are merged on first server read and pushed to the server opportunistically.
 */

export type GradeEntryMissingNote = {
  id: string;
  examId: string;
  examName: string;
  examDate: string;
  text: string;
  userId?: string | null;
  userName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const GRADE_ENTRY_MISSING_NOTES_STORAGE_KEY =
  'teacherpro-grade-entry-missing-students-notes-v1';
export const GRADE_ENTRY_MISSING_NOTES_EVENT =
  'teacherpro:grade-entry-missing-notes-updated';
const LEGACY_GRADE_ENTRY_NOTES_STORAGE_KEY = 'teacherpro-grade-entry-notes-v1';
const OUTBOX_STORAGE_KEY = 'teacherpro-grade-entry-missing-notes-outbox-v1';

type OutboxItem = {
  id: string;
  examId: string;
  examName: string;
  examDate: string;
  text: string;
  queuedAt: number;
};

function canUseBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeNote(item: unknown): GradeEntryMissingNote | null {
  const raw = item as Partial<GradeEntryMissingNote> | null;
  if (!raw || typeof raw !== 'object') return null;
  const examId = String(raw.examId || '').trim();
  const text = String(raw.text || '').trim();
  if (!examId || !text) return null;
  const now = new Date().toISOString();
  return {
    id: String(raw.id || `exam:${examId}`),
    examId,
    examName: String(raw.examName || 'امتحان غير محدد'),
    examDate: String(raw.examDate || ''),
    text,
    userId: raw.userId ?? null,
    userName: raw.userName ?? null,
    createdAt: String(raw.createdAt || raw.updatedAt || now),
    updatedAt: String(raw.updatedAt || raw.createdAt || now),
  };
}

// ─── localStorage cache (offline fallback) ───────────────────────────────

function readCache(): GradeEntryMissingNote[] {
  if (!canUseBrowserStorage()) return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(GRADE_ENTRY_MISSING_NOTES_STORAGE_KEY) || '[]',
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeNote)
      .filter((note): note is GradeEntryMissingNote => Boolean(note));
  } catch {
    return [];
  }
}

function writeCache(notes: GradeEntryMissingNote[]) {
  if (!canUseBrowserStorage()) return;
  window.localStorage.setItem(
    GRADE_ENTRY_MISSING_NOTES_STORAGE_KEY,
    JSON.stringify(notes),
  );
  window.dispatchEvent(new CustomEvent(GRADE_ENTRY_MISSING_NOTES_EVENT));
}

function readLegacy(): GradeEntryMissingNote[] {
  if (!canUseBrowserStorage()) return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(LEGACY_GRADE_ENTRY_NOTES_STORAGE_KEY) || '{}',
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const now = new Date().toISOString();
    return Object.entries(parsed)
      .map(([examId, text]) =>
        normalizeNote({
          id: `exam:${examId}`,
          examId,
          examName: 'امتحان غير محدد',
          text: typeof text === 'string' ? text : '',
          createdAt: now,
          updatedAt: now,
        }),
      )
      .filter((note): note is GradeEntryMissingNote => Boolean(note));
  } catch {
    return [];
  }
}

// ─── Outbox for transient failures ───────────────────────────────────────

function readOutbox(): OutboxItem[] {
  if (!canUseBrowserStorage()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OUTBOX_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(items: OutboxItem[]) {
  if (!canUseBrowserStorage()) return;
  window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items.slice(-500)));
}

function pushToOutbox(input: { examId: string; examName: string; examDate: string; text: string }) {
  const items = readOutbox().filter((item) => item.examId !== input.examId);
  items.push({
    id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: Date.now(),
    ...input,
  });
  writeOutbox(items);
}

function removeFromOutbox(examId: string) {
  writeOutbox(readOutbox().filter((item) => item.examId !== examId));
}

let flushInFlight = false;

async function flushOutbox() {
  if (flushInFlight) return;
  const items = readOutbox();
  if (items.length === 0) return;
  flushInFlight = true;
  try {
    for (const item of items) {
      try {
        const res = await fetch('/api/grade-entry-missing-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            examId: item.examId,
            examName: item.examName,
            examDate: item.examDate,
            text: item.text,
          }),
        });
        if (res.ok) {
          removeFromOutbox(item.examId);
        }
      } catch {
        // Network still failing; keep in outbox for next attempt.
      }
    }
  } finally {
    flushInFlight = false;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

let serverCache: GradeEntryMissingNote[] | null = null;
let lastServerFetch = 0;
const SERVER_FETCH_DEBOUNCE_MS = 5000;

export async function fetchGradeEntryMissingNotesFromServer(): Promise<GradeEntryMissingNote[]> {
  if (Date.now() - lastServerFetch < SERVER_FETCH_DEBOUNCE_MS && serverCache) {
    return serverCache;
  }
  try {
    const res = await fetch('/api/grade-entry-missing-notes', { credentials: 'same-origin' });
    if (!res.ok) return serverCache || readCache();
    const data = await res.json();
    const notes = Array.isArray(data?.notes)
      ? data.notes.map(normalizeNote).filter((n): n is GradeEntryMissingNote => Boolean(n))
      : [];
    serverCache = notes;
    lastServerFetch = Date.now();
    writeCache(notes);
    // Opportunistically flush any pending outbox items.
    void flushOutbox();
    return notes;
  } catch {
    return serverCache || readCache();
  }
}

export function readGradeEntryMissingNotes(): GradeEntryMissingNote[] {
  if (serverCache) return serverCache;
  const cached = readCache();
  const cachedExamIds = new Set(cached.map((n) => n.examId));
  const legacy = readLegacy().filter((n) => !cachedExamIds.has(n.examId));
  return [...cached, ...legacy].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function findGradeEntryMissingNote(examId: string) {
  const normalizedExamId = String(examId || '').trim();
  if (!normalizedExamId) return null;
  return readGradeEntryMissingNotes().find((note) => note.examId === normalizedExamId) || null;
}

export async function upsertGradeEntryMissingNote(input: {
  examId: string;
  examName: string;
  examDate?: string;
  text: string;
}): Promise<void> {
  const examId = String(input.examId || '').trim();
  const text = String(input.text || '').trim();
  if (!examId) return;

  // Optimistic local update
  const existing = readGradeEntryMissingNotes();
  const now = new Date().toISOString();
  if (!text) {
    writeCache(existing.filter((n) => n.examId !== examId));
  } else {
    const next: GradeEntryMissingNote = {
      id: existing.find((n) => n.examId === examId)?.id || `exam:${examId}`,
      examId,
      examName: input.examName,
      examDate: input.examDate || '',
      text,
      createdAt: existing.find((n) => n.examId === examId)?.createdAt || now,
      updatedAt: now,
    };
    writeCache([next, ...existing.filter((n) => n.examId !== examId)]);
    if (serverCache) {
      serverCache = [next, ...serverCache.filter((n) => n.examId !== examId)];
    }
  }

  // Try server; on failure queue to outbox for retry.
  try {
    const res = await fetch('/api/grade-entry-missing-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        examId,
        examName: input.examName,
        examDate: input.examDate || '',
        text,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    if (text) {
      pushToOutbox({
        examId,
        examName: input.examName,
        examDate: input.examDate || '',
        text,
      });
    }
  }
}

export async function deleteGradeEntryMissingNote(examId: string): Promise<void> {
  const normalizedExamId = String(examId || '').trim();
  if (!normalizedExamId) return;
  writeCache(readCache().filter((n) => n.examId !== normalizedExamId));
  if (serverCache) {
    serverCache = serverCache.filter((n) => n.examId !== normalizedExamId);
  }
  removeFromOutbox(normalizedExamId);
  try {
    await fetch(
      `/api/grade-entry-missing-notes?examId=${encodeURIComponent(normalizedExamId)}`,
      { method: 'DELETE', credentials: 'same-origin' },
    );
  } catch {
    // Best-effort; the local cache is already updated.
  }
}

// Browser-event hooks so background tabs flush their outbox when online.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void flushOutbox(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOutbox();
  });
}
