import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export function sha3(data: string): string {
  return crypto.createHash('sha3-256').update(data).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
