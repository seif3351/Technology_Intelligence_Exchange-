/**
 * Prints a new ES256 private JWK for AUTH_SIGNING_JWK. Store it in your secret
 * manager; never commit it. Rotate by deploying a new key (tokens are short-lived).
 */
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';

const { privateKey } = await generateKeyPair('ES256', { extractable: true });
console.log(
  JSON.stringify({ ...(await exportJWK(privateKey)), kid: `atx-${randomUUID()}`, alg: 'ES256', use: 'sig' }),
);
