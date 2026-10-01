'use client';

import { useActionState } from 'react';
import { type AgentTokenState, issueAgentToken } from '@/lib/actions/agents';

const SCOPES = [
  { id: 'catalog:read', label: 'Read the public catalog' },
  { id: 'requirements:read', label: "Read your organization's private requirements" },
  { id: 'requirements:write', label: 'Save private requirement drafts' },
  { id: 'engagements:write', label: 'Prepare demo/RFI requests (each still needs your approval)' },
];

export function AgentTokenForm() {
  const [state, action, pending] = useActionState<AgentTokenState, FormData>(issueAgentToken, {});
  return (
    <form action={action} className="card stack">
      <h3>Generate an agent token</h3>
      {SCOPES.map((scope) => (
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
      <button type="submit" disabled={pending}>
        Generate (valid 8 hours)
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.token ? (
        <div className="stack">
          <p className="notice">Copy this token now; it is not shown again. Treat it like a password.</p>
          <textarea readOnly value={state.token} aria-label="Agent token" />
          <div className="small muted">Scopes: {state.scopes?.join(' ')}</div>
        </div>
      ) : null}
    </form>
  );
}
