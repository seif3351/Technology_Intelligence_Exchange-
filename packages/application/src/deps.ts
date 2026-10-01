import type { Repositories, TransactionRunner } from './ports/repositories';
import type {
  AssetUrlSigner,
  Clock,
  ConfirmationTokens,
  EmbeddingProvider,
  JobQueue,
  MalwareScanner,
  ObjectStorage,
  OntologyProvider,
  RequirementExtractor,
  SearchIndex,
  SupplierProfileDraftGenerator,
  TextExtractor,
} from './ports/services';
import type { Telemetry } from './ports/telemetry';

export interface FeatureFlags {
  /** Consequential buyer actions (engagement requests, requirement publication). Off by default. */
  readonly engagementActions: boolean;
}

/** Everything the use cases need, passed explicitly (no service locator). */
export interface ApplicationDeps {
  readonly repos: Repositories;
  readonly transaction: TransactionRunner;
  readonly ontology: OntologyProvider;
  readonly searchIndex: SearchIndex;
  /** Null when no embedding provider is configured; search then runs keyword + structured only. */
  readonly embeddings: EmbeddingProvider | null;
  readonly requirementExtractor: RequirementExtractor;
  readonly profileDraftGenerator: SupplierProfileDraftGenerator;
  readonly storage: ObjectStorage;
  readonly scanner: MalwareScanner;
  readonly textExtractor: TextExtractor;
  readonly assetUrls: AssetUrlSigner;
  readonly jobs: JobQueue;
  readonly confirmations: ConfirmationTokens;
  readonly clock: Clock;
  readonly telemetry: Telemetry;
  readonly features: FeatureFlags;
}
