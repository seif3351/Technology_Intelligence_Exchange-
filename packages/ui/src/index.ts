/**
 * Framework-free presentation vocabulary shared by the web app (and usable by
 * MCP App views): one place that decides how statuses, trust tiers and
 * predicates are worded, so no interface invents its own, stronger phrasing.
 */
export type Tone = 'good' | 'info' | 'warn' | 'bad' | 'neutral';

export const ASSESSMENT_PRESENTATION: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone; readonly symbol: string }>
> = {
  met: { label: 'Met', tone: 'good', symbol: '✓' },
  partial: { label: 'Partial', tone: 'warn', symbol: '◐' },
  unknown: { label: 'Unknown', tone: 'neutral', symbol: '?' },
  unmet: { label: 'Not met', tone: 'bad', symbol: '✗' },
};

export const HARD_STATUS_PRESENTATION: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone }>
> = {
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

export const VERIFICATION_PRESENTATION: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone }>
> = {
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

export const presentationOf = <T>(table: Readonly<Record<string, T>>, key: string, fallback: T): T =>
  table[key] ?? fallback;

/**
 * Claim strength as suppliers choose it, weakest first. Labels match the
 * domain's describePredicate exactly (checked by test/presentation.test.ts);
 * the hint says when the wording is literally true.
 */
export const CLAIM_PREDICATE_OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: 'TARGETS_DOMAIN', label: 'targets', hint: 'intended for an application domain, e.g. ADAS' },
  {
    value: 'DESIGNED_FOR',
    label: 'designed for (not a certification)',
    hint: 'e.g. "designed for ASIL B projects"',
  },
  { value: 'SUPPORTS', label: 'supports', hint: 'works with / runs on / is compatible with' },
  {
    value: 'INTEGRATES_WITH',
    label: 'integrates with',
    hint: 'documented integration with a tool or platform',
  },
  {
    value: 'IMPLEMENTS',
    label: 'implements',
    hint: 'implements a standard or specification (add the release)',
  },
  {
    value: 'PROVIDES_CAPABILITY',
    label: 'provides',
    hint: 'delivers a capability, e.g. integration testing',
  },
  {
    value: 'EXPERIENCE_WITH',
    label: 'has project experience with',
    hint: 'your team has done projects with it',
  },
  {
    value: 'PROCESS_COMPLIANT',
    label: 'states process compliance with',
    hint: 'your process is assessed against it, e.g. Automotive SPICE',
  },
  {
    value: 'CERTIFIED',
    label: 'holds third-party certification for',
    hint: 'a certificate exists; name the certification body and link it as evidence',
  },
  {
    value: 'PRODUCTION_DEPLOYMENT',
    label: 'has series-production deployment with',
    hint: 'deployed in vehicles in series production',
  },
];

export const EVIDENCE_KIND_LABEL: Readonly<Record<string, string>> = {
  document: 'Document',
  video: 'Video',
  case_study: 'Case study',
  public_url: 'Public documentation',
  certificate: 'Certificate',
  production_reference: 'Production reference',
};

export const CLAIM_STATUS_LABEL: Readonly<Record<string, string>> = {
  draft: 'Draft (private)',
  published: 'Published',
  retracted: 'Retracted',
};

export const OFFERING_STATUS_LABEL: Readonly<Record<string, string>> = {
  draft: 'Draft (private)',
  in_review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

/** Upload processing as people understand it. */
export const ASSET_STATE_LABEL: Readonly<Record<string, string>> = {
  uploaded: 'Waiting for scan',
  scanning: 'Scanning',
  processing: 'Extracting text',
  ready: 'Ready',
  quarantined: 'Blocked by malware scan',
  failed: 'Failed',
};

export const EXTRACTION_STATE_LABEL: Readonly<Record<string, string>> = {
  pending: 'Claims not drafted yet',
  not_started: 'Not analysed',
  completed: 'Claims drafted for your review',
  not_supported: 'No text to analyse',
  failed: 'Analysis failed',
};
