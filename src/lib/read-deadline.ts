/** Bound read-only requests, including response-body decoding. Never retry a write. */
export async function withReadDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  let rejectDeadline: (reason: Error) => void = () => {};
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const cancel = () => {
    controller.abort();
    rejectDeadline(new DOMException("Read cancelled", "AbortError"));
  };
  const timer = setTimeout(() => {
    // Reject first so a slow read is reported as a timeout, not a silent cancel.
    rejectDeadline(new Error("تأخر تحميل البيانات. اضغط إعادة المحاولة."));
    controller.abort();
  }, timeoutMs);
  callerSignal?.addEventListener("abort", cancel, { once: true });
  try {
    if (callerSignal?.aborted) cancel();
    return await Promise.race([
      deadline,
      controller.signal.aborted ? deadline : read(controller.signal),
    ]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", cancel);
  }
}
