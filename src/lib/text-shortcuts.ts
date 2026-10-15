/**
 * «اختصارات»: ready texts (كليشات) the admin and the supervisors copy with one
 * click. The same limits and clean-up run in the window and on the server.
 */

export const TEXT_SHORTCUT_LABEL_MAX = 60;
export const TEXT_SHORTCUT_TEXT_MAX = 4000;
export const TEXT_SHORTCUTS_MAX = 100;

export type TextShortcut = {
  id: string;
  label: string;
  text: string;
  sortOrder: number;
  updatedByName: string;
  updatedAt: string;
};

export type TextShortcutInput = { label: string; text: string };

/** One line, single spaces. */
export function cleanShortcutLabel(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Keeps the lines and spaces as written; only the ends are trimmed. */
export function cleanShortcutText(value: unknown): string {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/^\s*\n|\s+$/g, "");
}

export function readTextShortcutInput(body: unknown): TextShortcutInput | { error: string } {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const label = cleanShortcutLabel(source.label);
  const text = cleanShortcutText(source.text);
  if (!label) return { error: "اكتب اسم الزر." };
  if (label.length > TEXT_SHORTCUT_LABEL_MAX) return { error: `اسم الزر أطول من ${TEXT_SHORTCUT_LABEL_MAX} حرف.` };
  if (!text.trim()) return { error: "اكتب النص اللي ينسخه الزر." };
  if (text.length > TEXT_SHORTCUT_TEXT_MAX) return { error: `النص أطول من ${TEXT_SHORTCUT_TEXT_MAX} حرف.` };
  return { label, text };
}
