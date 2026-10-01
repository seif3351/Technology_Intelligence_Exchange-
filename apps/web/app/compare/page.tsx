import { CompareResponse } from '@atx/contracts';
import Link from 'next/link';
import { StatusBadge, TrustBadge } from '@/components/badges';
import { api, describeError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[]; q?: string }> }) {
  const { ids, q } = await searchParams;
  const offeringIds = (Array.isArray(ids) ? ids : ids ? [ids] : []).slice(0, 5);
  if (offeringIds.length < 2) return <p className="notice">Select 2–5 offerings on the search page to compare them.</p>;
  let result;
  try {
    result = await api('/v1/matches/compare', { method: 'POST', body: { offeringIds, ...(q ? { text: q.slice(0, 4000) } : {}) }, schema: CompareResponse });
  } catch (error) {
    return <p className="error">{describeError(error)}</p>;
  }
  const tiers = new Map(result.matches.flatMap((m) => m.assessments.map((a) => [`${m.offering.id}:${a.constraintId}`, a] as const)));
  return (
    <div className="stack">
      <h1>Side-by-side comparison</h1>
      {q ? <p className="muted">Against: {q}</p> : <p className="muted">Across all concepts the selected offerings claim.</p>}
      <table data-testid="comparison">
        <thead>
          <tr>
            <th>Requirement</th>
            {result.matches.map((m) => (
              <th key={m.offering.id}>
                <Link href={`/offerings/${m.offering.id}`}>{m.offering.name}</Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.matrix.map((row) => (
            <tr key={row.constraintId}>
              <td>
                {row.description}
                {row.priority === 'preference' ? <span className="muted"> (pref.)</span> : null}
              </td>
              {row.cells.map((cell) => {
                const assessment = tiers.get(`${cell.offeringId}:${row.constraintId}`);
                return (
                  <td key={cell.offeringId}>
                    <StatusBadge status={cell.status} title={assessment?.explanation} /> <TrustBadge tier={cell.strongestTrustTier} label={assessment?.strongestTrustLabel} />
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td>
              <strong>Summary</strong>
            </td>
            {result.matches.map((m) => (
              <td key={m.offering.id} className="small">
                {m.summary} Confidence {m.confidence}.
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
