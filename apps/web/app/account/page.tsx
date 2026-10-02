import type { Metadata } from 'next';
import { TableScroll } from '@/components/table-scroll';
import { OAuthConnection } from '@atx/contracts';
import { z } from 'zod';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { resendVerification, signOutEverywhere } from '@/lib/actions/account';
import { revokeConnection } from '@/lib/actions/oauth';
import { api, currentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Your account' };

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const me = await currentUser();
  if (!me) redirect('/login?next=/account');
  const { items: connections } = await api('/v1/oauth/connections', {
    schema: z.object({ items: z.array(OAuthConnection) }),
  });
  return (
    <div className="stack narrow">
      <h1>Your account</h1>
      <div className="card stack">
        <div>
          <strong>{me.user.displayName}</strong>
        </div>
        <div className="small">
          Email {me.user.emailVerified ? 'confirmed' : <strong>not confirmed yet</strong>}
        </div>
        {me.user.emailVerified ? null : (
          <ActionForm action={resendVerification} submitLabel="Send a new confirmation link">
            <p className="small muted">
              Confirm your email to create an organization or send requests to suppliers.
            </p>
          </ActionForm>
        )}
      </div>
      <div className="card stack">
        <h2>Organizations</h2>
        <ul>
          {me.memberships.map((m) => (
            <li key={m.organizationId}>
              {m.organizationName}{' '}
              <span className="small muted">
                ({m.organizationKind}, {m.role})
              </span>{' '}
              — <Link href={`/members?org=${m.organizationId}`}>members</Link>
            </li>
          ))}
        </ul>
        <Link href="/onboarding">Set up another organization</Link>
      </div>
      <div className="card stack">
        <h2>Connected AI applications</h2>
        {connections.length === 0 ? (
          <p className="small muted">
            None yet. AI hosts that support OAuth (for example Claude) connect by adding the ATX MCP server
            URL; see <Link href="/docs/mcp">AI agents (MCP)</Link>.
          </p>
        ) : (
          <TableScroll label="Connected AI applications">
            <table>
              <tbody>
                {connections.map((connection) => (
                  <tr key={connection.id}>
                    <td className="untrusted">{connection.clientName}</td>
                    <td className="small">{connection.scopes.join(' ')}</td>
                    <td className="small">
                      {connection.status}
                      {connection.lastUsedAt ? `, last used ${connection.lastUsedAt.slice(0, 10)}` : ''}
                    </td>
                    <td>
                      {connection.status === 'active' ? (
                        <form action={revokeConnection}>
                          <input type="hidden" name="grantId" value={connection.id} />
                          <button type="submit">Disconnect</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>
      <div className="card stack">
        <h2>Security</h2>
        <p className="small">
          Lost a device or shared an agent token by mistake? This ends every session, invalidates all agent
          tokens you created and disconnects every connected app.
        </p>
        <form action={signOutEverywhere}>
          <button type="submit">Sign out everywhere</button>
        </form>
      </div>
    </div>
  );
}
