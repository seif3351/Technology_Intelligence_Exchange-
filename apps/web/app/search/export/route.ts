import { apiDownload } from '@/lib/api';
import { decodeConstraintParams } from '@/lib/constraints';

/** BFF download of the shortlist CSV for a search (GET so it works as a plain link). */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 4000);
  // The same (possibly refined) constraints the user saw on the search page.
  const constraints = decodeConstraintParams(url.searchParams.getAll('c'));
  if (!query && constraints.length === 0) return new Response('Missing search text', { status: 400 });
  const upstream = await apiDownload('/v1/matches/export', {
    ...(query ? { text: query } : {}),
    ...(constraints.length > 0 ? { constraints } : {}),
    limit: 25,
    requireAllHardConstraintsMet: url.searchParams.get('strict') === '1',
  });
  if (!upstream.ok) return new Response('Export failed', { status: upstream.status });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="atx-shortlist.csv"',
      'cache-control': 'no-store',
    },
  });
}
