import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/passwords';

const DEFAULT_ADMIN_ID = 'u_admin';
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = '204871';
const PREVIOUS_DEFAULT_ADMIN_PASSWORD = '1993';
const DEFAULT_ADMIN_ROLE_ID = 'role_admin';
const DEFAULT_ADMIN_ROLE_NAME = 'مدير عام';

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

  // Seed the public default admin only on a fresh database. After that, the
  // password lives in the DB and is never hard-coded as a login fallback.
  if (userCount > 0) {
    const admin = await db.appUser.findFirst({
      where: { username: { equals: DEFAULT_ADMIN_USERNAME, mode: 'insensitive' } },
      select: { id: true, passwordHash: true },
    });

    // One-time safety migration: if the built-in admin still uses the old
    // public default password, move it to the new admin code. Custom admin
    // passwords are not touched.
    if (admin && await verifyPassword(PREVIOUS_DEFAULT_ADMIN_PASSWORD, admin.passwordHash)) {
      await db.appUser.update({
        where: { id: admin.id },
        data: { passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD) },
      });
    }

    return;
  }

  await db.appUser.create({
    data: {
      id: DEFAULT_ADMIN_ID,
      username: DEFAULT_ADMIN_USERNAME,
      name: 'مدير النظام',
      passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD),
      role: DEFAULT_ADMIN_ROLE_NAME,
      roleId: DEFAULT_ADMIN_ROLE_ID,
      permissions: permissionsJson(),
      active: true,
    },
  });
}
