import {
  ASSESSMENT_PRESENTATION,
  HARD_STATUS_PRESENTATION,
  MATURITY_LABEL,
  TRUST_PRESENTATION,
  VERIFICATION_PRESENTATION,
  presentationOf,
} from '@atx/ui';

export const Badge = ({ tone = 'neutral', children, title }: { tone?: string; children: React.ReactNode; title?: string }) => (
  <span className={`badge tone-${tone}`} title={title}>
    {children}
  </span>
);

export const DemoBadge = ({ isDemo }: { isDemo: boolean }) => (isDemo ? <span className="badge demo" title="Synthetic demonstration data">Demo data</span> : null);

export const StatusBadge = ({ status, title }: { status: string; title?: string | null }) => {
  const p = presentationOf(ASSESSMENT_PRESENTATION, status, { label: status, tone: 'neutral', symbol: '?' });
  return (
    <Badge tone={p.tone} title={title ?? undefined}>
      {p.symbol} {p.label}
    </Badge>
  );
};

export const HardStatusBadge = ({ status }: { status: string }) => {
  const p = presentationOf(HARD_STATUS_PRESENTATION, status, { label: status, tone: 'neutral' });
  return <Badge tone={p.tone}>{p.label}</Badge>;
};

export const TrustBadge = ({ tier, label }: { tier: string | null; label?: string | null }) => {
  if (!tier) return <span className="muted">—</span>;
  const p = presentationOf(TRUST_PRESENTATION, tier, { short: tier, tone: 'neutral' });
  return (
    <Badge tone={p.tone} title={label ?? undefined}>
      {p.short}
    </Badge>
  );
};

export const VerificationBadge = ({ state }: { state: string }) => {
  const p = presentationOf(VERIFICATION_PRESENTATION, state, { label: state, tone: 'neutral' });
  return <Badge tone={p.tone}>{p.label}</Badge>;
};

export const MaturityBadge = ({ maturity }: { maturity: string }) => <Badge>{MATURITY_LABEL[maturity] ?? maturity}</Badge>;
