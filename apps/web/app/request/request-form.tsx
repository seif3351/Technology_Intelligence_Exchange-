'use client';

import { useActionState } from 'react';
import { type RequestState, confirmRequest, prepareRequest } from '@/lib/actions/buyer';

interface Props {
  readonly offeringId: string;
  readonly buyerOrganizationId: string;
  readonly defaultName: string;
  readonly requirements: readonly { id: string; title: string }[];
}

export function RequestForm({ offeringId, buyerOrganizationId, defaultName, requirements }: Props) {
  const [prepared, prepare, preparing] = useActionState<RequestState, FormData>(prepareRequest, {});
  const [confirmed, confirm, confirming] = useActionState<RequestState, FormData>(confirmRequest, {});

  if (confirmed.submitted) return <p className="success">{confirmed.message}</p>;

  if (prepared.preview) {
    const shared = prepared.preview.preview.willBeShared;
    return (
      <form action={confirm} className="stack" data-testid="request-preview">
        {Object.entries(prepared.draft ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="confirmationToken" value={prepared.preview.confirmationToken} />
        <input type="hidden" name="idempotencyKey" value={prepared.idempotencyKey ?? ''} />
        <div className="notice">Not sent yet. Review exactly what the supplier will receive.</div>
        <div className="panel stack">
          <h3>Will be shared with {prepared.preview.preview.recipient.supplierName}</h3>
          <div>Organization: {shared.buyerOrganizationName}</div>
          <div>
            Contact: {shared.contactName} &lt;{shared.contactEmail}&gt;
          </div>
          <div>Message: {shared.message}</div>
          {shared.disclosedSummary ? <div>Summary: {shared.disclosedSummary}</div> : null}
          <div>
            Technical constraints: {shared.constraints.map((c) => c.description).join('; ') || 'none'}
          </div>
        </div>
        <div className="panel">
          <h3>Will NOT be shared</h3>
          <ul>
            {prepared.preview.preview.willNotBeShared.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <label className="row plain">
          <input type="checkbox" name="approve" value="yes" required className="inline-check" /> I approve
          sending exactly this information to the supplier.
        </label>
        {confirmed.error ? <p className="error">{confirmed.error}</p> : null}
        <button type="submit" className="primary" disabled={confirming}>
          {confirming ? 'Sending…' : 'Send request'}
        </button>
      </form>
    );
  }

  return (
    <form action={prepare} className="stack">
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="buyerOrganizationId" value={buyerOrganizationId} />
      <div>
        <label htmlFor="type">Request type</label>
        <select id="type" name="type" defaultValue="demo">
          <option value="demo">Technical demo</option>
          <option value="workshop">Technical workshop</option>
          <option value="poc">Proof of concept</option>
          <option value="rfi">Request for information (RFI)</option>
        </select>
      </div>
      <div>
        <label htmlFor="message">Message to the supplier</label>
        <textarea
          id="message"
          name="message"
          required
          minLength={10}
          defaultValue={prepared.draft?.['message']}
        />
        <p className="small muted">
          Do not include project names, programs or customers. Confidential terms of a linked requirement are
          blocked automatically.
        </p>
      </div>
      <div className="row">
        <div className="grow">
          <label htmlFor="contactName">Contact name</label>
          <input id="contactName" name="contactName" defaultValue={defaultName} required />
        </div>
        <div className="grow">
          <label htmlFor="contactEmail">Contact email</label>
          <input id="contactEmail" name="contactEmail" type="email" required />
        </div>
      </div>
      {requirements.length > 0 ? (
        <div>
          <label htmlFor="requirementId">Share technical constraints of a requirement (optional)</label>
          <select id="requirementId" name="requirementId" defaultValue="">
            <option value="">Do not share a requirement</option>
            {requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          <p className="small muted">
            Only structured constraints are shared — never the title, description or confidential terms.
          </p>
        </div>
      ) : null}
      {prepared.error ? <p className="error">{prepared.error}</p> : null}
      <button type="submit" className="primary" disabled={preparing}>
        {preparing ? 'Preparing…' : 'Review before sending'}
      </button>
    </form>
  );
}
