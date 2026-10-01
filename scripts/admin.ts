/**
 * Operator command: create (or promote) a platform administrator. Works in
 * production, where no demo users exist. The password is read from
 * ATX_ADMIN_PASSWORD or stdin — never from argv, which other users can see.
 *   pnpm admin:create admin@example.com "Platform Admin"
 *   printf '%s' "$PASSWORD" | pnpm admin:create admin@example.com "Platform Admin"
 */
import { loadConfig } from '@atx/config';
import { createRuntime } from '@atx/runtime';

const readStdin = async (): Promise<string | null> => {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const value = Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
  return value.length > 0 ? value : null;
};

const [email, displayName = 'Platform Administrator'] = process.argv.slice(2);
if (!email)
  throw new Error(
    'usage: pnpm admin:create <email> ["Display Name"]  (password via ATX_ADMIN_PASSWORD or stdin)',
  );
const password = process.env['ATX_ADMIN_PASSWORD'] ?? (await readStdin());

const runtime = await createRuntime(loadConfig(), 'atx-admin-cli');
try {
  const { user, created } = await runtime.app.identity.bootstrapPlatformAdmin(
    { principal: { kind: 'system', component: 'admin-cli' }, requestId: 'admin-cli' },
    { email, displayName, password },
  );
  console.log(`${created ? 'created' : 'promoted'} platform administrator ${user.email} (${user.id})`);
} catch (error) {
  // Messages only: stack traces add nothing for an operator.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await runtime.close();
}
