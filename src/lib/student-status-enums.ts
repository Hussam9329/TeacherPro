// ============================================================================
// Student Status Enums — Q78 SECURITY FIX
// ----------------------------------------------------------------------------
// Previously, status and dismissalType were free-text String fields with no
// validation. An admin (or attacker via bulk-adjust) could store arbitrary
// values like "موقوف" or "فصل تجريبي" — these would be saved to the DB,
// break filtering, and produce inconsistent reports.
//
// This module enforces an application-level enum. We don't use Postgres
// enums (would require a migration) — instead we validate at every entry
// point and reject unknown values with a clear error.
//
// VALID status values:
//   - "نشط"     (active)
//   - "مفصول"   (dismissed)
//   - "مؤرشف"   (archived)
//
// VALID dismissalType values (only meaningful when status === "مفصول"):
//   - "فصل مؤقت"  (temporary dismissal)
//   - "فصل نهائي" (final dismissal)
// ============================================================================

export const STUDENT_STATUS_VALUES = ['نشط', 'مفصول', 'مؤرشف'] as const;
export const DISMISSAL_TYPE_VALUES = ['فصل مؤقت', 'فصل نهائي'] as const;

export type StudentStatus = (typeof STUDENT_STATUS_VALUES)[number];
export type DismissalType = (typeof DISMISSAL_TYPE_VALUES)[number];

export const STUDENT_STATUS_ACTIVE: StudentStatus = 'نشط';
export const STUDENT_STATUS_DISMISSED: StudentStatus = 'مفصول';
export const STUDENT_STATUS_ARCHIVED: StudentStatus = 'مؤرشف';

/**
 * Validate a status value. Returns the validated status or throws with an
 * Arabic error message if invalid.
 */
export function validateStudentStatus(value: unknown): StudentStatus {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!STUDENT_STATUS_VALUES.includes(v as StudentStatus)) {
    throw new Error(
      `قيمة الحالة "${v}" غير صالحة. القيم المسموح بها: ${STUDENT_STATUS_VALUES.join('، ')}.`,
    );
  }
  return v as StudentStatus;
}

/**
 * Validate a dismissalType value. Returns the validated value or throws.
 * Pass undefined/null to clear the dismissal type (allowed).
 */
export function validateDismissalType(value: unknown): DismissalType | null {
  if (value === null || value === undefined || value === '') return null;
  const v = typeof value === 'string' ? value.trim() : '';
  if (!DISMISSAL_TYPE_VALUES.includes(v as DismissalType)) {
    throw new Error(
      `قيمة نوع الفصل "${v}" غير صالحة. القيم المسموح بها: ${DISMISSAL_TYPE_VALUES.join('، ')}، أو فارغ.`,
    );
  }
  return v as DismissalType;
}

/**
 * Check if a status value is valid without throwing.
 */
export function isValidStudentStatus(value: unknown): boolean {
  return typeof value === 'string' && (STUDENT_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * Check if a dismissalType value is valid without throwing.
 */
export function isValidDismissalType(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  return typeof value === 'string' && (DISMISSAL_TYPE_VALUES as readonly string[]).includes(value);
}
