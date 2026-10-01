import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '@atx/application';

const scrypt = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, keylen, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;

/** scrypt password hashing (memory-hard, built into Node). Format: scrypt$N$r$p$salt$hash (base64url). */
export const scryptPasswordHasher: PasswordHasher = {
  async hash(password) {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, KEY_LENGTH, PARAMS);
    return [
      'scrypt',
      PARAMS.N,
      PARAMS.r,
      PARAMS.p,
      salt.toString('base64url'),
      key.toString('base64url'),
    ].join('$');
  },
  async verify(password, stored) {
    const [scheme, n, r, p, saltText, hashText] = stored.split('$');
    if (scheme !== 'scrypt' || !saltText || !hashText) return false;
    const expected = Buffer.from(hashText, 'base64url');
    const actual = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length || KEY_LENGTH, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  },
};
