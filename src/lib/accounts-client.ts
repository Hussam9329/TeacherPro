/**
 * Account changes (users and roles) wait for the server's answer. The screen
 * says «تم الحفظ» only when the database took the change, and otherwise shows
 * the server's own reason. No offline queue: an account change that is not
 * saved now must not look saved.
 */
export type AccountResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

async function accountRequest<T = Record<string, unknown>>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<AccountResult<T>> {
  try {
    const res = await fetch(`/api/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const error =
        (data && typeof data.error === "string" && data.error) ||
        (res.status === 401
          ? "انتهت الجلسة. سجّل الدخول مرة ثانية."
          : res.status === 403
            ? "ما عندك صلاحية لهذا التعديل."
            : `ما انحفظ التعديل (رمز ${res.status}).`);
      return { ok: false, error, status: res.status };
    }
    return { ok: true, data: (data || {}) as T };
  } catch {
    return {
      ok: false,
      error: "ما وصل الطلب للخادم. تأكد من الاتصال وأعد المحاولة؛ ما انحفظ شي.",
      status: 0,
    };
  }
}

export const accountsApi = {
  listUsers: () => accountRequest<{ users?: Record<string, unknown>[] }>("GET", "users"),
  listRoles: () => accountRequest<{ roles?: Record<string, unknown>[] }>("GET", "roles"),
  createUser: (body: Record<string, unknown>) => accountRequest("POST", "users", body),
  updateUser: (id: string, body: Record<string, unknown>) =>
    accountRequest("PUT", "users", { id, ...body }),
  deleteUser: (id: string) => accountRequest("DELETE", `users?id=${encodeURIComponent(id)}`),
  createRole: (body: Record<string, unknown>) => accountRequest("POST", "roles", body),
  updateRole: (id: string, body: Record<string, unknown>) =>
    accountRequest<{ updatedUserPermissions?: number }>("PUT", "roles", { id, ...body }),
  deleteRole: (id: string) => accountRequest("DELETE", `roles?id=${encodeURIComponent(id)}`),
};
