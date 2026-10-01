import type { ClaimView, Interpretation, Match } from '@atx/contracts';
import { OFFERING_TYPE_LABEL } from '@atx/ui';
import Link from 'next/link';
import type { z } from 'zod';
import { Badge, DemoBadge, HardStatusBadge, MaturityBadge, StatusBadge, TrustBadge, VerificationBadge } from './badges';

type MatchT = z.infer<typeof Match>;
type InterpretationT = z.infer<typeof Interpretation>;
type ClaimT = z.infer<typeof ClaimView>;

export const InterpretationPanel = ({ interpretation }: { interpretation: InterpretationT }) => {
  const hard = interpretation.constraints.filter((c) => c.priority === 'hard');
  const preferences = interpretation.constraints.filter((c) => c.priority !== 'hard');
  return (
    <div className="panel stack" aria-label="How your requirement was interpreted">
      <div className="row">
        <strong>Hard constraints</strong>
        <div className="chips">{hard.length ? hard.map((c) => <Badge key={c.id} tone="info">{c.description}</Badge>) : <span className="muted">none</span>}</div>
      </div>
      <div className="row">
        <strong>Preferences</strong>
        <div className="chips">{preferences.length ? preferences.map((c) => <Badge key={c.id}>{c.description}</Badge>) : <span className="muted">none</span>}</div>
      </div>
      {interpretation.unrecognizedTerms.length > 0 ? (
        <div className="row small">
          <strong>Unknown terms</strong>
          <span className="muted">{interpretation.unrecognizedTerms.join(', ')} — not in the technology ontology; used for text relevance only.</span>
        </div>
      ) : null}
      <div className="small muted">Interpretation: {interpretation.method === 'ai_assisted' ? 'AI-assisted, validated against the ontology' : 'rule-based (ontology + cue words)'}</div>
    </div>
  );
};

export const MatchCard = ({ match, selectable = false }: { match: MatchT; selectable?: boolean }) => (
  <article className="card" data-testid="match-card">
    <div className="row spread">
      <div className="row">
        {selectable ? <input type="checkbox" name="ids" value={match.offering.id} aria-label={`Select ${match.offering.name} for comparison`} className="inline-check" /> : null}
        <h3 className="flush">
          {match.rank}. <Link href={`/offerings/${match.offering.id}`}>{match.offering.name}</Link>
        </h3>
        <span className="muted">by {match.offering.organization.name}</span>
        <VerificationBadge state={match.offering.organization.verificationState} />
        <MaturityBadge maturity={match.offering.maturity} />
        <DemoBadge isDemo={match.offering.isDemo} />
      </div>
      <HardStatusBadge status={match.hardConstraintStatus} />
    </div>
    <p className="untrusted muted">{match.offering.summary}</p>
    <table>
      <thead>
        <tr>
          <th>Requirement</th>
          <th>Status</th>
          <th>Evidence basis</th>
          <th>Explanation</th>
        </tr>
      </thead>
      <tbody>
        {match.assessments.map((a) => (
          <tr key={a.constraintId}>
            <td>
              {a.description}
              {a.priority === 'preference' ? <span className="muted"> (preference)</span> : null}
            </td>
            <td>
              <StatusBadge status={a.status} title={a.explanation} />
            </td>
            <td>
              <TrustBadge tier={a.strongestTrustTier} label={a.strongestTrustLabel} />
            </td>
            <td className="small muted">{a.explanation}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="row spread spaced">
      <span className="small">
        {match.summary} Confidence: <strong>{match.confidence}</strong>.
      </span>
      <details className="score-breakdown">
        <summary>Score {match.score.toFixed(2)} — how is this calculated?</summary>
        <ul>
          {match.scoreComponents.map((c) => (
            <li key={c.name}>
              {c.name}: {c.value} × weight {c.weight} — {c.explanation}
            </li>
          ))}
        </ul>
        <p>The score orders candidates; it is not a quality rating or certification.</p>
      </details>
    </div>
    {match.gaps.length > 0 ? (
      <details>
        <summary>{match.gaps.length} open question(s) to ask the supplier</summary>
        <ul className="small">
          {match.gaps.map((g) => (
            <li key={g.constraintId}>{g.suggestedQuestion}</li>
          ))}
        </ul>
      </details>
    ) : null}
  </article>
);

export const ClaimsTable = ({ claims, showStatus = false }: { claims: readonly ClaimT[]; showStatus?: boolean }) =>
  claims.length === 0 ? (
    <p className="muted">No technical claims published.</p>
  ) : (
    <table>
      <thead>
        <tr>
          <th>Technology</th>
          <th>Claim</th>
          <th>Supplier statement</th>
          <th>Provenance</th>
          {showStatus ? <th>Status</th> : null}
        </tr>
      </thead>
      <tbody>
        {claims.map((c) => (
          <tr key={c.id} data-testid="claim-row">
            <td>
              {c.concept.label}
              {Object.entries(c.qualifiers).map(([key, value]) => (
                <span key={key} className="muted small">
                  {' '}
                  {key}={value}
                </span>
              ))}
            </td>
            <td>{c.predicateLabel}</td>
            <td className="untrusted">
              {c.statement}
              {c.contentWarnings.length > 0 ? <div className="small tone-warn">⚠ contains instruction-like text (flagged for moderation)</div> : null}
            </td>
            <td>
              <TrustBadge tier={c.trustTier} label={c.trustLabel} />
              {c.provenance.sourceUrl ? (
                <div className="small">
                  <a href={c.provenance.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
                    source
                  </a>
                </div>
              ) : null}
            </td>
            {showStatus ? <td>{c.status}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );

export const offeringTypeLabel = (type: string) => OFFERING_TYPE_LABEL[type] ?? type;
