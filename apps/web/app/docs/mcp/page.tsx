import { AgentTokenRecord } from '@atx/contracts';
import { z } from 'zod';
import { revokeAgentToken } from '@/lib/actions/agents';
import { api, currentUser } from '@/lib/api';
import { webConfig } from '@/lib/config';
import { AgentTokenForm } from './agent-token-form';

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
          Public catalog tools work without authentication. Private requirements and requests require an
          access token.
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
        The MCP server is an OAuth 2.1 resource server. Hosts that support MCP authorization discover the
        authorization server from <code>/.well-known/oauth-protected-resource</code>. For hosts that accept a
        bearer token, generate a scoped, revocable token below (valid up to 90 days).
      </p>
      {me ? <AgentTokenForm /> : <p className="notice">Sign in to generate an agent token.</p>}
      {tokens.length > 0 ? (
        <>
          <h3>Your agent tokens</h3>
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
