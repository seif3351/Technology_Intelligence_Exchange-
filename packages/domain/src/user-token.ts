import type { UserId, UserTokenId } from './ids';

/** Single-use secrets mailed to a user. Only the SHA-256 hash of the token is stored. */
export const USER_TOKEN_PURPOSES = ['email_verification', 'password_reset'] as const;
export type UserTokenPurpose = (typeof USER_TOKEN_PURPOSES)[number];

export const USER_TOKEN_TTL_MINUTES: Readonly<Record<UserTokenPurpose, number>> = {
  email_verification: 3 * 24 * 60,
  password_reset: 60,
};

export interface UserToken {
  readonly id: UserTokenId;
  readonly userId: UserId;
  readonly purpose: UserTokenPurpose;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly createdAt: Date;
}

export const isUserTokenUsable = (token: UserToken, purpose: UserTokenPurpose, now: Date): boolean =>
  token.purpose === purpose && token.usedAt === null && token.expiresAt.getTime() > now.getTime();
