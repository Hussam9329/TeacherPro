"use client";

import type { ReactNode } from "react";
import {
  toast as sonnerToast,
  type ExternalToast,
} from "sonner";
import {
  emitTeacherProActionStatus,
  humanizeTeacherProText,
  teacherProErrorToastCopy,
  teacherProSuccessToastCopy,
} from "@/lib/teacherpro-language";

type ToastMessage = Parameters<typeof sonnerToast>[0];
type ToastMethodMessage = Parameters<typeof sonnerToast.success>[0];
type ToastDescription = ExternalToast["description"];

function normalizeReactNode(value: ReactNode): ReactNode {
  return typeof value === "string" ? humanizeTeacherProText(value) : value;
}

function normalizeMessage(value: ToastMessage | ToastMethodMessage): ToastMessage {
  if (typeof value === "string") return humanizeTeacherProText(value);
  if (typeof value === "function") {
    return () => normalizeReactNode(value());
  }
  return value;
}

function normalizeDescription(value: ToastDescription): ToastDescription {
  if (typeof value === "string") return humanizeTeacherProText(value);
  if (typeof value === "function") {
    return () => normalizeReactNode(value());
  }
  return value;
}

function normalizeOptions(options?: ExternalToast): ExternalToast | undefined {
  if (!options) return options;
  return {
    ...options,
    description: normalizeDescription(options.description),
  };
}

const baseToast = ((message: ToastMessage, options?: ExternalToast) =>
  sonnerToast(normalizeMessage(message), normalizeOptions(options))) as typeof sonnerToast;

const toast = Object.assign(baseToast, {
  success: ((message: ToastMethodMessage, options?: ExternalToast) => {
    if (typeof message !== "string") {
      return sonnerToast.success(normalizeMessage(message), normalizeOptions(options));
    }
    const copy = teacherProSuccessToastCopy(message);
    if (copy.actionStatus) emitTeacherProActionStatus(copy.actionStatus);
    return sonnerToast.success(copy.title, {
      ...normalizeOptions(options),
      description: normalizeDescription(options?.description ?? copy.description),
    });
  }) as typeof sonnerToast.success,
  error: ((message: ToastMethodMessage, options?: ExternalToast) => {
    if (typeof message !== "string") {
      return sonnerToast.error(normalizeMessage(message), normalizeOptions(options));
    }
    const copy = teacherProErrorToastCopy(message);
    if (copy.actionStatus) emitTeacherProActionStatus(copy.actionStatus);
    return sonnerToast.error(copy.title, {
      ...normalizeOptions(options),
      description: normalizeDescription(options?.description ?? copy.description),
    });
  }) as typeof sonnerToast.error,
  info: ((message: ToastMethodMessage, options?: ExternalToast) =>
    sonnerToast.info(normalizeMessage(message), normalizeOptions(options))) as typeof sonnerToast.info,
  warning: ((message: ToastMethodMessage, options?: ExternalToast) =>
    sonnerToast.warning(normalizeMessage(message), normalizeOptions(options))) as typeof sonnerToast.warning,
  loading: ((message: ToastMethodMessage, options?: ExternalToast) =>
    sonnerToast.loading(normalizeMessage(message), normalizeOptions(options))) as typeof sonnerToast.loading,
  message: ((message: ToastMethodMessage, options?: ExternalToast) =>
    sonnerToast.message(normalizeMessage(message), normalizeOptions(options))) as typeof sonnerToast.message,
  custom: sonnerToast.custom,
  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,
  getHistory: sonnerToast.getHistory,
  getToasts: sonnerToast.getToasts,
}) as typeof sonnerToast;

export { toast };
