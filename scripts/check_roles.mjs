import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

console.log('Inspecting roles in production database...\n');

try {
  const roles = await db.role.findMany({
    include: { users: { select: { id: true, username: true, name: true, active: true } } },
  });

  console.log(`Found ${roles.length} role(s):\n`);

  // Permissions that Q89 will start enforcing strictly.
  // If a role grants page.*.view but NOT the corresponding *.add/edit/delete,
  // that role will lose edit access after the fix.
  const VIEW_TO_MANAGE_MAP = {
    'page.courses.view': ['courses.add', 'courses.edit', 'courses.delete'],
    'page.chapters.view': ['chapters.add', 'chapters.edit', 'chapters.delete'],
    'page.exam-records.view': ['exams.edit', 'exams.delete'],
    'page.grade-records.view': ['grades.edit', 'grades.delete'],
    'page.opportunities.view': ['opportunities.manage'],
    'page.e-correction.view': ['correction.manage'],
  };

  let totalAffectedRoles = 0;
  let totalAffectedUsers = 0;

  for (const role of roles) {
    const perms = JSON.parse(role.permissions || '[]');
    console.log(`━━━ Role: ${role.name} (id=${role.id}) ━━━`);
    console.log(`  isDefault: ${role.isDefault}, Users: ${role.users.length}`);

    const affectedViews = [];
    for (const [viewPerm, managePerms] of Object.entries(VIEW_TO_MANAGE_MAP)) {
      if (perms.includes(viewPerm)) {
        const missingManage = managePerms.filter((p) => !perms.includes(p));
        if (missingManage.length > 0) {
          affectedViews.push({ viewPerm, missingManage });
        }
      }
    }

    if (affectedViews.length > 0) {
      console.log(`  ⚠️  AFFECTED BY Q89 FIX:`);
      for (const { viewPerm, missingManage } of affectedViews) {
        console.log(`     • Has ${viewPerm} but MISSING ${missingManage.join(', ')}`);
        console.log(`       → After fix, this role will NOT have those manage permissions.`);
      }
      totalAffectedRoles++;
      totalAffectedUsers += role.users.length;
    } else if (perms.length === 0) {
      console.log(`  (empty permissions — likely a placeholder role)`);
    } else {
      console.log(`  ✅ Not affected by Q89 fix (manage perms granted explicitly or no view perms).`);
    }

    // Show full permission list for inspection
    console.log(`  Permissions (${perms.length}):`);
    console.log(`    ${perms.join(', ')}`);
    
    if (role.users.length > 0) {
      console.log(`  Users in this role:`);
      for (const u of role.users) {
        console.log(`    - ${u.username} (${u.name}) — active: ${u.active}`);
      }
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════');
  console.log(`SUMMARY:`);
  console.log(`  Total roles: ${roles.length}`);
  console.log(`  Roles affected by Q89 fix: ${totalAffectedRoles}`);
  console.log(`  Users in affected roles: ${totalAffectedUsers}`);
  console.log('═══════════════════════════════════════════');

  // Also check users with direct permissions (not via role)
  const usersWithDirectPerms = await db.appUser.findMany({
    where: { 
      AND: [
        { permissions: { not: '' } },
        { permissions: { not: '[]' } },
      ]
    },
    select: { id: true, username: true, name: true, permissions: true, roleId: true },
  });
  
  if (usersWithDirectPerms.length > 0) {
    console.log(`\nℹ️  ${usersWithDirectPerms.length} user(s) have direct permissions (not via role):`);
    for (const u of usersWithDirectPerms) {
      const perms = JSON.parse(u.permissions || '[]');
      console.log(`  - ${u.username} (${u.name}): ${perms.length} direct perms, roleId=${u.roleId || 'none'}`);
    }
  }
} catch (err) {
  console.error('ERROR:', err);
  process.exit(1);
} finally {
  await db.$disconnect();
}
