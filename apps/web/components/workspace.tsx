import type { ClaimView, EvidenceView } from '@atx/contracts';
import { CLAIM_PREDICATE_OPTIONS, CLAIM_STATUS_LABEL, EVIDENCE_KIND_LABEL } from '@atx/ui';
import type { z } from 'zod';
import { addEvidence, claimAction, reviseClaim } from '@/lib/actions/workspace';
import { ActionForm } from './action-form';
import { TrustBadge } from './badges';
import { ConceptSelect } from './concept-select';

type ClaimT = z.infer<typeof ClaimView>;
type EvidenceT = z.infer<typeof EvidenceView>;

const LEVELS: readonly { key: string; label: string; values: readonly [string, string][] }[] = [
  {
    key: 'asil',
    label: 'ASIL',
    values: ['QM', 'A', 'B', 'C', 'D'].map((v) => [v, v === 'QM' ? 'QM' : `ASIL ${v}`]),
  },
  {
    key: 'aspiceLevel',
    label: 'Automotive SPICE capability level',
    values: ['1', '2', '3', '4', '5'].map((v) => [v, `CL${v}`]),
  },
  {
    key: 'cal',
    label: 'Cybersecurity assurance level (ISO/SAE 21434)',
    values: ['1', '2', '3', '4'].map((v) => [v, `CAL ${v}`]),
  },
];
/** Qualifiers this form edits; any other qualifier on an existing claim is carried over unchanged. */
const EDITED_QUALIFIERS = new Set(['asil', 'aspiceLevel', 'cal', 'certificationBody', 'release']);

/**
 * Every field of a technical claim, labelled. `claim` pre-fills a revision.
 * Claim strength is chosen from the weakest wording upwards, with a hint per
 * option, so suppliers pick the weakest statement that is literally true.
 */
export async function ClaimFields({
  prefix,
  claim,
  evidence,
}: {
  prefix: string;
  claim?: ClaimT;
  evidence: readonly EvidenceT[];
}) {
  const q = claim?.qualifiers ?? {};
  return (
    <>
      <div>
        <label htmlFor={`${prefix}-concept`}>Technology, standard or capability</label>
        <ConceptSelect id={`${prefix}-concept`} defaultValue={claim?.concept.id} />
      </div>
      <div>
        <label htmlFor={`${prefix}-predicate`}>What exactly can you state?</label>
        <select
          id={`${prefix}-predicate`}
          name="predicate"
          required
          defaultValue={claim?.predicate ?? 'SUPPORTS'}
        >
          {CLAIM_PREDICATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} — {option.hint}
            </option>
          ))}
        </select>
        <p className="small muted flush">
          Choose the weakest wording that is literally true. “Designed for ASIL B” is not “ASIL B certified”.
        </p>
      </div>
      <div className="grid3">
        {LEVELS.map((level) => (
          <div key={level.key}>
            <label htmlFor={`${prefix}-${level.key}`}>{level.label}</label>
            <select id={`${prefix}-${level.key}`} name={`q.${level.key}`} defaultValue={q[level.key] ?? ''}>
              <option value="">not stated</option>
              {level.values.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="grid2even">
        <div>
          <label htmlFor={`${prefix}-body`}>Certification body (required for certifications)</label>
          <input
            id={`${prefix}-body`}
            name="q.certificationBody"
            maxLength={200}
            defaultValue={q['certificationBody'] ?? ''}
          />
        </div>
        <div>
          <label htmlFor={`${prefix}-release`}>Release / version (optional)</label>
          <input
            id={`${prefix}-release`}
            name="q.release"
            maxLength={60}
            defaultValue={q['release'] ?? q['version'] ?? ''}
          />
        </div>
      </div>
      {Object.entries(q)
        .filter(([key]) => !EDITED_QUALIFIERS.has(key))
        .map(([key, value]) => (
          <input key={key} type="hidden" name={`q.${key}`} value={value} />
        ))}
      <div>
        <label htmlFor={`${prefix}-statement`}>Statement, exactly as your documentation can back it</label>
        <textarea
          id={`${prefix}-statement`}
          name="statement"
          required
          minLength={3}
          maxLength={1000}
          defaultValue={claim?.statement ?? ''}
        />
      </div>
      <div className="grid2even">
        <div>
          <label htmlFor={`${prefix}-source`}>Public source (https://, optional)</label>
          <input
            id={`${prefix}-source`}
            name="sourceUrl"
            type="url"
            defaultValue={claim?.provenance.sourceUrl ?? ''}
          />
        </div>
        <div>
          <label htmlFor={`${prefix}-valid`}>Valid until (optional, e.g. certificate expiry)</label>
          <input
            id={`${prefix}-valid`}
            name="validUntil"
            type="date"
            defaultValue={claim?.expiresAt?.slice(0, 10) ?? ''}
          />
        </div>
      </div>
      {evidence.length > 0 ? (
        <fieldset>
          <legend className="small">Evidence that backs this claim</legend>
          {evidence.map((item) => (
            <label key={item.id} className="row plain small">
              <input
                type="checkbox"
                name="evidenceIds"
                value={item.id}
                defaultChecked={claim?.provenance.evidenceIds?.includes(item.id) ?? false}
                className="inline-check"
              />
              <span className="untrusted">{item.title}</span>
              <span className="muted">({EVIDENCE_KIND_LABEL[item.kind] ?? item.kind})</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="small muted">
          Add evidence below to link certificates, documents or references to claims.
        </p>
      )}
    </>
  );
}

const ClaimActions = ({
  claim,
  orgId,
  evidence,
}: {
  claim: ClaimT;
  orgId: string;
  evidence: readonly EvidenceT[];
}) => {
  if (claim.status === 'retracted') return null;
  const hidden = (action?: string) => (
    <>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="claimId" value={claim.id} />
      <input type="hidden" name="version" value={String(claim.version)} />
      {action ? <input type="hidden" name="action" value={action} /> : null}
    </>
  );
  const editForm = (
    <ActionForm action={reviseClaim} submitLabel="Save claim">
      {hidden()}
      <ClaimFields prefix={`edit-${claim.id}`} claim={claim} evidence={evidence} />
    </ActionForm>
  );
  // Drafts: review actions in plain sight. Published claims: changes are deliberate, so they sit behind one disclosure.
  return claim.status === 'draft' ? (
    <div className="stack">
      <div className="row">
        <ActionForm action={claimAction} submitLabel="Publish" className="row">
          {hidden('publish')}
        </ActionForm>
        <ActionForm action={claimAction} submitLabel="Discard draft" variant="secondary" className="row">
          {hidden('retract')}
        </ActionForm>
      </div>
      <details>
        <summary>Edit before publishing</summary>
        {editForm}
      </details>
    </div>
  ) : (
    <details>
      <summary>Edit or withdraw</summary>
      <p className="notice small">
        Editing a published claim changes what buyers see immediately. A change of wording, strength or
        evidence removes any platform verification until it is reviewed again.
      </p>
      {editForm}
      <ActionForm action={claimAction} submitLabel="Withdraw claim" variant="secondary" className="row">
        {hidden('retract')}
        <label className="row plain small">
          <input type="checkbox" required className="inline-check" /> Buyers will no longer see this claim
        </label>
      </ActionForm>
    </details>
  );
};

/** Claims grouped by lifecycle: drafts to review, what buyers see, and what was withdrawn. */
export const ClaimList = ({
  claims,
  orgId,
  evidence,
  headings = true,
}: {
  claims: readonly ClaimT[];
  orgId: string;
  evidence: readonly EvidenceT[];
  /** Status headings ("Drafts to review", "Published …"); off when the page already says what is listed. */
  headings?: boolean;
}) => {
  const sorted = [...claims].sort((a, b) => a.concept.label.localeCompare(b.concept.label));
  const groups = (['draft', 'published', 'retracted'] as const).map((status) => ({
    status,
    claims: sorted.filter((claim) => claim.status === status),
  }));
  if (claims.length === 0) return <p className="muted">No claims yet. Add the first one below.</p>;
  return (
    <div className="stack">
      {groups
        .filter((group) => group.claims.length > 0)
        .map((group) => {
          const body = group.claims.map((claim) => (
            <article key={claim.id} className="card stack" data-testid="workspace-claim">
              <div className="row spread">
                <div>
                  <strong>
                    {claim.predicateLabel} {claim.concept.label}
                  </strong>
                  {claim.qualifierText.length > 0 ? (
                    <span className="small muted"> · {claim.qualifierText.join(' · ')}</span>
                  ) : null}
                  {claim.expiresAt ? (
                    <span className="small muted"> · valid until {claim.expiresAt.slice(0, 10)}</span>
                  ) : null}
                </div>
                <div className="row">
                  {claim.provenance.category === 'AI_INFERRED' ? (
                    <span className="badge tone-warn">AI draft — check wording</span>
                  ) : null}
                  <TrustBadge tier={claim.trustTier} label={claim.trustLabel} />
                </div>
              </div>
              <p className="untrusted flush">{claim.statement}</p>
              <div className="small muted">
                {(claim.provenance.evidenceIds?.length ?? 0) === 0
                  ? 'No evidence linked.'
                  : `${claim.provenance.evidenceIds?.length} evidence item(s) linked.`}
              </div>
              <ClaimActions claim={claim} orgId={orgId} evidence={evidence} />
            </article>
          ));
          return group.status === 'retracted' ? (
            <details key={group.status}>
              <summary>
                {CLAIM_STATUS_LABEL[group.status]} ({group.claims.length})
              </summary>
              <div className="stack">{body}</div>
            </details>
          ) : !headings ? (
            <div key={group.status} className="stack">
              {body}
            </div>
          ) : (
            <section key={group.status} className="stack">
              <h3>
                {group.status === 'draft' ? 'Drafts to review' : 'Published — visible to buyers'} (
                {group.claims.length})
              </h3>
              {body}
            </section>
          );
        })}
    </div>
  );
};

/** Evidence already registered, and a form to add more (certificates, references, documentation). */
export const EvidencePanel = ({
  orgId,
  offeringId,
  evidence,
}: {
  orgId: string;
  offeringId: string | null;
  evidence: readonly EvidenceT[];
}) => (
  <div className="stack">
    {evidence.length === 0 ? (
      <p className="muted">No evidence yet.</p>
    ) : (
      <ul className="stack plain-list">
        {evidence.map((item) => (
          <li key={item.id} className="small">
            <span className="badge">{EVIDENCE_KIND_LABEL[item.kind] ?? item.kind}</span>{' '}
            {item.url ? (
              <a href={item.url} rel="noopener noreferrer nofollow" target="_blank" className="untrusted">
                {item.title}
              </a>
            ) : (
              <span className="untrusted">{item.title}</span>
            )}
            {item.customerDisclosure === 'anonymized' ? (
              <span className="muted"> (customer anonymized)</span>
            ) : null}
          </li>
        ))}
      </ul>
    )}
    <details>
      <summary>Add evidence</summary>
      <ActionForm action={addEvidence} submitLabel="Add evidence">
        <input type="hidden" name="orgId" value={orgId} />
        {offeringId ? <input type="hidden" name="offeringId" value={offeringId} /> : null}
        <div>
          <label htmlFor={`ev-kind-${offeringId ?? 'org'}`}>Kind</label>
          <select id={`ev-kind-${offeringId ?? 'org'}`} name="kind" defaultValue="certificate">
            {['certificate', 'public_url', 'document', 'case_study', 'production_reference'].map((kind) => (
              <option key={kind} value={kind}>
                {EVIDENCE_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`ev-title-${offeringId ?? 'org'}`}>Title</label>
          <input id={`ev-title-${offeringId ?? 'org'}`} name="title" required minLength={3} maxLength={200} />
        </div>
        <div>
          <label htmlFor={`ev-url-${offeringId ?? 'org'}`}>Link (https://, optional for references)</label>
          <input id={`ev-url-${offeringId ?? 'org'}`} name="url" type="url" />
        </div>
        <div>
          <label htmlFor={`ev-desc-${offeringId ?? 'org'}`}>Description (optional)</label>
          <textarea id={`ev-desc-${offeringId ?? 'org'}`} name="description" maxLength={2000} />
        </div>
        <div>
          <label htmlFor={`ev-disclosure-${offeringId ?? 'org'}`}>
            Production references: name the customer?
          </label>
          <select
            id={`ev-disclosure-${offeringId ?? 'org'}`}
            name="customerDisclosure"
            defaultValue="anonymized"
          >
            <option value="anonymized">No — anonymized (default)</option>
            <option value="named">Yes — the customer consented</option>
          </select>
        </div>
      </ActionForm>
    </details>
  </div>
);
