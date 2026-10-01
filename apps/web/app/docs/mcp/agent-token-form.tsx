'use client';

import { useActionState } from 'react';
import { type AgentTokenState, issueAgentToken } from '@/lib/actions/agents';
import { SCOPE_DESCRIPTIONS } from '@/lib/scopes';

export function AgentTokenForm() {
  const [state, action, pending] = useActionState<AgentTokenState, FormData>(issueAgentToken, {});
  return (
    <form action={action} className="card stack">
      <h3>Generate an agent token</h3>
      <div className="row">
        <div>
          <label htmlFor="token-label">Name (where you will use it)</label>
          <input id="token-label" name="label" maxLength={80} placeholder="e.g. Claude Code on my laptop" />
        </div>
        <div>
          <label htmlFor="token-days">Valid for</label>
          <select id="token-days" name="expiresInDays" defaultValue="30">
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
      </div>
      {SCOPE_DESCRIPTIONS.map((scope) => (
        <label key={scope.id} className="row plain">
          <input
            type="checkbox"
            name="scope"
            value={scope.id}
            defaultChecked={scope.id === 'catalog:read'}
            className="inline-check"
          />{' '}
          {scope.label} <code className="small">{scope.id}</code>
        </label>
      ))}
      <button type="submit" className="primary" disabled={pending}>
        Generate token
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.token ? (
        <div className="stack">
          <p className="notice">Copy this token now; it is not shown again. Treat it like a password.</p>
          <textarea readOnly value={state.token} aria-label="Agent token" />
          <div className="small muted">
            Scopes: {state.scopes?.join(' ')} · valid until {state.expiresAt?.slice(0, 10)} · revoke it below
            at any time
          </div>
        </div>
      ) : null}
    </form>
  );
}
