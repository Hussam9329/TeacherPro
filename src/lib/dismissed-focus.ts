/**
 * «إرجاع الطالب» from a student's profile: hands the student to the dismissed
 * students page, which opens already searched to them. A request made while
 * that page is open reaches it directly; otherwise it waits for it to mount.
 */
type FocusListener = (query: string) => void;

let pendingQuery: string | null = null;
const listeners = new Set<FocusListener>();

export function requestDismissedStudentFocus(query: string) {
  const value = query.trim();
  if (!value) return;
  if (listeners.size > 0) {
    listeners.forEach((listener) => listener(value));
    return;
  }
  pendingQuery = value;
}

/** The waiting request, if any, for the page's first render. */
export function peekDismissedStudentFocus(): string | null {
  return pendingQuery;
}

export function subscribeDismissedStudentFocus(listener: FocusListener) {
  pendingQuery = null;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
