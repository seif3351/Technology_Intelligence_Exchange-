import type {
  AssetId,
  ClaimPredicate,
  ConceptId,
  Ontology,
  OfferingId,
  OntologySnapshot,
  OrganizationId,
  UserId,
} from '@atx/domain';
import type { InterpretedRequirement, RankedList } from '@atx/search';

export interface Clock {
  now(): Date;
}

/** Provides the current ontology graph (cached, rebuilt when the stored version changes). */
export interface OntologyProvider {
  current(): Promise<Ontology>;
  /** Persists a snapshot (seed/admin) and invalidates caches. */
  replace(snapshot: OntologySnapshot): Promise<void>;
  addConcept(input: {
    readonly id: ConceptId;
    readonly facetId: string;
    readonly label: string;
    readonly description: string;
    readonly aliases: readonly string[];
    readonly broaderConceptIds: readonly ConceptId[];
  }): Promise<void>;
}

// ---------------------------------------------------------------- search index

export interface RetrievalQuery {
  readonly text: string | null;
  readonly embedding: { readonly model: string; readonly vector: readonly number[] } | null;
  /** Concepts (already expanded to narrower concepts) for structured retrieval. */
  readonly conceptIds: readonly ConceptId[];
  readonly limit: number;
}

export interface OfferingSearchDocument {
  readonly offeringId: OfferingId;
  readonly text: string;
  readonly contentHash: string;
  readonly embedding: { readonly model: string; readonly vector: readonly number[] } | null;
}

/** Derived, rebuildable retrieval index. Canonical facts stay in relational tables. */
export interface SearchIndex {
  retrieve(query: RetrievalQuery): Promise<RankedList[]>;
  upsert(document: OfferingSearchDocument): Promise<void>;
  remove(offeringId: OfferingId): Promise<void>;
  currentHash(offeringId: OfferingId): Promise<string | null>;
}

// ------------------------------------------------------------------------- AI

export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: readonly string[]): Promise<number[][]>;
}

/** Maps requirement text to structured constraints. Must never invent concepts outside the ontology. */
export interface RequirementExtractor {
  extract(
    text: string,
    ontology: Ontology,
  ): Promise<InterpretedRequirement & { readonly method: 'deterministic' | 'ai_assisted' }>;
}

export interface ProposedClaim {
  readonly conceptId: ConceptId;
  readonly predicate: ClaimPredicate;
  readonly qualifiers: Readonly<Record<string, string>>;
  /** Verbatim quote from the source that supports the proposal (grounding). */
  readonly quote: string;
}

export interface ProfileDraft {
  readonly claims: readonly ProposedClaim[];
  readonly suggestedSummary: string | null;
  readonly method: 'deterministic' | 'ai_assisted';
}

/**
 * Drafts structured claims from untrusted supplier material. Output is always
 * a DRAFT for human review; implementations must ground every claim in a quote.
 */
export interface SupplierProfileDraftGenerator {
  generate(input: { readonly sourceText: string; readonly ontology: Ontology }): Promise<ProfileDraft>;
}

// ---------------------------------------------------------------- assets/jobs

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export type ScanResult = { readonly clean: true } | { readonly clean: false; readonly reason: string };

/** Malware/content-safety scanning boundary. Uploaded bytes are untrusted until this passes. */
export interface MalwareScanner {
  scan(bytes: Uint8Array, declaredContentType: string): Promise<ScanResult>;
}

export type ExtractionResult =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unsupported'; readonly reason: string };

export interface TextExtractor {
  extract(bytes: Uint8Array, contentType: string): Promise<ExtractionResult>;
}

export interface AssetUrlSigner {
  /** Short-lived URL for downloading/streaming a stored asset. */
  signedUrl(assetId: AssetId, ttlSeconds: number): string;
}

export const JOB_TYPES = [
  'asset.process',
  'offering.reindex',
  'engagement.notify',
  'engagement.response_notify',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export interface JobPayloads {
  'asset.process': { readonly assetId: AssetId };
  'offering.reindex': { readonly offeringId: OfferingId };
  'engagement.notify': { readonly engagementId: string };
  'engagement.response_notify': { readonly engagementId: string };
}

export interface EnqueueOptions {
  /** Jobs with the same key that are still queued are not enqueued twice. */
  readonly dedupeKey?: string;
  readonly runAt?: Date;
  readonly maxAttempts?: number;
}

export interface JobQueue {
  enqueue<T extends JobType>(type: T, payload: JobPayloads[T], options?: EnqueueOptions): Promise<void>;
}

// ------------------------------------------------------------- confirmations

export interface ConfirmationClaims {
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
  readonly action: string;
  /** SHA-256 digest of the canonical payload that the user reviewed. */
  readonly digest: string;
}

/**
 * Signs short-lived confirmation tokens for consequential actions. A token
 * binds the user, the action and the exact payload they previewed.
 */
export interface ConfirmationTokens {
  issue(claims: ConfirmationClaims, ttlSeconds: number): Promise<{ token: string; expiresAt: Date }>;
  verify(token: string): Promise<ConfirmationClaims>;
}

// ------------------------------------------------------------------- email

/** Plain-text email only: no HTML rendering of user-supplied text, so no injection surface. */
export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  send(message: OutgoingEmail): Promise<void>;
}
