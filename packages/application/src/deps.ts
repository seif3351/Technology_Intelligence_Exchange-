import type { Repositories, TransactionRunner } from './ports/repositories';
import type {
  AccessTokenSigner,
  AssetUrlSigner,
  Clock,
  ConfirmationTokens,
  EmbeddingProvider,
  JobQueue,
  Mailer,
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

/** Platform-wide operating settings (from configuration). */
export interface PlatformSettings {
  /** `invite`: accounts can only be created with a valid invitation (pilot default). */
  readonly registrationMode: 'open' | 'invite';
  /** Version identifier of the terms of use users must accept at registration. */
  readonly termsVersion: string;
  /** Base URL of the web application, used to build links in invitations and emails. */
  readonly publicWebUrl: string;
  /** The MCP server's resource identifier (token audience for agent tokens). */
  readonly mcpResourceUrl: string;
  /** The HTTP API's resource identifier (token audience for web sessions). */
  readonly apiResourceUrl: string;
  /** Issuer identifier of the built-in OAuth authorization server. */
  readonly oauthIssuer: string;
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
  /** Delivery of account emails; may be disabled (sending then throws and callers degrade). */
  readonly mailer: Mailer;
  readonly confirmations: ConfirmationTokens;
  readonly tokenSigner: AccessTokenSigner;
  readonly clock: Clock;
  readonly telemetry: Telemetry;
  readonly features: FeatureFlags;
  readonly settings: PlatformSettings;
}
