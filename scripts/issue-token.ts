/**
 * Development helper: issue an MCP access token for a user (e.g. to configure
 * an AI agent host that accepts bearer tokens).
 *   pnpm auth:token buyer@aurelia-motors.example "catalog:read requirements:read"
 */
import { loadConfig } from '@atx/config';
import { createRuntime } from '@atx/runtime';

const [email, scopeList = 'catalog:read'] = process.argv.slice(2);
if (!email) throw new Error('usage: pnpm auth:token <email> "<scopes>"');
const env = loadConfig();
if (env.NODE_ENV === 'production') throw new Error('auth:token is a development helper');
const runtime = await createRuntime(env, 'atx-token');
try {
  const credential = await runtime.app.deps.repos.users.findCredentialByEmail(email);
  if (!credential) throw new Error(`unknown user ${email}`);
  const token = await runtime.tokens.issuer.issue({
    subject: credential.user.id,
    audience: env.MCP_PUBLIC_URL,
    scopes: scopeList.split(/\s+/).filter(Boolean),
    clientId: 'dev-cli',
    ttlSeconds: 8 * 3600,
  });
  console.log(token);
} finally {
  await runtime.close();
}
