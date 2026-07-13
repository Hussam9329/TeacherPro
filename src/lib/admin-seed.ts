import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/passwords';

const DEFAULT_ADMIN_ID = 'u_admin';
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_ROLE_ID = 'role_admin';
const DEFAULT_ADMIN_ROLE_NAME = 'مدير عام';

/**
 * List of known legacy default passwords that should be migrated to the
 * env-configured password on first launch. The actual values are read
 * from env vars (not hardcoded) so this file contains no password
 * strings at all.
 *
 * Format: TEACHERPRO_LEGACY_ADMIN_PASSWORDS="old1,old2,old3"
 * Operators set this once when upgrading, then remove it after the
 * migration runs.
 */
function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[name];
  return undefined;
}

function getLegacyAdminPasswords(): string[] {
  const raw = readEnv('TEACHERPRO_LEGACY_ADMIN_PASSWORDS')?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Get the default admin password from the TEACHERPRO_ADMIN_PASSWORD env var.
 * Throws in production if the env var is missing — operators must set it.
 * In development, falls back to a clearly-invalid placeholder so local
 * dev without env setup fails loudly instead of silently using a weak
 * hardcoded password.
 */
function getDefaultAdminPassword(): string {
  const fromEnv = readEnv('TEACHERPRO_ADMIN_PASSWORD')?.trim();
  if (fromEnv) return fromEnv;

  if (readEnv('NODE_ENV') === 'production') {
    throw new Error('TEACHERPRO_ADMIN_PASSWORD مطلوب في بيئة الإنتاج لكلمة مرور مدير النظام الافتراضية.');
  }

  // Development: return a placeholder so the developer sees a clear
  // error on first login attempt rather than a silent weak password.
  throw new Error(
    'TEACHERPRO_ADMIN_PASSWORD مطلوب. ضعه في ملف .env محلياً أو في Vercel env vars.',
  );
}

const ADMIN_FULL_PERMISSIONS = [
  'system.dashboard', 'system.settings', 'backup.view', 'backup.restore',
  'courses.view', 'courses.add', 'courses.edit', 'courses.delete',
  'chapters.view', 'chapters.add', 'chapters.edit', 'chapters.delete',
  'students.view', 'students.add', 'students.edit', 'students.delete',
  'exams.view', 'exams.add', 'exams.edit', 'exams.delete',
  'grades.view', 'grades.add', 'grades.edit', 'grades.delete',
  'opportunities.view', 'opportunities.manage',
  'follow-up.view', 'follow-up.manage',
  'correction.view', 'correction.manage',
  'accounts.view', 'accounts.manage',
  'logs.view',
];

function permissionsJson(): string {
  return JSON.stringify(ADMIN_FULL_PERMISSIONS);
}

/**
 * Ensure the default admin role + user exist.
 *
 * On a fresh database (no users): creates the admin user with the
 * password from TEACHERPRO_ADMIN_PASSWORD.
 *
 * On an existing database: checks if the admin still uses any of the
 * legacy passwords listed in TEACHERPRO_LEGACY_ADMIN_PASSWORDS, and
 * if so, migrates them to the env-configured password. Custom admin
 * passwords (set via the accounts UI) are never touched.
 *
 * This function reads NO hardcoded passwords. All passwords come from
 * environment variables.
 */
export async function ensureInitialAdminSeed(): Promise<void> {
  const userCount = await db.appUser.count();

  await db.role.upsert({
    where: { id: DEFAULT_ADMIN_ROLE_ID },
    create: {
      id: DEFAULT_ADMIN_ROLE_ID,
      name: DEFAULT_ADMIN_ROLE_NAME,
      isDefault: true,
      permissions: permissionsJson(),
    },
    update: {
      name: DEFAULT_ADMIN_ROLE_NAME,
      isDefault: true,
      permissions: permissionsJson(),
    },
  });

  await db.appUser.updateMany({
    where: { roleId: DEFAULT_ADMIN_ROLE_ID },
    data: { role: DEFAULT_ADMIN_ROLE_NAME },
  });

  const defaultAdminPassword = getDefaultAdminPassword();

  // Fresh database: create the admin user.
  if (userCount === 0) {
    await db.appUser.create({
      data: {
        id: DEFAULT_ADMIN_ID,
        username: DEFAULT_ADMIN_USERNAME,
        name: 'مدير النظام',
        passwordHash: await hashPassword(defaultAdminPassword),
        role: DEFAULT_ADMIN_ROLE_NAME,
        roleId: DEFAULT_ADMIN_ROLE_ID,
        permissions: permissionsJson(),
        active: true,
      },
    });
    return;
  }

  // Existing database: migrate legacy passwords if any.
  const legacyPasswords = getLegacyAdminPasswords();
  if (legacyPasswords.length === 0) return;

  const admin = await db.appUser.findFirst({
    where: { username: { equals: DEFAULT_ADMIN_USERNAME, mode: 'insensitive' } },
    select: { id: true, passwordHash: true },
  });
  if (!admin) return;

  // Check if the admin's current password matches any legacy password.
  // If so, replace it with the env-configured password.
  for (const legacyPassword of legacyPasswords) {
    const matches = await verifyPassword(legacyPassword, admin.passwordHash);
    if (matches) {
      await db.appUser.update({
        where: { id: admin.id },
        data: { passwordHash: await hashPassword(defaultAdminPassword) },
      });
      break; // Only need to migrate once.
    }
  }
}
