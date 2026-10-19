/**
 * Firebase Cloud Messaging, HTTP v1, for Android devices. Auth is a
 * service-account JWT (RS256) exchanged for a short-lived access token;
 * nothing but node:crypto and fetch, so the module runs in tests as is.
 */
import { createSign } from "node:crypto";
import { base64url, mapWithLimit, type PushMessage, type PushResult, type PushSender } from "./push-types.ts";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const CONCURRENCY = 10;

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };

export type FcmSenderOptions = {
  serviceAccountJson: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

export function parseServiceAccount(json: string): ServiceAccount {
  const parsed = JSON.parse(json) as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON ينقصه project_id أو client_email أو private_key.");
  }
  return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") } as ServiceAccount;
}

function signAssertion(account: ServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

export function createFcmSender({ serviceAccountJson, fetchFn = fetch, now = () => new Date() }: FcmSenderOptions): PushSender {
  const account = parseServiceAccount(serviceAccountJson);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  let cached: { accessToken: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string | null> {
    const nowMs = now().getTime();
    if (cached && cached.expiresAt - 60_000 > nowMs) return cached.accessToken;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signAssertion(account, Math.floor(nowMs / 1000)),
    });
    try {
      const response = await fetchFn(account.token_uri || "https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const payload = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
      if (!response.ok || !payload.access_token) return null;
      cached = { accessToken: payload.access_token, expiresAt: nowMs + (payload.expires_in ?? 3600) * 1000 };
      return cached.accessToken;
    } catch {
      return null;
    }
  }

  async function sendOne(token: string, message: PushMessage, bearer: string): Promise<PushResult> {
    try {
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: message.data ?? {},
            android: { priority: "high", notification: { sound: "default" } },
          },
        }),
      });
      if (response.ok) return { token, ok: true, unregistered: false };
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
      };
      const codes = (payload.error?.details ?? []).map((d) => d.errorCode);
      const unregistered =
        response.status === 404 ||
        codes.includes("UNREGISTERED") ||
        (response.status === 400 && payload.error?.status === "INVALID_ARGUMENT");
      return { token, ok: false, unregistered };
    } catch {
      return { token, ok: false, unregistered: false };
    }
  }

  return {
    async send(tokens, message) {
      if (!tokens.length) return [];
      const bearer = await accessToken();
      if (!bearer) return tokens.map((token) => ({ token, ok: false, unregistered: false }));
      return mapWithLimit(tokens, CONCURRENCY, (token) => sendOne(token, message, bearer));
    },
  };
}
