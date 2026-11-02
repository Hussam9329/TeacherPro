/**
 * Splits text copied from Telegram into one block per student.
 *
 * Each admin message starts a new segment and sets the group link. Every
 * student message that follows belongs to that link; messages from the same
 * sender inside one segment are joined into one block.
 *
 * A "filled" admin message (the newer template that already carries the
 * student's name, numbers…) is itself a student record: its field lines and
 * the student's reply in the same segment become one block. Text pasted
 * without any "[date] sender:" line is read as one message.
 */
import { collapseSpaces, stripChars } from "./cleaning";

const HEADER = /^\[(\d{1,2}-[A-Za-z]{3}-\d{2,4}[^\]]*)\]\s?(.*)$/;
const LINK = /t\.me\/\+([A-Za-z0-9_-]+)/g;
const SEPARATOR = /^[\s=\-_~*.]+$/;
const PHOTO = /\[\s*(Photo|Video|Sticker|File)\s*\]/gi;
const REPLY = " in reply to ";
// "label: value" lines of a filled template. Everything else in it is template text.
const FIELD_LINE = /^(?:الاسم|اسم|رقم|المحافظ|معرف|يوزر|المدرس|المنطق|الجنس)[^:：\n]{0,20}[:：]/;
const NAME_FILLED = /^(?:الاسم|اسم)[^:：\n]{0,15}[:：]\s*\S/;
// Marks the management's template when it is pasted without a sender line.
const TEMPLATE_MARK = /إدارة الأستاذ|ادارة الاستاذ|1️⃣/;
const DIRECTION_MARKS = /[‎‏]/g;

type Message = { sender: string; lines: string[]; isReply: boolean };

/** True for registration messages: copied from Telegram ("[date] sender:" lines) or the management's template on its own. */
export function looksLikeRegistrationText(text: string): boolean {
  return TEMPLATE_MARK.test(text) || text.split(/\r?\n/).some((line) => HEADER.test(line.trim()));
}

export type StudentBlock = {
  blockId: number;
  /** The group link id, "" when none was found. */
  link: string;
  sender: string;
  text: string;
};

const pyRstrip = (line: string) => line.replace(/\s+$/, "");

function splitHeader(rest: string): [string, string] {
  const index = rest.indexOf(":");
  if (index < 0) return [rest.trim(), ""];
  return [rest.slice(0, index).trim(), rest.slice(index + 1).trim()];
}

function readMessages(text: string): Message[] {
  const messages: Message[] = [];
  let current: Message | null = null;
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  for (const raw of rawLines) {
    const line = pyRstrip(raw.replace(DIRECTION_MARKS, ""));
    const match = HEADER.exec(line);
    if (match) {
      const [rawSender, body] = splitHeader(match[2]);
      let sender = rawSender;
      const isReply = sender.includes(REPLY);
      if (isReply) sender = sender.split(REPLY)[0].trim();
      current = { sender, lines: [], isReply };
      if (body) current.lines.push(body);
      messages.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (!messages.length && text.trim()) {
    // Pasted without a sender line.
    messages.push({ sender: "", lines: rawLines.map((line) => pyRstrip(line.replace(DIRECTION_MARKS, ""))), isReply: false });
  }
  return messages;
}

const norm = (line: string) => stripChars(collapseSpaces(line), " .،,");

function cleanLines(lines: string[], templateLines: Set<string>): string[] {
  const kept: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(PHOTO, "").trim();
    if (!line || SEPARATOR.test(line)) continue;
    if (line.startsWith(">") || line.toLowerCase().startsWith("forwarded from")) continue;
    if (templateLines.has(norm(line))) continue;
    kept.push(collapseSpaces(line));
  }
  return kept;
}

const fieldText = (line: string) => norm(line).replace(/^[ \-–ـ•*]+/, "");
// A field left empty («المدرسة:») says nothing, so it is template text, not the student's answer.
const hasValue = (line: string) => {
  const text = fieldText(line);
  const label = FIELD_LINE.exec(text);
  return Boolean(label && text.slice(label[0].length).trim());
};
const fieldLines = (message: Message) => message.lines.filter(hasValue);
const isFilled = (message: Message) => message.lines.some((line) => NAME_FILLED.test(fieldText(line)));
const lastLink = (text: string) => {
  const found = [...text.matchAll(LINK)];
  return found.length ? found[found.length - 1][1] : "";
};

export function splitStudents(text: string, adminSender: string): StudentBlock[] {
  const messages = readMessages(text);
  const admin = collapseSpaces(adminSender);
  for (const message of messages) {
    // The management's template pasted on its own.
    if (!message.sender && TEMPLATE_MARK.test(message.lines.join("\n"))) message.sender = admin;
  }
  const isAdmin = (message: Message) => collapseSpaces(message.sender) === admin && !message.isReply;

  // Lines of every admin template, so a student who pasted the template back
  // only keeps the parts they filled in. A filled template keeps its field lines.
  const templateLines = new Set<string>();
  for (const message of messages) {
    if (!isAdmin(message)) continue;
    const fields = new Set(isFilled(message) ? fieldLines(message) : []);
    for (const line of message.lines) {
      if (norm(line) && !fields.has(line)) templateLines.add(norm(line));
    }
  }

  type Segment = { link: string; messages: Message[]; filled: string[] };
  const segments: Segment[] = [];
  let link = "";
  for (const message of messages) {
    if (isAdmin(message)) {
      link = lastLink(message.lines.join("\n")) || link;
      segments.push({ link, messages: [], filled: isFilled(message) ? fieldLines(message) : [] });
    } else {
      if (!segments.length) segments.push({ link, messages: [], filled: [] });
      segments[segments.length - 1].messages.push(message);
    }
  }

  const blocks: StudentBlock[] = [];
  for (const segment of segments) {
    if (segment.filled.length) {
      // One student: their reply first (so their corrections win), then the template's fields.
      const lines = [...segment.messages.flatMap((message) => message.lines), ...segment.filled];
      const kept = [...new Set(cleanLines(lines, templateLines))];
      const sender = segment.messages[0]?.sender ?? admin;
      blocks.push({ blockId: blocks.length + 1, link: segment.link, sender, text: kept.join("\n") });
      continue;
    }
    const bySender = new Map<string, string[]>();
    for (const message of segment.messages) {
      const lines = bySender.get(message.sender) ?? [];
      lines.push(...message.lines);
      bySender.set(message.sender, lines);
    }
    for (const [sender, lines] of bySender) {
      const ownLink = segment.link || lastLink(lines.join("\n"));
      const kept = cleanLines(lines, templateLines);
      if (kept.length) blocks.push({ blockId: blocks.length + 1, link: ownLink, sender, text: kept.join("\n") });
    }
  }
  return blocks;
}
