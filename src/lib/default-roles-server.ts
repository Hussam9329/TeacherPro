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
  // «موظف مكالمات» first shipped without the read-only registry. Add it to a
  // role still holding exactly that first set; an edited role is left alone.
  const caller = DEFAULT_ROLE_DEFINITIONS.find((role) => role.id === 'role_caller');
  if (caller) {
    const existing = await db.role.findUnique({ where: { id: caller.id }, select: { permissions: true } });
    const first = ['system.dashboard', 'follow-up.calls.view', 'follow-up.calls.manage'];
    let current: unknown = [];
    try { current = JSON.parse(existing?.permissions || '[]'); } catch { current = []; }
    const held = Array.isArray(current) ? current.map(String).sort() : [];
    if (existing && held.join('|') === [...first].sort().join('|')) {
      await db.role.update({ where: { id: caller.id }, data: { permissions: JSON.stringify(caller.permissions) } });
    }
  }
  ensured = true;
}
