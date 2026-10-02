import type { ClaimView, ConstraintInputT, Interpretation, Match } from '@atx/contracts';
import { ASSESSMENT_PRESENTATION, OFFERING_TYPE_LABEL, TRUST_PRESENTATION, presentationOf } from '@atx/ui';
import Link from 'next/link';
import type { z } from 'zod';
import { searchHref } from '@/lib/constraints';
import {
  DemoBadge,
  HardStatusBadge,
  MaturityBadge,
  StatusBadge,
  TrustBadge,
  VerificationBadge,
} from './badges';
import { TableScroll } from './table-scroll';

type MatchT = z.infer<typeof Match>;
type InterpretationT = z.infer<typeof Interpretation>;
type ClaimT = z.infer<typeof ClaimView>;

/** What the search page needs to turn every constraint chip into refine links. */
export interface RefineContext {
  readonly q: string;
  readonly strict: boolean;
  /** The constraints currently shown, in interpretation order. */
  readonly current: readonly ConstraintInputT[];
}

const METHOD_LABEL: Readonly<Record<string, string>> = {
  ai_assisted: 'AI-assisted, validated against the ontology',
  deterministic: 'rule-based (ontology + cue words)',
  provided: 'refined by you',
};

export const InterpretationPanel = ({
  interpretation,
  refine,
}: {
  interpretation: InterpretationT;
  refine?: RefineContext;
}) => {
  const indexed = interpretation.constraints.map((constraint, index) => ({ constraint, index }));
  const hard = indexed.filter(({ constraint }) => constraint.priority === 'hard');
  const preferences = indexed.filter(({ constraint }) => constraint.priority !== 'hard');
  const chip = ({ constraint, index }: (typeof indexed)[number]) => {
    const isHard = constraint.priority === 'hard';
    if (!refine) return null;
    const toggled = refine.current.map((c, i) =>
      i === index ? { ...c, priority: isHard ? ('preference' as const) : ('hard' as const) } : c,
    );
    const removed = refine.current.filter((_, i) => i !== index);
    return (
      <span className="refine">
        <Link
          href={searchHref(refine.q, toggled, refine.strict)}
          aria-label={`Make "${constraint.description}" ${isHard ? 'a preference' : 'a hard constraint'}`}
          title={isHard ? 'Make this a preference' : 'Make this a hard constraint'}
        >
          {isHard ? '↓' : '↑'}
        </Link>
        <Link
          href={searchHref(refine.q, removed, refine.strict)}
          aria-label={`Remove "${constraint.description}"`}
          title="Remove"
        >
          ×
        </Link>
      </span>
    );
  };
  const list = (items: typeof indexed, tone: string) =>
    items.length ? (
      items.map((item) => (
        <span key={item.constraint.id} className={`badge tone-${tone} constraint-chip`}>
          {item.constraint.description}
          {chip(item)}
        </span>
      ))
    ) : (
      <span className="muted">none</span>
    );
  return (
    <div className="panel stack" aria-label="How your requirement was interpreted">
      <div className="row">
        <strong>Hard constraints</strong>
        <div className="chips">{list(hard, 'info')}</div>
      </div>
      <div className="row">
        <strong>Preferences</strong>
        <div className="chips">{list(preferences, 'neutral')}</div>
      </div>
      {interpretation.unrecognizedTerms.length > 0 ? (
        <div className="row small">
          <strong>Unknown terms</strong>
          <span className="muted">
            {interpretation.unrecognizedTerms.join(', ')} — not in the technology ontology; used for text
            relevance only.
          </span>
        </div>
      ) : null}
      <div className="row spread small muted">
        <span>
          Interpretation: {METHOD_LABEL[interpretation.method] ?? interpretation.method}
          {refine ? ' · ↓ makes a constraint a preference, ↑ a hard constraint, × removes it' : null}
        </span>
        {refine && interpretation.method === 'provided' ? (
          <Link href={searchHref(refine.q, null, refine.strict)}>Reset to my text</Link>
        ) : null}
      </div>
    </div>
  );
};

/** One line per requirement: status symbol, plain wording and the strongest evidence basis. */
const AssessmentList = ({ match }: { match: MatchT }) => (
  <ul className="assessments" aria-label={`How ${match.offering.name} meets each requirement`}>
    {match.assessments.map((a) => {
      const status = presentationOf(ASSESSMENT_PRESENTATION, a.status, {
        label: a.status,
        tone: 'neutral',
        symbol: '?',
      });
      const basis = a.strongestTrustTier
        ? presentationOf(TRUST_PRESENTATION, a.strongestTrustTier, {
            short: a.strongestTrustTier,
            tone: 'neutral',
          })
        : null;
      return (
        <li key={a.constraintId} className="assessment" data-status={a.status} title={a.explanation}>
          <span aria-hidden="true" className={`symbol tone-${status.tone}`}>
            {status.symbol}
          </span>
          <span className="sr-only">{status.label}: </span>
          {a.description}
          {a.priority === 'preference' ? <span className="muted"> (preference)</span> : null}
          {basis ? <span className="basis"> · {basis.short}</span> : null}
        </li>
      );
    })}
  </ul>
);

export const MatchCard = ({ match, selectable = false }: { match: MatchT; selectable?: boolean }) => (
  <article className="card" data-testid="match-card">
    <div className="row spread">
      <div className="row">
        {selectable ? (
          <input
            type="checkbox"
            name="ids"
            value={match.offering.id}
            aria-label={`Select ${match.offering.name} for comparison`}
            className="inline-check"
          />
        ) : null}
        <h3 className="flush">
          {match.rank}. <Link href={`/offerings/${match.offering.id}`}>{match.offering.name}</Link>
        </h3>
        <span className="muted">
          by{' '}
          <Link href={`/suppliers/${match.offering.organization.slug}`}>
            {match.offering.organization.name}
          </Link>
        </span>
        <VerificationBadge state={match.offering.organization.verificationState} />
        <MaturityBadge maturity={match.offering.maturity} />
        <DemoBadge isDemo={match.offering.isDemo} />
      </div>
      <HardStatusBadge status={match.hardConstraintStatus} />
    </div>
    <p className="untrusted muted">{match.offering.summary}</p>
    <AssessmentList match={match} />
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
    <details>
      <summary>Evidence details</summary>
      <TableScroll label={`Evidence details for ${match.offering.name}`}>
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
      </TableScroll>
    </details>
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

const TIER_RANK = new Map(Object.keys(TRUST_PRESENTATION).map((tier, index) => [tier, index]));
const dateOnly = (iso: string) => iso.slice(0, 10);

/**
 * Claims grouped by the facet of their concept (platforms, standards, …) so a
 * buyer can scan "which OS, which SoCs, which certifications"; the strongest
 * evidence comes first within a group.
 */
export const ClaimsTable = ({
  claims,
  facetLabels,
  showStatus = false,
}: {
  claims: readonly ClaimT[];
  /** facet id -> label; without it the claims are listed ungrouped. */
  facetLabels?: ReadonlyMap<string, string>;
  showStatus?: boolean;
}) => {
  if (claims.length === 0) return <p className="muted">No technical claims published.</p>;
  const sorted = [...claims].sort(
    (a, b) =>
      (TIER_RANK.get(a.trustTier) ?? 99) - (TIER_RANK.get(b.trustTier) ?? 99) ||
      a.concept.label.localeCompare(b.concept.label),
  );
  const groups = facetLabels
    ? [...new Set(sorted.map((c) => c.concept.facet))]
        .map((facet) => ({ facet, label: facetLabels.get(facet) ?? facet }))
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((group) => ({ ...group, claims: sorted.filter((c) => c.concept.facet === group.facet) }))
    : [{ facet: '', label: '', claims: sorted }];
  const columns = showStatus ? 5 : 4;
  return (
    <TableScroll label="Technical claims">
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
          {groups.map((group) => [
            group.label ? (
              <tr key={`group-${group.facet}`} className="group-row">
                <th colSpan={columns} scope="colgroup">
                  {group.label}
                </th>
              </tr>
            ) : null,
            ...group.claims.map((c) => (
              <tr key={c.id} data-testid="claim-row">
                <td>
                  {c.concept.label}
                  {c.qualifierText.length > 0 ? (
                    <div className="small muted">{c.qualifierText.join(' · ')}</div>
                  ) : null}
                  {c.expiresAt ? (
                    <div className="small muted">valid until {dateOnly(c.expiresAt)}</div>
                  ) : null}
                </td>
                <td>{c.predicateLabel}</td>
                <td className="untrusted">
                  {c.statement}
                  {c.contentWarnings.length > 0 ? (
                    <div className="small tone-warn">
                      ⚠ contains instruction-like text (flagged for moderation)
                    </div>
                  ) : null}
                </td>
                <td>
                  <TrustBadge tier={c.trustTier} label={c.trustLabel} />
                  {c.verification.verifiedAt ? (
                    <div className="small muted">reviewed {dateOnly(c.verification.verifiedAt)}</div>
                  ) : null}
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
            )),
          ])}
        </tbody>
      </table>
    </TableScroll>
  );
};

export const offeringTypeLabel = (type: string) => OFFERING_TYPE_LABEL[type] ?? type;
