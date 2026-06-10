import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

// Precomputed bcrypt hash of a random string. Used in verifyPassword to keep
// login response time constant when the user is missing — prevents email
// enumeration via timing attacks.
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8x4kqo5gZQwT3K8aFhTpY3WkfqzZKi';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function dummyVerifyPassword(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_HASH);
}
