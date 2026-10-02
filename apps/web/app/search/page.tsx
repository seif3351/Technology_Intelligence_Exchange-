import { MatchResponse } from '@atx/contracts';
import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { InterpretationPanel, MatchCard } from '@/components/results';
import { saveSearchAsRequirement } from '@/lib/actions/buyer';
import { api, currentUser, describeError } from '@/lib/api';
import { decodeConstraintParams, encodeConstraint, fromInterpretation, searchHref } from '@/lib/constraints';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Technical matching' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; strict?: string; c?: string | string[] }>;
}) {
  const { q, strict, c } = await searchParams;
  const query = q?.trim().slice(0, 4000) ?? '';
  const isStrict = strict === '1';
  const refined = decodeConstraintParams(c);
  let content: React.ReactNode = <p className="muted">Describe your requirement above.</p>;
  if (query || refined.length > 0) {
    try {
      const result = await api('/v1/matches', {
        method: 'POST',
        body: {
          ...(query ? { text: query } : {}),
          ...(refined.length > 0 ? { constraints: refined } : {}),
          limit: 10,
          requireAllHardConstraintsMet: isStrict,
        },
        schema: MatchResponse,
      });
      // Exactly what the user sees drives refinement, comparison, export and saving.
      const current = fromInterpretation(result.interpretation.constraints);
      const me = await currentUser();
      const buyerOrg = me?.memberships.find(
        (m) => (m.organizationKind === 'buyer' || m.organizationKind === 'hybrid') && m.role !== 'viewer',
      );
      content = (
        <div className="stack">
          <InterpretationPanel
            interpretation={result.interpretation}
            refine={{ q: query, strict: isStrict, current }}
          />
          {buyerOrg && current.length > 0 ? (
            <details className="panel">
              <summary>Save as a private requirement</summary>
              <ActionForm action={saveSearchAsRequirement} submitLabel="Save private requirement">
                <input type="hidden" name="orgId" value={buyerOrg.organizationId} />
                <input type="hidden" name="description" value={query} />
                {current.map((constraint) => {
                  const encoded = encodeConstraint(constraint);
                  return <input key={encoded} type="hidden" name="c" value={encoded} />;
                })}
                <p className="small muted">
                  Saved for {buyerOrg.organizationName} only, with the constraints above. You can add
                  confidential terms and refine it on the requirement page.
                </p>
                <div>
                  <label htmlFor="save-title">Title</label>
                  <input
                    id="save-title"
                    name="title"
                    required
                    minLength={3}
                    maxLength={200}
                    defaultValue={query.slice(0, 80)}
                  />
                </div>
              </ActionForm>
            </details>
          ) : null}
          {result.degraded.length > 0 ? (
            <p className="notice">
              Some search signals are unavailable ({result.degraded.join(', ')}); results use keyword and
              structured matching.
            </p>
          ) : null}
          <form action="/compare">
            <input type="hidden" name="q" value={query} />
            {current.map((constraint) => {
              const encoded = encodeConstraint(constraint);
              return <input key={encoded} type="hidden" name="c" value={encoded} />;
            })}
            <div className="row spread">
              <h2 className="flush">
                {result.matches.length} candidate{result.matches.length === 1 ? '' : 's'}
              </h2>
              <div className="row">
                <a href={searchHref(query, current, isStrict, '/search/export')} download>
                  Download shortlist (CSV)
                </a>
                <button type="submit">Compare selected</button>
              </div>
            </div>
            {result.omittedWithoutEvidence > 0 ? (
              <p className="small muted" data-testid="omitted-note">
                {result.omittedWithoutEvidence} more offering{result.omittedWithoutEvidence === 1 ? '' : 's'}{' '}
                {result.omittedWithoutEvidence === 1 ? 'was' : 'were'} retrieved but{' '}
                {result.omittedWithoutEvidence === 1 ? 'says' : 'say'} nothing about your requirements, so{' '}
                {result.omittedWithoutEvidence === 1 ? 'it is' : 'they are'} not listed.
              </p>
            ) : null}
            {result.matches.length === 0 ? (
              <p className="muted">No published offering matches these constraints.</p>
            ) : null}
            {result.matches.map((match) => (
              <MatchCard key={match.offering.id} match={match} selectable />
            ))}
          </form>
          <p className="small muted">
            Status symbols: ✓ met · ◐ partially supported · ? unknown (no published information — not the same
            as unsupported). The evidence basis names the strongest source for each line.
          </p>
        </div>
      );
    } catch (error) {
      content = <p className="error">{describeError(error)}</p>;
    }
  }
  return (
    <div className="stack">
      <h1>Technical matching</h1>
      <form action="/search" className="stack">
        <div className="search-box">
          <textarea name="q" defaultValue={query} aria-label="Technical requirement" required />
          <button type="submit" className="primary">
            Search
          </button>
        </div>
        <label className="row plain">
          <input type="checkbox" name="strict" value="1" defaultChecked={isStrict} className="inline-check" />{' '}
          Only show candidates that meet every hard constraint
        </label>
      </form>
      <p className="small muted">
        Do not enter confidential project names here; use a private requirement with confidential terms
        instead.
      </p>
      {content}
    </div>
  );
}
