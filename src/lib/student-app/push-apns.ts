/**
 * Apple Push Notification service over HTTP/2 for iOS devices, with a
 * provider token (ES256 JWT from the owner's .p8 key). The HTTP/2 transport
 * is injected so the sender runs in tests without a network.
 */
import { createSign } from "node:crypto";
import { base64url, mapWithLimit, type PushMessage, type PushResult, type PushSender } from "./push-types.ts";

const CONCURRENCY = 10;
const DEAD_REASONS = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic", "ExpiredToken"]);

export type ApnsRequest = (input: {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; body: string }>;

export type ApnsSenderOptions = {
  keyId: string;
  teamId: string;
  /** PEM of the .p8 key; "\n" escapes from an env var are accepted. */
  privateKey: string;
  bundleId: string;
  sandbox: boolean;
  request: ApnsRequest;
  now?: () => Date;
};

export function signProviderToken(keyId: string, teamId: string, privateKey: string, issuedAtSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: issuedAtSeconds }));
  const signature = createSign("sha256")
    .update(`${header}.${claims}`)
    .sign({ key: privateKey.replace(/\\n/g, "\n"), dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${base64url(signature)}`;
}

export function createApnsSender(options: ApnsSenderOptions): PushSender {
  const { keyId, teamId, privateKey, bundleId, sandbox, request, now = () => new Date() } = options;
  const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";

  async function sendOne(token: string, message: PushMessage, bearer: string): Promise<PushResult> {
    try {
      const response = await request({
        host,
        path: `/3/device/${token}`,
        headers: {
          authorization: `bearer ${bearer}`,
          "apns-topic": bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "content-type": "application/json",
        },
        body: JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: "default" }, ...(message.data ?? {}) }),
      });
      if (response.status === 200) return { token, ok: true, unregistered: false };
      let reason = "";
      try { reason = String((JSON.parse(response.body) as { reason?: string }).reason ?? ""); } catch { /* no body */ }
      const unregistered = response.status === 410 || (response.status === 400 && DEAD_REASONS.has(reason));
      return { token, ok: false, unregistered };
    } catch {
      return { token, ok: false, unregistered: false };
    }
  }

  return {
    async send(tokens, message) {
      if (!tokens.length) return [];
      // One provider token per batch; Apple accepts it for up to an hour.
      const bearer = signProviderToken(keyId, teamId, privateKey, Math.floor(now().getTime() / 1000));
      return mapWithLimit(tokens, CONCURRENCY, (token) => sendOne(token, message, bearer));
    },
  };
}

/** The production transport: one HTTP/2 session per process, reconnecting when it closes. */
export function createHttp2Request(): ApnsRequest {
  type Session = import("node:http2").ClientHttp2Session;
  const sessions = new Map<string, Session>();
  return async ({ host, path, headers, body }) => {
    const http2 = await import("node:http2");
    let session = sessions.get(host);
    if (!session || session.closed || session.destroyed) {
      session = http2.connect(`https://${host}`);
      session.on("error", () => sessions.delete(host));
      session.on("close", () => sessions.delete(host));
      sessions.set(host, session);
    }
    const active = session;
    return new Promise((resolve, reject) => {
      const stream = active.request({ ":method": "POST", ":path": path, ...headers });
      let status = 0;
      const chunks: Buffer[] = [];
      stream.on("response", (responseHeaders) => { status = Number(responseHeaders[":status"] ?? 0); });
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      stream.on("error", reject);
      stream.setTimeout(15_000, () => { stream.close(); reject(new Error("APNs timeout")); });
      stream.end(body);
    });
  };
}
