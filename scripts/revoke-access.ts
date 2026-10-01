/**
 * Operator incident response: immediately invalidates every web session, agent
 * token and connected app (OAuth grant) of an account, e.g. when it may be
 * compromised. The password is unchanged; the owner recovers via password reset.
 *   pnpm admin:revoke-access someone@example.com
 */
import { loadConfig } from '@atx/config';
import { createRuntime } from '@atx/runtime';

const [email] = process.argv.slice(2);
if (!email) throw new Error('usage: pnpm admin:revoke-access <email>');

const runtime = await createRuntime(loadConfig(), 'atx-admin-cli');
try {
  const { userId, revokedGrants } = await runtime.app.account.revokeAccessAsOperator(
    { principal: { kind: 'system', component: 'admin-cli' }, requestId: 'admin-cli' },
    email,
  );
  console.log(
    `revoked all sessions and tokens of ${userId} (${revokedGrants} agent tokens / connected apps)`,
  );
} catch (error) {
  // Messages only: stack traces add nothing for an operator.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await runtime.close();
}
