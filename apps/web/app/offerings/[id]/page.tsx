import { OfferingDetail } from '@atx/contracts';
import { formatDuration } from '@atx/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoBadge, MaturityBadge, TrustBadge, VerificationBadge } from '@/components/badges';
import { ClaimsTable, offeringTypeLabel } from '@/components/results';
import { ApiError, api, currentUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function OfferingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let offering;
  try {
    offering = await api(`/v1/offerings/${encodeURIComponent(id)}`, { schema: OfferingDetail });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
  const me = await currentUser();
  const isBuyer = me?.memberships.some((m) => m.organizationKind === 'buyer' || m.organizationKind === 'hybrid') ?? false;
  return (
    <div className="stack">
      <div className="row">
        <h1>{offering.name}</h1>
        <MaturityBadge maturity={offering.maturity} />
        <DemoBadge isDemo={offering.isDemo} />
      </div>
      <div className="row muted">
        {offeringTypeLabel(offering.type)} by <Link href={`/suppliers/${offering.organization.slug}`}>{offering.organization.name}</Link>
        <VerificationBadge state={offering.organization.verificationState} />
      </div>
      <div className="grid2">
        <div className="stack">
          <p className="untrusted">{offering.summary}</p>
          <p className="untrusted muted">{offering.description}</p>
          <h2>Technical claims</h2>
          <ClaimsTable claims={offering.claims} />
          {offering.organizationClaims.length > 0 ? (
            <>
              <h2>Organization-level claims</h2>
              <ClaimsTable claims={offering.organizationClaims} />
            </>
          ) : null}
        </div>
        <aside className="stack">
          <div className="panel stack">
            <h3>Commercial</h3>
            <div className="small">Pricing model: {offering.commercial.pricingModel ?? 'not stated'}</div>
            <div className="small">Regions: {offering.regions.join(', ') || 'not stated'}</div>
            {isBuyer ? (
              <Link className="button primary" href={`/request?offeringId=${offering.id}`}>
                Request demo / workshop
              </Link>
            ) : (
              <p className="small muted">Sign in as a buyer to request a demo, workshop, PoC or RFI.</p>
            )}
          </div>
          <div className="panel stack">
            <h3>Demo videos</h3>
            {offering.videos.length === 0 ? <p className="small muted">No demo videos.</p> : null}
            {offering.videos.map((video) => (
              <div key={video.id} className="stack">
                <strong>{video.title}</strong>
                <div className="small muted untrusted">{video.description}</div>
                {video.playbackUrl ? (
                  <a href={video.playbackUrl} rel="noopener noreferrer nofollow" target="_blank">
                    Watch ({formatDuration(video.durationSeconds)})
                  </a>
                ) : (
                  <span className="small muted">Processing…</span>
                )}
              </div>
            ))}
          </div>
          <div className="panel stack">
            <h3>Evidence</h3>
            {offering.evidence.length === 0 ? <p className="small muted">No public evidence.</p> : null}
            {offering.evidence.map((item) => (
              <div key={item.id} className="small">
                <span className="badge">{item.kind.replace('_', ' ')}</span>{' '}
                {item.url ? (
                  <a href={item.url} rel="noopener noreferrer nofollow" target="_blank" className="untrusted">
                    {item.title}
                  </a>
                ) : (
                  <span className="untrusted">{item.title}</span>
                )}
                {item.customerDisclosure === 'anonymized' ? <span className="muted"> (customer anonymized)</span> : null}
              </div>
            ))}
          </div>
          <div className="panel small">
            <h3>How to read provenance</h3>
            <div className="stack">
              <div><TrustBadge tier="platform_verified" /> platform reviewed linked evidence</div>
              <div><TrustBadge tier="supplier_verified_with_evidence" /> supplier statement with documents</div>
              <div><TrustBadge tier="supplier_verified" /> supplier statement only</div>
              <div><TrustBadge tier="public_source" /> public documentation, not supplier-confirmed</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
