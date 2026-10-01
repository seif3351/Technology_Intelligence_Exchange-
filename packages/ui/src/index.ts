/**
 * Framework-free presentation vocabulary shared by the web app (and usable by
 * MCP App views): one place that decides how statuses, trust tiers and
 * predicates are worded, so no interface invents its own, stronger phrasing.
 */
export type Tone = 'good' | 'info' | 'warn' | 'bad' | 'neutral';

export const ASSESSMENT_PRESENTATION: Readonly<Record<string, { readonly label: string; readonly tone: Tone; readonly symbol: string }>> = {
  met: { label: 'Met', tone: 'good', symbol: '✓' },
  partial: { label: 'Partial', tone: 'warn', symbol: '◐' },
  unknown: { label: 'Unknown', tone: 'neutral', symbol: '?' },
  unmet: { label: 'Not met', tone: 'bad', symbol: '✗' },
};

export const HARD_STATUS_PRESENTATION: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  all_met: { label: 'All hard constraints met', tone: 'good' },
  some_unknown: { label: 'Some hard constraints unknown', tone: 'warn' },
  some_unmet: { label: 'Hard constraint not met', tone: 'bad' },
  none_specified: { label: 'No hard constraints', tone: 'neutral' },
};

export const TRUST_PRESENTATION: Readonly<Record<string, { readonly short: string; readonly tone: Tone }>> = {
  platform_verified: { short: 'Platform verified', tone: 'good' },
  supplier_verified_with_evidence: { short: 'Supplier stated + evidence', tone: 'info' },
  supplier_verified: { short: 'Supplier stated', tone: 'info' },
  public_source: { short: 'Public source', tone: 'neutral' },
  unverified: { short: 'Unverified', tone: 'warn' },
  ai_inferred: { short: 'AI-inferred (unconfirmed)', tone: 'warn' },
};

export const VERIFICATION_PRESENTATION: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  verified: { label: 'Verified supplier', tone: 'good' },
  pending: { label: 'Verification pending', tone: 'warn' },
  unverified: { label: 'Unverified supplier', tone: 'warn' },
  rejected: { label: 'Verification rejected', tone: 'bad' },
  suspended: { label: 'Suspended', tone: 'bad' },
};

export const MATURITY_LABEL: Readonly<Record<string, string>> = {
  concept: 'Concept',
  prototype: 'Prototype',
  pilot: 'Pilot',
  production: 'Production',
};

export const OFFERING_TYPE_LABEL: Readonly<Record<string, string>> = {
  product: 'Product',
  service: 'Service',
  technology_platform: 'Technology platform',
};

export const formatDuration = (seconds: number | null | undefined): string => {
  if (!seconds && seconds !== 0) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
};

export const presentationOf = <T>(table: Readonly<Record<string, T>>, key: string, fallback: T): T => table[key] ?? fallback;
