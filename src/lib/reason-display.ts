/**
 * Stored opportunity and dismissal reasons keep the markers the calculation
 * depends on («تلقائي:», [zero-balance-violation], [undo-ref:…],
 * [academic-reactivation-link:…], the balance brackets). People see the same
 * reason without them. Display only: never use the result for logic, and
 * never write it back.
 */

const BALANCE_CLAMP_MARKER =
  /\s*\[مطلوب:\s*([^،\]]+?)،\s*مطبّق:\s*([^،\]]+?)،\s*قبل:\s*([^→\]]+?)\s*→\s*بعد:\s*([^\]]+?)\]/gu;
const BALANCE_RESET_MARKER =
  /\s*\[قبل:\s*([^→\]]+?)\s*→\s*بعد:\s*([^،\]]+?)(?:،\s*فرق:\s*[^\]]*)?\]/gu;
const ZERO_BALANCE_MARKER = /\s*\[zero-balance-violation\]/gu;
const HIDDEN_MARKERS = /\s*\[(?:undo-ref|academic-[a-z-]+):[^\]]*\]/gu;
const AUTOMATIC_PREFIX = /^\s*تلقائي:\s*/u;

/**
 * A stored dismissal reason as one plain sentence: «مخالفة بعد انتهاء الفرص -
 * غياب في امتحان يومي: X» → «غاب بـX وهو بدون فرص». `mark` wraps the exam
 * name and score (the story makes them bold). Other text is returned as is.
 */
export function dismissalReasonSentence(text: string, mark: (value: string) => string = (value) => value): string {
  const reason = String(text ?? "").trim();
  // «بامتحان 4» joins an Arabic word; «بـ12» keeps the tatweel before a number.
  const exam = (name: string) => (/^[\u0600-\u06FF]/u.test(name.trim()) ? `ب${mark(name.trim())}` : `بـ${mark(name.trim())}`);
  let match: RegExpExecArray | null;
  if ((match = /^مخالفة بعد انتهاء الفرص - غياب في امتحان[^:]*:\s*(.+)$/u.exec(reason))) return `غاب ${exam(match[1])} وهو بدون فرص`;
  if ((match = /^مخالفة بعد انتهاء الفرص - درجة خصم \((\d+)\) في امتحان:\s*(.+)$/u.exec(reason))) return `جاب ${mark(match[1])} ${exam(match[2])} وهو بدون فرص`;
  if ((match = /^مخالفة بعد انتهاء الفرص - خصم يدوي:\s*(.+?)(?:\s*\(خصم والفرص صفر\))?$/u.exec(reason))) return `انخصمت عليه فرصة يدوياً وهو بدون فرص: ${match[1].trim()}`;
  if ((match = /^غش(?: أول| متكرر)? في امتحان:\s*(.+?)(?: - خصم جميع الفرص)?$/u.exec(reason))) return `غش ${exam(match[1])}`;
  if ((match = /^غياب ضمن درجة الفصل في امتحان[^:]*:\s*(.+)$/u.exec(reason))) return `غاب ${exam(match[1])}، وغياب هذا الامتحان يفصل`;
  if ((match = /^درجة صفر في امتحان[^:]*:\s*(.+)$/u.exec(reason))) return `جاب صفر ${exam(match[1])}`;
  if ((match = /^درجة فصل \((\d+)\):\s*(.+)$/u.exec(reason))) return `جاب ${mark(match[1])} ${exam(match[2])}، وهاي درجة فصل`;
  return reason;
}

/**
 * `sentence: false` keeps a dismissal reason in its stored wording, for
 * messages that leave the system in standard Arabic.
 */
export function displayReasonText(value: unknown, options: { sentence?: boolean } = {}): string {
  const cleaned = cleanReasonText(value);
  return options.sentence === false ? cleaned : dismissalReasonSentence(cleaned);
}

function cleanReasonText(value: unknown): string {
  return String(value ?? "")
    .replace(AUTOMATIC_PREFIX, "")
    .replace(
      BALANCE_CLAMP_MARKER,
      (_match, requested: string, applied: string, before: string, after: string) =>
        ` (المطلوب ${requested.trim()}، المطبّق ${applied.trim()}، الفرص من ${before.trim()} إلى ${after.trim()})`,
    )
    .replace(
      BALANCE_RESET_MARKER,
      (_match, before: string, after: string) =>
        ` (الفرص من ${before.trim()} إلى ${after.trim()})`,
    )
    .replace(ZERO_BALANCE_MARKER, " (خصم والفرص صفر)")
    .replace(HIDDEN_MARKERS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
