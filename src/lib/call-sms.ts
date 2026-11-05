import { callPhoneDialNumber } from "./call-phone-qr";

/** What the follow-up text message says about one exam result. */
export type CallSmsDetails = {
  studentName: string;
  examName: string;
  /** Already formatted for reading («12 تشرين الثاني 2026»); "" leaves it out. */
  examDate: string;
  /** The course's active chapter; "" leaves it out. */
  chapterName: string;
  /** «25/50»; ignored when the student was absent. */
  score: string;
  absent: boolean;
  /** The deduction or dismissal taken; "" drops the «الإجراء المتخذ» line. */
  action: string;
};

/** The follow-up department's message after a call about an exam result. */
export function callSmsMessage(details: CallSmsDetails): string {
  const about = [
    `نود إعلام حضرتكم بأنه قد تم الاتصال على رقمكم الخاص بخصوص الطالب ${details.studentName}`,
    `، وذلك لإبلاغكم بنتيجة امتحان ${details.examName}`,
    details.examDate ? ` الذي أُجري بتاريخ ${details.examDate}` : "",
    details.chapterName ? `، والخاص بـ${details.chapterName}` : "",
    ".",
  ].join("");
  const result = details.absent
    ? "حيث كان الطالب غائباً عن الامتحان."
    : `حيث حصل الطالب على درجة ${details.score}.`;
  return [
    "السلام عليكم ورحمة الله وبركاته",
    about,
    result,
    details.action ? `الإجراء المتخذ: ${details.action}.` : "",
    "نرجو من حضرتكم متابعة المستوى الدراسي للطالب والاهتمام بأدائه في الامتحانات القادمة.",
    "مع خالص الشكر والتقدير لتعاونكم واهتمامكم.",
    "قسم المتابعة – الأستاذ حسن فلاح لمادة الأحياء",
  ].filter(Boolean).join("\n");
}

/**
 * An sms: link with the message filled in. Windows hands it to «ارتباط الهاتف»,
 * which sends it from the paired phone after the employee presses send.
 */
export function callSmsHref(phone: string | null | undefined, message: string): string {
  const dialNumber = callPhoneDialNumber(phone);
  return dialNumber ? `sms:${dialNumber}?body=${encodeURIComponent(message)}` : "";
}
