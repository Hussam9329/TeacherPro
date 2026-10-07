import { ownerHeaders } from "@/lib/outbox-session";
import { withReadDeadline } from "@/lib/read-deadline";
import type { ContactStatus } from "@/lib/call-contact-status";

export type ManagedCallNote = {
  id: string;
  studentId: string;
  examId: string | null;
  notes: string;
  noteRevision: number;
  noteResolved: boolean;
  createdAt: string;
  student: {
    id: string;
    name: string;
    code: string;
    telegram: string | null;
    username: string | null;
    courseId: string;
    course: { id: string; name: string } | null;
  };
  exam: { id: string; name: string } | null;
  scope: "exam" | "general";
  contactStatus: ContactStatus;
  contactExam: { id: string; name: string } | null;
  /** «الأرشيف» only: when the note was completed and by whom, if logged. */
  resolvedAt?: string | null;
  resolvedBy?: string | null;
};

/** «المعلّقة» (waiting) or «الأرشيف» (completed). */
export type CallNotesView = "pending" | "archive";

export type ManagedCallNotesResponse = {
  notes: ManagedCallNote[];
  totalCount: number;
};

async function responseBody(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "تعذر تحديث ملاحظات المكالمات. أعد المحاولة.",
    );
  }
  if (!body) throw new Error("تعذر قراءة ملاحظات المكالمات. أعد المحاولة.");
  return body;
}

export const callNotesManagementApi = {
  list(signal?: AbortSignal, view: CallNotesView = "pending"): Promise<ManagedCallNotesResponse> {
    return withReadDeadline(async (readSignal) => {
      const response = await fetch(view === "archive" ? "/api/student-calls/notes?view=archive" : "/api/student-calls/notes", {
        credentials: "same-origin",
        cache: "no-store",
        signal: readSignal,
      });
      return responseBody(response);
    }, signal);
  },

  async resolve(note: Pick<ManagedCallNote, "id" | "noteRevision">, resolved = true) {
    // A versioned, explicit value is sent once. An uncertain write is never
    // queued on this device or replayed over another user's later note edit.
    const response = await fetch("/api/student-calls/notes", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ id: note.id, expectedRevision: note.noteRevision, resolved }),
    });
    return responseBody(response);
  },

  /** «تراجع» right after «إنجاز»: the same note, back to waiting. */
  reopen(note: Pick<ManagedCallNote, "id" | "noteRevision">) {
    return callNotesManagementApi.resolve(note, false);
  },
};
