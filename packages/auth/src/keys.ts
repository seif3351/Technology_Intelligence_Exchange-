import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type CryptoKey, type JWK, exportJWK, generateKeyPair, importJWK } from 'jose';

export const ACCESS_TOKEN_ALG = 'ES256';

export interface SigningKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
}

/**
 * Loads the access-token signing key from a private JWK (production: from the
 * platform secret store via env), or — in development only — creates/reuses a
 * key file so that the API, MCP server and web app agree on one key.
 */
export const loadSigningKey = async (options: {
  readonly privateJwkJson: string | null;
  readonly devKeyFile: string | null;
}): Promise<SigningKey> => {
  if (options.privateJwkJson) return fromPrivateJwk(JSON.parse(options.privateJwkJson) as JWK);
  if (!options.devKeyFile) throw new Error('No signing key configured (set AUTH_SIGNING_JWK)');
  try {
    return await fromPrivateJwk(JSON.parse(await readFile(options.devKeyFile, 'utf8')) as JWK);
  } catch {
    const { privateKey } = await generateKeyPair(ACCESS_TOKEN_ALG, { extractable: true });
    const jwk = {
      ...(await exportJWK(privateKey)),
      kid: `dev-${Date.now()}`,
      alg: ACCESS_TOKEN_ALG,
      use: 'sig',
    };
    await mkdir(path.dirname(options.devKeyFile), { recursive: true });
    await writeFile(options.devKeyFile, JSON.stringify(jwk), { mode: 0o600 });
    return fromPrivateJwk(jwk);
  }
};

const fromPrivateJwk = async (jwk: JWK): Promise<SigningKey> => {
  if (!jwk.d) throw new Error('Signing JWK must contain a private key');
  const privateKey = (await importJWK({ ...jwk, alg: ACCESS_TOKEN_ALG }, ACCESS_TOKEN_ALG)) as CryptoKey;
  const { d: _d, ...publicJwk } = jwk;
  return {
    kid: jwk.kid ?? 'default',
    privateKey,
    publicJwk: { ...publicJwk, alg: ACCESS_TOKEN_ALG, use: 'sig' },
  };
};
