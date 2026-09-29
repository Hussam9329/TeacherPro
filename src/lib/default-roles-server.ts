import { db } from '@/lib/db';
import { ADMIN_ROLE_ID, DEFAULT_ROLE_DEFINITIONS } from '@/lib/permission-catalog';

/**
 * The accounts screen offers the default roles (مشرف، مسؤول تسجيل، مصحح،
 * مشاهدة فقط). They must exist in the database, or choosing one when adding
 * a user fails with «الدور غير موجود». Missing ones are created; roles that
 * already exist keep whatever the admin edited.
 */
let ensured = false;

export async function ensureDefaultRoles(): Promise<void> {
  if (ensured) return;
  await db.role.createMany({
    data: DEFAULT_ROLE_DEFINITIONS.filter((role) => role.id !== ADMIN_ROLE_ID).map((role) => ({
      id: role.id,
      name: role.name,
      isDefault: true,
      permissions: JSON.stringify(role.permissions),
    })),
    skipDuplicates: true,
  });
  ensured = true;
}
