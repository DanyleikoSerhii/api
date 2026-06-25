import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { signToken } from './jwt.js';
import { env } from '../env.js';

export const SYSTEM_USER_EMAIL = 'system@movie-explorer.local';

// Not a valid bcrypt hash, so verifyPassword always returns false — the system
// account is reachable only via the JWT minted below, never by password login.
const UNUSABLE_PASSWORD_HASH = '!system-no-login';

type SystemUser = { id: number; email: string };

let cached: SystemUser | null = null;

export async function ensureSystemUser(): Promise<SystemUser> {
  if (cached) return cached;

  await db
    .insert(users)
    .values({ email: SYSTEM_USER_EMAIL, passwordHash: UNUSABLE_PASSWORD_HASH })
    .onConflictDoNothing();

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, SYSTEM_USER_EMAIL))
    .limit(1);

  if (!user) {
    throw new Error('Failed to ensure system user');
  }

  cached = user;
  return user;
}

export async function getSystemUserToken(): Promise<string> {
  const user = await ensureSystemUser();
  return signToken(user.id, user.email, env.JWT_SECRET);
}
