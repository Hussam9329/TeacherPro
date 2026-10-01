/**
 * «تقسيم العمل» in إدارة المكالمات: several people (often on one shared
 * account) can split a list so nobody calls the same student. A share
 * "k/n" keeps the students whose id hashes to slot k of n. The slot depends
 * only on the student id, so a student never moves to another person when
 * filters, actions or pages change the list.
 */
export type CallWorkShare = { part: number; parts: number };

export const CALL_WORK_SHARE_MAX_PARTS = 5;

export function parseCallWorkShare(value: unknown): CallWorkShare | null {
  const match = /^(\d+)\/(\d+)$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const part = Number(match[1]);
  const parts = Number(match[2]);
  if (parts < 2 || parts > CALL_WORK_SHARE_MAX_PARTS || part < 1 || part > parts) return null;
  return { part, parts };
}

export function formatCallWorkShare(share: CallWorkShare): string {
  return `${share.part}/${share.parts}`;
}

/** FNV-1a: stable across server and browser, evenly spread for cuid ids. */
function hashStudentId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function studentInCallWorkShare(studentId: string, share: CallWorkShare | null): boolean {
  if (!share) return true;
  return hashStudentId(studentId) % share.parts === share.part - 1;
}

/** Every choice offered in the menu: whole list, then 1/2 … 5/5. */
export function callWorkShareOptions(): string[] {
  const options: string[] = [];
  for (let parts = 2; parts <= CALL_WORK_SHARE_MAX_PARTS; parts += 1) {
    for (let part = 1; part <= parts; part += 1) options.push(`${part}/${parts}`);
  }
  return options;
}
