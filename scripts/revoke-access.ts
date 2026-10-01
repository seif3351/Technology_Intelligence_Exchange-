/**
 * Operator incident response: immediately invalidates every web session, agent
 * token and connected app (OAuth grant) of an account, e.g. when it may be
 * compromised. The password is unchanged; the owner recovers via password reset.
 *   pnpm admin:revoke-access someone@example.com
 */
import { OPERATOR_CONTEXT, runOperatorCommand } from './lib/operator';

const [email] = process.argv.slice(2);
if (!email) throw new Error('usage: pnpm admin:revoke-access <email>');

await runOperatorCommand(async (runtime) => {
  const { userId, revokedGrants } = await runtime.app.account.revokeAccessAsOperator(OPERATOR_CONTEXT, email);
  console.log(
    `revoked all sessions and tokens of ${userId} (${revokedGrants} agent tokens / connected apps)`,
  );
});
