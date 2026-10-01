import { MatchResponse } from '@atx/contracts';
import { InterpretationPanel, MatchCard } from '@/components/results';
import { api, describeError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; strict?: string }>;
}) {
  const { q, strict } = await searchParams;
  const query = q?.trim() ?? '';
  let content: React.ReactNode = <p className="muted">Describe your requirement above.</p>;
  if (query) {
    try {
      const result = await api('/v1/matches', {
        method: 'POST',
        body: { text: query.slice(0, 4000), limit: 10, requireAllHardConstraintsMet: strict === '1' },
        schema: MatchResponse,
      });
      content = (
        <div className="stack">
          <InterpretationPanel interpretation={result.interpretation} />
          {result.degraded.length > 0 ? (
            <p className="notice">
              Some search signals are unavailable ({result.degraded.join(', ')}); results use keyword and
              structured matching.
            </p>
          ) : null}
          <form action="/compare">
            <input type="hidden" name="q" value={query} />
            <div className="row spread">
              <h2 className="flush">{result.matches.length} candidates</h2>
              <div className="row">
                <a
                  href={`/search/export?q=${encodeURIComponent(query)}${strict === '1' ? '&strict=1' : ''}`}
                  download
                >
                  Download shortlist (CSV)
                </a>
                <button type="submit">Compare selected</button>
              </div>
            </div>
            {result.matches.length === 0 ? (
              <p className="muted">No published offering matches these constraints.</p>
            ) : null}
            {result.matches.map((match) => (
              <MatchCard key={match.offering.id} match={match} selectable />
            ))}
          </form>
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
          <input
            type="checkbox"
            name="strict"
            value="1"
            defaultChecked={strict === '1'}
            className="inline-check"
          />{' '}
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
