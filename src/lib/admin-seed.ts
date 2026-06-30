import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/passwords';

const DEFAULT_ADMIN_ID = 'u_admin';
const DEFAULT_ADMIN_USERNAME = 'admin';
const PREVIOUS_DEFAULT_ADMIN_PASSWORD = '1993';
const LEGACY_HARDCODED_ADMIN_PASSWORD = '204871';
const DEFAULT_ADMIN_ROLE_ID = 'role_admin';
const DEFAULT_ADMIN_ROLE_NAME = 'مدير عام';

function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[name];
  return undefined;
}

/**
 * Get the default admin password from the TEACHERPRO_ADMIN_PASSWORD env var.
 * Falls back to the legacy hardcoded value only in development to avoid
 * breaking local dev setups; in production we fail loudly if the env var
 * is missing so operators know to set it.
 */
function getDefaultAdminPassword(): string {
  const fromEnv = readEnv('TEACHERPRO_ADMIN_PASSWORD')?.trim();
  if (fromEnv) return fromEnv;

  if (readEnv('NODE_ENV') === 'production') {
    throw new Error('TEACHERPRO_ADMIN_PASSWORD مطلوب في بيئة الإنتاج لكلمة مرور مدير النظام الافتراضية.');
  }

  // Development fallback so local dev still works without env setup.
  return LEGACY_HARDCODED_ADMIN_PASSWORD;
}

const ADMIN_FULL_PERMISSIONS = [
  'system.dashboard', 'system.settings', 'backup.view',
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

  const defaultAdminPassword = getDefaultAdminPassword();

  // Seed the public default admin only on a fresh database. After that, the
  // password lives in the DB and is never read from env again (except for
  // the one-time migration below).
  if (userCount > 0) {
    const admin = await db.appUser.findFirst({
      where: { username: { equals: DEFAULT_ADMIN_USERNAME, mode: 'insensitive' } },
      select: { id: true, passwordHash: true },
    });

    // One-time safety migrations: if the built-in admin still uses a known
    // legacy public password, move it to the env-configured password.
    // Custom admin passwords are not touched.
    if (admin) {
      const matchesLegacy =
        (await verifyPassword(PREVIOUS_DEFAULT_ADMIN_PASSWORD, admin.passwordHash)) ||
        (await verifyPassword(LEGACY_HARDCODED_ADMIN_PASSWORD, admin.passwordHash));
      if (matchesLegacy) {
        await db.appUser.update({
          where: { id: admin.id },
          data: { passwordHash: await hashPassword(defaultAdminPassword) },
        });
      }
    }

    return;
  }

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
}
