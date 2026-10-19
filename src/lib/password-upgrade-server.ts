import { db } from '@/lib/db';
import { hashPassword, PASSWORD_HASH_PREFIX } from '@/lib/passwords';

let upgradeOnce: Promise<number> | null = null;

/**
 * Old accounts kept their login code as plain text. Hashing that stored text
 * gives a valid hash of the same code, so every one of them is converted
 * without anyone being locked out, and a plain-text code is never checked
 * again. Runs once per server instance, before the first login check.
 */
export function upgradePlaintextPasswords(): Promise<number> {
  if (!upgradeOnce) {
    upgradeOnce = (async () => {
      const legacy = await db.appUser.findMany({
        where: {
          passwordHash: { not: '' },
          NOT: { passwordHash: { startsWith: `${PASSWORD_HASH_PREFIX}$` } },
        },
        select: { id: true, passwordHash: true },
      });
      for (const user of legacy) {
        if (!user.passwordHash) continue;
        // Only if it is still the same plain text (a login may have just converted it).
        await db.appUser.updateMany({
          where: { id: user.id, passwordHash: user.passwordHash },
          data: { passwordHash: await hashPassword(user.passwordHash) },
        });
      }
      return legacy.length;
    })().catch((error) => {
      // Try again on the next login rather than never.
      upgradeOnce = null;
      console.warn('[passwords] plain-text upgrade failed:', error);
      return 0;
    });
  }
  return upgradeOnce;
}
