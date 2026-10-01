import { SupplierView } from '@atx/contracts';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoBadge, MaturityBadge, VerificationBadge } from '@/components/badges';
import { ClaimsTable } from '@/components/results';
import { ApiError, api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function SupplierPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let supplier;
  try {
    supplier = await api(`/v1/suppliers/${encodeURIComponent(slug)}`, { schema: SupplierView, anonymous: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const org = supplier.organization;
  return (
    <div className="stack">
      <div className="row">
        <h1>{org.name}</h1>
        <VerificationBadge state={org.verificationState} />
        <DemoBadge isDemo={org.isDemo} />
      </div>
      <p className="untrusted">{org.summary}</p>
      <p className="small muted">
        {org.headquartersCountry ? `Headquarters: ${org.headquartersCountry}. ` : ''}Regions: {org.regions.join(', ') || 'not stated'}.{' '}
        {org.website ? (
          <a href={org.website} rel="noopener noreferrer nofollow" target="_blank">
            Website
          </a>
        ) : null}
      </p>
      <h2>Offerings</h2>
      <table>
        <tbody>
          {supplier.offerings.map((offering) => (
            <tr key={offering.id}>
              <td>
                <Link href={`/offerings/${offering.id}`}>{offering.name}</Link>
              </td>
              <td className="untrusted muted">{offering.summary}</td>
              <td>
                <MaturityBadge maturity={offering.maturity} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {supplier.capabilities.length > 0 ? (
        <>
          <h2>Capabilities</h2>
          <ul>
            {supplier.capabilities.map((c) => (
              <li key={c.id}>
                {c.name} <span className="muted">({c.concept.label})</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2>Organization-level claims</h2>
      <ClaimsTable claims={supplier.organizationClaims} />
    </div>
  );
}
