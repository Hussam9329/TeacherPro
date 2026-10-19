/** One notification as the senders see it. `data` rides along for the app. */
export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type PushResult = {
  token: string;
  ok: boolean;
  /** The platform said this token is dead: clear it, never retry. */
  unregistered: boolean;
};

export type PushSender = {
  send(tokens: string[], message: PushMessage): Promise<PushResult[]>;
};

/** Runs `fn` over `items` with at most `limit` in flight, keeping the order. */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}
