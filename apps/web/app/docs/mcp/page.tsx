import type { Metadata } from 'next';
import { TableScroll } from '@/components/table-scroll';
import { AgentTokenRecord } from '@atx/contracts';
import { z } from 'zod';
import { revokeAgentToken } from '@/lib/actions/agents';
import { api, currentUser } from '@/lib/api';
import { webConfig } from '@/lib/config';
import { AgentTokenForm } from './agent-token-form';

export const metadata: Metadata = { title: 'AI agents (MCP)' };

export const dynamic = 'force-dynamic';

export default async function McpDocsPage() {
  const me = await currentUser();
  const tokens = me
    ? (await api('/v1/auth/agent-tokens', { schema: z.object({ items: z.array(AgentTokenRecord) }) })).items
    : [];
  return (
    <div className="stack narrow">
      <h1>Use Automotive Technology Exchange from your AI agent</h1>
      <p>
        The platform exposes a remote MCP server (protocol revision 2026-07-28). Your agent can search
        technologies, match requirements against evidence, compare candidates and open rich views (MCP Apps)
        where the host supports them.
      </p>
      <div className="panel">
        <div>
          <strong>Server URL:</strong> <code>{webConfig.mcpUrl}</code>
        </div>
        <div className="small muted">
          Public catalog tools work without authentication. Hosts that support MCP OAuth (e.g. Claude custom
          connectors) only need this URL: you sign in and approve the requested permissions on this site.
        </div>
      </div>
      <h2>Skill</h2>
      <p>
        The server publishes the <code>automotive-technology-exchange</code> skill via the MCP Skills
        extension (<code>skills/list</code>). It teaches agents how to separate hard constraints from
        preferences, interpret evidence and handle approvals.
      </p>
      <h2>Authorization</h2>
      <p>
        <strong>OAuth (recommended):</strong> hosts discover the authorization server from{' '}
        <code>/.well-known/oauth-protected-resource</code>, register themselves and send you to a consent page
        here. Connected applications are listed (and can be disconnected) on your{' '}
        <a href="/account">account page</a>. <strong>Agent tokens:</strong> for hosts that only accept a
        static bearer header, generate a scoped, revocable token below (valid up to 90 days).
      </p>
      {me ? <AgentTokenForm /> : <p className="notice">Sign in to generate an agent token.</p>}
      {tokens.length > 0 ? (
        <>
          <h3>Your agent tokens</h3>
          <TableScroll label="Your agent tokens">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scopes</th>
                  <th>Status</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td>{token.label}</td>
                    <td className="small">{token.scopes.join(' ')}</td>
                    <td className="small">
                      {token.status === 'active'
                        ? `active until ${token.expiresAt.slice(0, 10)}`
                        : token.status}
                    </td>
                    <td className="small">
                      {token.lastUsedAt ? token.lastUsedAt.slice(0, 16).replace('T', ' ') : 'never'}
                    </td>
                    <td>
                      {token.status === 'active' ? (
                        <form action={revokeAgentToken}>
                          <input type="hidden" name="grantId" value={token.id} />
                          <button type="submit">Revoke</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      ) : null}
      <h2>Safety model</h2>
      <ul>
        <li>
          Supplier-provided fields are marked untrusted; agents must treat them as data, never instructions.
        </li>
        <li>Engagement requests require a preview and explicit human approval before anything is sent.</li>
        <li>Confidential terms you pass are removed before any processing and never shown to suppliers.</li>
      </ul>
    </div>
  );
}
