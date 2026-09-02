export const LEAVE_END_CONFIRMATION_REQUIRED_CODE =
  "LEAVE_END_CONFIRMATION_REQUIRED" as const;

export const LEAVE_END_CONFIRMATION_MESSAGE =
  "هذا الطالب لديه إجازة فعالة لهذا الامتحان. اعتماد الدرجة سينهي الإجازة التي تغطي الامتحان، وإذا كانت إجازة فترة فستنتهي الفترة كاملة وتُسترجع بيانات بقية امتحاناتها، ثم يُعاد احتساب الطالب.";

type LeaveEndConfirmationInput = {
  hasBlockingLeave: boolean;
  status: string;
  score: number | null | undefined;
  confirmLeaveEnd?: boolean;
};

/**
 * Fail closed: every real numeric grade needs an explicit confirmation when
 * it would end a covering leave. Automated writers do not get an implicit
 * bypass; they must stop safely and leave the leave/grades unchanged.
 */
export function requiresLeaveEndConfirmation(
  input: LeaveEndConfirmationInput,
): boolean {
  return Boolean(
    input.hasBlockingLeave &&
      input.status === "درجة" &&
      typeof input.score === "number" &&
      Number.isFinite(input.score) &&
      input.confirmLeaveEnd !== true,
  );
}
