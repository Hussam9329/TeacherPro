const RELOAD_KEY = "teacherpro:section-chunk-reload-at";
const RELOAD_WINDOW_MS = 60_000;

type Tab = {
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
  location: { reload: () => void };
};

/**
 * A page's chunk can fail to download: the connection dropped, or the tab was
 * left open across a deploy and the chunk it asks for no longer exists. The
 * bundler does not ask again for a chunk that failed, so the tab reloads once
 * to pick up the current build (the address already names the page being
 * opened). A failure right after such a reload gives `fallback` instead, so a
 * real outage never turns into a reload loop or a crashed screen.
 */
export function withChunkRecovery<Loaded, Fallback>(
  load: () => Promise<Loaded>,
  fallback: Fallback,
  tab: () => Tab = () => window,
): () => Promise<Loaded | Fallback> {
  return async () => {
    try {
      return await load();
    } catch {
      const { sessionStorage, location } = tab();
      let reloadedAt = 0;
      try {
        reloadedAt = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
      } catch {}
      if (Date.now() - reloadedAt <= RELOAD_WINDOW_MS) return fallback;
      try {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        // Without the marker a second reload could not be told apart from the first.
        return fallback;
      }
      location.reload();
      // The loading state stays up until the reload replaces the page.
      return new Promise<Loaded>(() => {});
    }
  };
}
