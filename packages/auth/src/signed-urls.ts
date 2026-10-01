import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AssetUrlSigner } from '@atx/application';

/** HMAC-signed, expiring asset download URLs served by the API. */
export const createAssetUrlSigner = (secret: string, apiBaseUrl: string) => {
  if (secret.length < 32) throw new Error('ASSET_URL_SECRET must be at least 32 characters');
  const sign = (assetId: string, expires: number) =>
    createHmac('sha256', secret).update(`${assetId}.${expires}`).digest('base64url');
  const signer: AssetUrlSigner & { verify(assetId: string, expires: string, signature: string, now?: number): boolean } = {
    signedUrl(assetId, ttlSeconds) {
      const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
      const url = new URL(`/v1/assets/${assetId}/content`, apiBaseUrl);
      url.searchParams.set('expires', String(expires));
      url.searchParams.set('signature', sign(assetId, expires));
      return url.toString();
    },
    verify(assetId, expires, signature, now = Date.now()) {
      const expiresAt = Number(expires);
      if (!Number.isInteger(expiresAt) || expiresAt * 1000 < now) return false;
      const expected = Buffer.from(sign(assetId, expiresAt));
      const actual = Buffer.from(signature);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },
  };
  return signer;
};

export type AssetUrlSignerWithVerify = ReturnType<typeof createAssetUrlSigner>;
