import { CompareResponse } from '@atx/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge, TrustBadge } from '@/components/badges';
import { TableScroll } from '@/components/table-scroll';
import { api, describeError } from '@/lib/api';
import { decodeConstraintParams, searchHref } from '@/lib/constraints';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Side-by-side comparison' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[]; q?: string; c?: string | string[]; diff?: string }>;
}) {
  const { ids, q, c, diff } = await searchParams;
  // Accept repeated (?ids=a&ids=b) and comma-separated (?ids=a,b) selections.
  const offeringIds = [
    ...new Set(
      (Array.isArray(ids) ? ids : ids ? [ids] : [])
        .flatMap((value) => value.split(','))
        .map((id) => id.trim()),
    ),
  ].filter((id) => UUID.test(id));
  if (offeringIds.length < 2 || offeringIds.length > 5)
    return (
      <p className="notice">
        Select 2–5 offerings on the <Link href="/search">search page</Link> to compare them.
      </p>
    );
  const query = q?.trim().slice(0, 4000) ?? '';
  const constraints = decodeConstraintParams(c);
  let result;
  try {
    result = await api('/v1/matches/compare', {
      method: 'POST',
      body: {
        offeringIds,
        ...(query ? { text: query } : {}),
        ...(constraints.length > 0 ? { constraints } : {}),
      },
      schema: CompareResponse,
    });
  } catch (error) {
    return <p className="error">{describeError(error)}</p>;
  }
  const assessments = new Map(
    result.matches.flatMap((m) =>
      m.assessments.map((a) => [`${m.offering.id}:${a.constraintId}`, a] as const),
    ),
  );
  const onlyDifferences = diff === '1';
  const rows = onlyDifferences
    ? result.matrix.filter((row) => new Set(row.cells.map((cell) => cell.status)).size > 1)
    : result.matrix;
  const toggleParams = new URLSearchParams();
  for (const id of offeringIds) toggleParams.append('ids', id);
  if (query) toggleParams.set('q', query);
  for (const value of Array.isArray(c) ? c : c ? [c] : []) toggleParams.append('c', value);
  if (!onlyDifferences) toggleParams.set('diff', '1');
  const columns = result.matches.length + 1;
  return (
    <div className="stack">
      <h1>Side-by-side comparison</h1>
      <div className="row spread">
        {query ? (
          <p className="muted flush">Against: {query}</p>
        ) : (
          <p className="muted flush">Across all technologies the selected offerings claim.</p>
        )}
        <div className="row">
          {query || constraints.length > 0 ? (
            <Link href={searchHref(query, constraints.length > 0 ? constraints : null, false)}>
              Back to results
            </Link>
          ) : null}
          <Link href={`/compare?${toggleParams.toString()}`}>
            {onlyDifferences ? 'Show all rows' : 'Show only differences'}
          </Link>
        </div>
      </div>
      <TableScroll label="Comparison">
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns} className="muted">
                  No differences: every offering has the same status on every row.
                </td>
              </tr>
            ) : null}
            {rows.flatMap((row, index) => [
              row.group && row.group !== rows[index - 1]?.group ? (
                <tr key={`group-${row.constraintId}`} className="group-row">
                  <th colSpan={columns} scope="colgroup">
                    {row.group}
                  </th>
                </tr>
              ) : null,
              <tr key={row.constraintId}>
                <td>
                  {row.description}
                  {row.priority === 'preference' ? <span className="muted"> (preference)</span> : null}
                </td>
                {row.cells.map((cell) => {
                  const assessment = assessments.get(`${cell.offeringId}:${row.constraintId}`);
                  return (
                    <td key={cell.offeringId}>
                      <StatusBadge status={cell.status} title={assessment?.explanation} />{' '}
                      <TrustBadge tier={cell.strongestTrustTier} label={assessment?.strongestTrustLabel} />
                    </td>
                  );
                })}
              </tr>,
            ])}
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
      </TableScroll>
    </div>
  );
}
