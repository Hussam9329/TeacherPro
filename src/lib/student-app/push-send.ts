/**
 * Routes one message to every device by platform: iOS through APNs, Android
 * through FCM. Devices whose platform has no configured sender count as
 * failed; tokens the platform declared dead come back for clearing.
 */
import type { PushMessage, PushSender } from "./push-types.ts";

export type PushDevice = { id: string; platform: string; pushToken: string };

export type PushSenders = { apns: PushSender | null; fcm: PushSender | null };

export type SendOutcome = { sent: number; failed: number; unregisteredDeviceIds: string[] };

function senderFor(platform: string, senders: PushSenders): PushSender | null {
  const key = platform.trim().toLowerCase();
  if (key === "ios") return senders.apns;
  if (key === "android") return senders.fcm;
  return null;
}

export async function sendToDevices(devices: PushDevice[], message: PushMessage, senders: PushSenders): Promise<SendOutcome> {
  const outcome: SendOutcome = { sent: 0, failed: 0, unregisteredDeviceIds: [] };
  const groups = new Map<PushSender, PushDevice[]>();
  for (const device of devices) {
    const sender = senderFor(device.platform, senders);
    if (!sender) { outcome.failed += 1; continue; }
    const list = groups.get(sender) ?? [];
    list.push(device);
    groups.set(sender, list);
  }
  for (const [sender, list] of groups) {
    const results = await sender.send(list.map((d) => d.pushToken), message);
    results.forEach((result, index) => {
      if (result.ok) outcome.sent += 1;
      else outcome.failed += 1;
      if (result.unregistered) outcome.unregisteredDeviceIds.push(list[index].id);
    });
  }
  return outcome;
}
