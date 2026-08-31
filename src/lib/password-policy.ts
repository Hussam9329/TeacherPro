// ============================================================================
// Password Policy — Q98 SECURITY FIX
// ----------------------------------------------------------------------------
// Previously, the system accepted ANY password including "1", "123", "admin".
// The scrypt hash was strong but a weak password is still cracked in seconds
// via rainbow tables / dictionary attacks.
//
// This module enforces a baseline password strength policy:
//   - Minimum 8 characters
//   - Maximum 128 characters (prevent DoS via huge inputs)
//   - At least one letter (Arabic or Latin)
//   - At least one digit
//   - Not in a small blocklist of trivially weak passwords
//
// The policy is enforced on:
//   - User creation (POST /api/users)
//   - User update with new password (PUT /api/users)
//   - Login (POST /api/auth/login) — only when the password matches, we still
//     accept it (so users can log in to reset). But we expose a `passwordWeak`
//     flag in the session so the UI can prompt for a password change.
//
// This is NOT a substitute for hashing — it complements scrypt.
// ============================================================================

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// A small blocklist of the most common weak passwords. We don't need a huge
// list — the length + complexity check catches most. This catches the
// "admin", "password", "12345678" style passwords that would pass length
// but are still in every cracking dictionary.
const WEAK_PASSWORD_BLOCKLIST = new Set([
  'password', 'password1', 'password123',
  '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyui',
  'admin', 'admin123', 'administrator',
  'letmein', 'welcome', 'welcome1',
  'iloveyou', 'monkey', 'dragon',
  '11111111', '00000000', 'aaaaaaaa',
  'abc12345', 'abcd1234',
  // Arabic-aware: common weak Arabic passwords (transliterated)
  'teacher', 'teacherpro', 'teacher123',
]);

// Letters: Latin a-z, A-Z, Arabic \u0600-\u06FF
const HAS_LETTER = /[a-zA-Z\u0600-\u06FF]/;
const HAS_DIGIT = /[0-9]/;

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; reason: string; code: string };

/**
 * Validate a plaintext password against the password policy.
 * Returns { ok: true } if the password passes, or { ok: false, reason, code }
 * with an Arabic error message and a stable code for the UI.
 *
 * IMPORTANT: This function does NOT check the hash. The caller should pass
 * the plaintext password only — never the stored hash. If the caller receives
 * a value that looks like a hash (starts with "scrypt$1$"), it skips policy
 * validation (because the hash was already accepted at creation time).
 */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  // Allow password hashes to pass through — they were validated when set.
  // This handles the legacy case where body.passwordHash is sent instead
  // of body.password (we don't want to re-validate a hash as if it were
  // a plaintext password).
  if (password.startsWith('scrypt$1$')) {
    return { ok: true };
  }

  if (typeof password !== 'string' || password.length === 0) {
    return {
      ok: false,
      reason: 'كلمة المرور مطلوبة.',
      code: 'PASSWORD_EMPTY',
    };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: `كلمة المرور قصيرة جداً. الحد الأدنى ${PASSWORD_MIN_LENGTH} أحرف.`,
      code: 'PASSWORD_TOO_SHORT',
    };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      reason: `كلمة المرور طويلة جداً. الحد الأقصى ${PASSWORD_MAX_LENGTH} حرف.`,
      code: 'PASSWORD_TOO_LONG',
    };
  }

  if (!HAS_LETTER.test(password)) {
    return {
      ok: false,
      reason: 'كلمة المرور يجب أن تحتوي على حرف واحد على الأقل (حرف латини или عربي).',
      code: 'PASSWORD_NO_LETTER',
    };
  }

  if (!HAS_DIGIT.test(password)) {
    return {
      ok: false,
      reason: 'كلمة المرور يجب أن تحتوي على رقم واحد على الأقل.',
      code: 'PASSWORD_NO_DIGIT',
    };
  }

  if (WEAK_PASSWORD_BLOCKLIST.has(password.toLowerCase())) {
    return {
      ok: false,
      reason: 'كلمة المرور هذه شائعة جداً ومُخترقة مسبقاً في قواميس كسر كلمات المرور. اختر كلمة مرور أخرى.',
      code: 'PASSWORD_BLOCKLISTED',
    };
  }

  return { ok: true };
}

/**
 * Returns true if the password meets the policy. Convenience wrapper for
 * code that only needs a boolean (e.g. login flow).
 */
export function isPasswordAcceptable(password: string): boolean {
  return validatePasswordPolicy(password).ok;
}

/**
 * Estimate password strength as a 0-4 score (for UI feedback).
 * 0 = very weak, 4 = strong. This is informational only — enforcement
 * uses validatePasswordPolicy above.
 */
export function scorePasswordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (HAS_DIGIT.test(password) && HAS_LETTER.test(password)) score += 1;
  if (/[^a-zA-Z0-9\u0600-\u06FF]/.test(password)) score += 1; // symbols
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
