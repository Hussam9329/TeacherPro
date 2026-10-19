/**
 * Database-bound push helpers: the senders from the environment, the devices
 * a target reaches, and the sent log. The pure senders live in push-*.ts.
 */
import { Prisma } from "@prisma/client";
import { createApnsSender, createHttp2Request } from "./push-apns.ts";
import { createFcmSender } from "./push-fcm.ts";
import { sendToDevices, type PushDevice, type PushSenders, type SendOutcome } from "./push-send.ts";
import type { PushMessage } from "./push-types.ts";

/** Students who receive pushes: not dismissed, not archived. */
export const PUSH_STUDENT_STATUS_FILTER: { notIn: string[] } = { notIn: ["مفصول", "مؤرشف"] };

export const DEFAULT_BUNDLE_ID = "com.hassanfalah.students";

export type ConfiguredSenders = PushSenders & { configured: boolean; missing: string[] };

export function pushSendersFromEnv(env: NodeJS.ProcessEnv = process.env): ConfiguredSenders {
  const missing: string[] = [];
  let fcm: PushSenders["fcm"] = null;
  const serviceAccount = (env.FCM_SERVICE_ACCOUNT_JSON || "").trim();
  if (serviceAccount) {
    try { fcm = createFcmSender({ serviceAccountJson: serviceAccount }); } catch { missing.push("FCM_SERVICE_ACCOUNT_JSON"); }
  } else missing.push("FCM_SERVICE_ACCOUNT_JSON");

  let apns: PushSenders["apns"] = null;
  const keyId = (env.APNS_KEY_ID || "").trim();
  const teamId = (env.APNS_TEAM_ID || "").trim();
  const privateKey = (env.APNS_PRIVATE_KEY || "").trim();
  if (keyId && teamId && privateKey) {
    apns = createApnsSender({
      keyId,
      teamId,
      privateKey,
      bundleId: (env.APNS_BUNDLE_ID || "").trim() || DEFAULT_BUNDLE_ID,
      sandbox: /^(1|true|yes)$/i.test((env.APNS_USE_SANDBOX || "").trim()),
      request: createHttp2Request(),
    });
  } else missing.push("APNS_KEY_ID/APNS_TEAM_ID/APNS_PRIVATE_KEY");
  return { apns, fcm, configured: Boolean(apns || fcm), missing };
}

export type Audience = {
  /** Students the target names (whatever their devices). */
  students: number;
  /** Students with at least one device that can be pushed. */
  reachable: number;
  devices: PushDevice[];
};

type AudienceClient = {
  student: { count(args: { where: Prisma.StudentWhereInput }): Promise<number> };
  studentDevice: {
    findMany(args: {
      where: Prisma.StudentDeviceWhereInput;
      select: { id: true; platform: true; pushToken: true; studentId: true };
    }): Promise<Array<{ id: string; platform: string; pushToken: string | null; studentId: string }>>;
  };
};

/** `courseIds` null means every student. */
export async function resolveAudience(client: AudienceClient, courseIds: string[] | null): Promise<Audience> {
  const studentWhere: Prisma.StudentWhereInput = {
    status: PUSH_STUDENT_STATUS_FILTER,
    ...(courseIds ? { courseId: { in: courseIds } } : {}),
  };
  const [students, rows] = await Promise.all([
    client.student.count({ where: studentWhere }),
    client.studentDevice.findMany({
      where: { revokedAt: null, pushToken: { not: null }, student: studentWhere },
      select: { id: true, platform: true, pushToken: true, studentId: true },
    }),
  ]);
  const devices = rows.filter((r): r is typeof r & { pushToken: string } => Boolean(r.pushToken));
  return { students, reachable: new Set(devices.map((d) => d.studentId)).size, devices };
}

export type PushLogInput = {
  kind: "manual" | "exam-window";
  target: "all" | "course" | "course-chapter" | "exam";
  courseId?: string | null;
  courseName?: string;
  chapterId?: string | null;
  chapterName?: string;
  examId?: string | null;
  title: string;
  body: string;
  userName: string;
};

type LogClient = {
  studentPushLog: {
    create(args: { data: Prisma.StudentPushLogCreateInput }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: { sent: number; failed: number } }): Promise<unknown>;
  };
  studentDevice: {
    updateMany(args: { where: { id: { in: string[] } }; data: { pushToken: null } }): Promise<unknown>;
  };
};

/**
 * Writes the log row first (for the cron that row is the claim: a unique
 * examId refuses a second one), sends, then records the counts and clears
 * the tokens the platforms declared dead.
 */
export async function sendAndLog(
  client: LogClient,
  input: PushLogInput,
  audience: Audience,
  senders: PushSenders,
): Promise<{ logId: string } & SendOutcome> {
  const log = await client.studentPushLog.create({
    data: {
      kind: input.kind,
      target: input.target,
      courseId: input.courseId ?? null,
      courseName: input.courseName ?? "",
      chapterId: input.chapterId ?? null,
      chapterName: input.chapterName ?? "",
      examId: input.examId ?? null,
      title: input.title,
      body: input.body,
      recipients: audience.reachable,
      devices: audience.devices.length,
      userName: input.userName,
    },
  });
  const message: PushMessage = {
    title: input.title,
    body: input.body,
    data: input.kind === "exam-window" && input.examId ? { kind: "exam-window", examId: input.examId } : { kind: input.kind },
  };
  const outcome = await sendToDevices(audience.devices, message, senders);
  if (outcome.unregisteredDeviceIds.length) {
    await client.studentDevice.updateMany({ where: { id: { in: outcome.unregisteredDeviceIds } }, data: { pushToken: null } });
  }
  await client.studentPushLog.update({ where: { id: log.id }, data: { sent: outcome.sent, failed: outcome.failed } });
  return { logId: log.id, ...outcome };
}

export type PushLogRow = {
  id: string; kind: string; target: string; courseId: string | null; courseName: string; chapterId: string | null;
  chapterName: string; examId: string | null; title: string; body: string; recipients: number; devices: number;
  sent: number; failed: number; userName: string; createdAt: Date;
};

/** The log row as the page and the app see it (same fields, no surprises). */
export function serializeLog(log: PushLogRow) {
  return {
    id: log.id,
    kind: log.kind,
    target: log.target,
    courseId: log.courseId,
    courseName: log.courseName,
    chapterId: log.chapterId,
    chapterName: log.chapterName,
    examId: log.examId,
    title: log.title,
    body: log.body,
    recipients: log.recipients,
    devices: log.devices,
    sent: log.sent,
    failed: log.failed,
    userName: log.userName,
    createdAt: log.createdAt,
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

