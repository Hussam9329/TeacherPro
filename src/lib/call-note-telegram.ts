/**
 * The message the Telegram button in «إدارة ملاحظات المكالمات» writes into
 * the student's chat (and copies, in case the Telegram app leaves the box
 * empty): the code is stopped because the guardian's number does not work,
 * and the student sends both parents' numbers to get it opened again.
 */
export const GUARDIAN_NUMBER_NOT_WORKING_MESSAGE = [
  "عزيزي الطالب، الكود مالتك متوقف لأن رقم ولي الأمر المسجّل عدنا ما يشتغل.",
  "✅ حتى يرجع يتفعل:",
  "دزلنا رقمين لولي الأمر:",
  "1️⃣ رقم الأب",
  "2️⃣ رقم الأم",
  "ومعاهم اسمك الرباعي.",
  "⚠️ لازم تكون الأرقام آسياسيل أو زين، وتكون شغّالة.",
  "دزها بأسرع وقت حتى نكمّل إجراءات فتح الكود وما نتأخر عليك 🙏",
].join("\n");

/**
 * A Telegram chat link («tg://resolve?domain=…») that opens the chat with
 * `message` already typed in the message box, ready to send.
 */
export function telegramChatWithMessage(chatLink: string, message = GUARDIAN_NUMBER_NOT_WORKING_MESSAGE): string {
  if (!chatLink) return "";
  return `${chatLink}${chatLink.includes("?") ? "&" : "?"}text=${encodeURIComponent(message)}`;
}
