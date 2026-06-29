export type GradeEntryMissingNote = {
  id: string;
  examId: string;
  examName: string;
  examDate: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export const GRADE_ENTRY_MISSING_NOTES_STORAGE_KEY =
  'teacherpro-grade-entry-missing-students-notes-v1';
export const GRADE_ENTRY_MISSING_NOTES_EVENT =
  'teacherpro:grade-entry-missing-notes-updated';
const LEGACY_GRADE_ENTRY_NOTES_STORAGE_KEY = 'teacherpro-grade-entry-notes-v1';

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
    createdAt: String(raw.createdAt || raw.updatedAt || now),
    updatedAt: String(raw.updatedAt || raw.createdAt || now),
  };
}

function readPrimaryGradeEntryMissingNotes(): GradeEntryMissingNote[] {
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

function readLegacyGradeEntryMissingNotes(): GradeEntryMissingNote[] {
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

export function readGradeEntryMissingNotes(): GradeEntryMissingNote[] {
  const primaryNotes = readPrimaryGradeEntryMissingNotes();
  const primaryExamIds = new Set(primaryNotes.map((note) => note.examId));
  const legacyNotes = readLegacyGradeEntryMissingNotes().filter(
    (note) => !primaryExamIds.has(note.examId),
  );
  return [...primaryNotes, ...legacyNotes]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function writeGradeEntryMissingNotes(notes: GradeEntryMissingNote[]) {
  if (!canUseBrowserStorage()) return;
  window.localStorage.setItem(
    GRADE_ENTRY_MISSING_NOTES_STORAGE_KEY,
    JSON.stringify(notes),
  );
  window.dispatchEvent(new CustomEvent(GRADE_ENTRY_MISSING_NOTES_EVENT));
}

export function findGradeEntryMissingNote(examId: string) {
  const normalizedExamId = String(examId || '').trim();
  if (!normalizedExamId) return null;
  return readGradeEntryMissingNotes().find((note) => note.examId === normalizedExamId) || null;
}

export function upsertGradeEntryMissingNote(input: {
  examId: string;
  examName: string;
  examDate?: string;
  text: string;
}) {
  const examId = String(input.examId || '').trim();
  const text = String(input.text || '').trim();
  if (!examId) return;
  const notes = readGradeEntryMissingNotes();
  const existing = notes.find((note) => note.examId === examId);
  const now = new Date().toISOString();

  if (!text) {
    writeGradeEntryMissingNotes(notes.filter((note) => note.examId !== examId));
    return;
  }

  const nextNote: GradeEntryMissingNote = {
    id: existing?.id || `exam:${examId}`,
    examId,
    examName: String(input.examName || existing?.examName || 'امتحان غير محدد'),
    examDate: String(input.examDate || existing?.examDate || ''),
    text,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  writeGradeEntryMissingNotes([
    nextNote,
    ...notes.filter((note) => note.examId !== examId),
  ]);
}

export function deleteGradeEntryMissingNote(examId: string) {
  const normalizedExamId = String(examId || '').trim();
  if (!normalizedExamId) return;
  writeGradeEntryMissingNotes(
    readPrimaryGradeEntryMissingNotes().filter((note) => note.examId !== normalizedExamId),
  );
  if (canUseBrowserStorage()) {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(LEGACY_GRADE_ENTRY_NOTES_STORAGE_KEY) || '{}',
      );
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        delete (parsed as Record<string, unknown>)[normalizedExamId];
        window.localStorage.setItem(LEGACY_GRADE_ENTRY_NOTES_STORAGE_KEY, JSON.stringify(parsed));
      }
    } catch {
      // Ignore malformed legacy snapshots.
    }
  }
}
