/** The extractor's settings, kept in this browser (as the desktop app kept them on its computer). */
import { DEFAULT_EXTRACTOR_SETTINGS, type ExtractorSettings } from "./config";

const STORAGE_KEY = "teacherpro:telegram-extractor:settings:v1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const fresh = (): ExtractorSettings => JSON.parse(JSON.stringify(DEFAULT_EXTRACTOR_SETTINGS));

export function loadExtractorSettings(): ExtractorSettings {
  const settings = fresh();
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (!isRecord(saved)) return settings;
    if (typeof saved.adminSender === "string") settings.adminSender = saved.adminSender;
    if (typeof saved.status === "string") settings.status = saved.status;
    if (typeof saved.chances === "string") settings.chances = saved.chances;
    if (typeof saved.grace === "string") settings.grace = saved.grace;
    if (isRecord(saved.links)) settings.links = saved.links as ExtractorSettings["links"];
    if (isRecord(saved.governorateAliases)) settings.governorateAliases = saved.governorateAliases as Record<string, string>;
  } catch {
    // Blocked or broken storage: the defaults still work.
  }
  return settings;
}

/** Returns false when the browser refused to keep them. */
export function saveExtractorSettings(settings: ExtractorSettings): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
