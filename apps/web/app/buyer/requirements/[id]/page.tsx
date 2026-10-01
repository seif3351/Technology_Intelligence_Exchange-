import { MatchResponse, RequirementView } from '@atx/contracts';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { Badge } from '@/components/badges';
import { MatchCard } from '@/components/results';
import { ApiError, api, currentUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function RequirementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ org?: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect('/login?next=/buyer/requirements');
  const { org } = await searchParams;
  const orgId = org ?? me.memberships.find((m) => m.organizationKind !== 'supplier')?.organizationId;
  if (!orgId) notFound();
  let data;
  try {
    data = await api(`/v1/organizations/${orgId}/requirements/${encodeURIComponent(id)}`, {
      schema: z.object({ requirement: RequirementView, confidentialTerms: z.array(z.string()) }),
    });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const matches = await api('/v1/matches', { method: 'POST', body: { requirementId: id, organizationId: orgId, limit: 5 }, schema: MatchResponse });
  const r = data.requirement;
  return (
    <div className="stack">
      <div className="row">
        <h1>{r.title}</h1>
        <Badge tone="good">{r.visibility}</Badge>
      </div>
      <div className="grid2">
        <div className="stack">
          <p className="muted">{r.description}</p>
          <h2>Matching offerings</h2>
          <p className="small muted">Matching uses only the structured constraints below; the title, description and confidential terms are never sent to the search index or AI providers.</p>
          {matches.matches.map((m) => (
            <MatchCard key={m.offering.id} match={m} />
          ))}
        </div>
        <aside className="stack">
          <div className="panel stack">
            <h3>Constraints</h3>
            {r.constraints.map((c) => (
              <div key={c.id} className="row small">
                <Badge tone={c.priority === 'hard' ? 'info' : 'neutral'}>{c.priority}</Badge> {c.description}
              </div>
            ))}
          </div>
          <div className="panel stack">
            <h3>Confidential terms (only visible to your organization)</h3>
            <div className="chips">
              {data.confidentialTerms.map((term) => (
                <Badge key={term} tone="warn">
                  {term}
                </Badge>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
