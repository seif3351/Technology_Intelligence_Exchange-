import type {
  AccessGrant,
  AccessGrantId,
  Asset,
  AssetId,
  AuditEvent,
  Capability,
  ClaimId,
  ConceptId,
  EngagementId,
  EngagementRequest,
  Evidence,
  EvidenceId,
  Invitation,
  OAuthAuthorizationCode,
  OAuthClient,
  OAuthRefreshToken,
  InvitationId,
  Membership,
  Offering,
  OfferingId,
  OfferingStatus,
  Organization,
  OrganizationId,
  OrganizationRole,
  OrganizationVerificationState,
  Requirement,
  RequirementId,
  TechnicalClaim,
  User,
  UserId,
  UserToken,
  UserTokenId,
  UserTokenPurpose,
} from '@atx/domain';
import type { PrincipalMembership, TenantScope } from '../principal';

/**
 * Persistence ports. Implemented in @atx/infrastructure. Methods that touch
 * tenant-private data take a TenantScope, which can only be minted by the
 * authorization policy — this makes accidental cross-tenant queries a type error.
 *
 * `update` methods take the version the caller read and throw CONFLICT when the
 * stored version differs (optimistic concurrency).
 */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface OrganizationRepository {
  findById(id: OrganizationId): Promise<Organization | null>;
  findBySlug(slug: string): Promise<Organization | null>;
  findManyByIds(ids: readonly OrganizationId[]): Promise<Organization[]>;
  searchSuppliers(query: {
    readonly text: string | null;
    readonly conceptIds: readonly ConceptId[];
    readonly limit: number;
    readonly offset: number;
  }): Promise<{ items: Organization[]; total: number }>;
  listByVerificationState(state: OrganizationVerificationState, limit: number): Promise<Organization[]>;
  insert(organization: Organization): Promise<void>;
  update(organization: Organization, expectedVersion: number): Promise<void>;
}

export interface UserCredential {
  readonly user: User;
  readonly passwordHash: string;
}

export interface MemberRecord {
  readonly userId: UserId;
  readonly displayName: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly createdAt: Date;
}

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findCredentialByEmail(email: string): Promise<UserCredential | null>;
  insert(user: User, passwordHash: string): Promise<void>;
  setPlatformRole(userId: UserId, role: User['platformRole']): Promise<void>;
  markEmailVerified(userId: UserId, at: Date): Promise<void>;
  /** Replaces the password hash and invalidates every access token issued before `at`. */
  updatePassword(userId: UserId, passwordHash: string, at: Date): Promise<void>;
  /** Invalidates every access token issued before `at` ("sign out everywhere"). */
  revokeAllTokens(userId: UserId, at: Date): Promise<void>;
  listMemberships(userId: UserId): Promise<PrincipalMembership[]>;
  addMembership(membership: Membership): Promise<void>;
  listMembers(scope: TenantScope): Promise<MemberRecord[]>;
  findMemberRole(scope: TenantScope, userId: UserId): Promise<OrganizationRole | null>;
  countOwners(scope: TenantScope): Promise<number>;
  updateMembershipRole(scope: TenantScope, userId: UserId, role: OrganizationRole): Promise<void>;
  removeMembership(scope: TenantScope, userId: UserId): Promise<void>;
}

export interface OfferingRepository {
  findById(id: OfferingId): Promise<Offering | null>;
  findPublishedByIds(ids: readonly OfferingId[]): Promise<Offering[]>;
  listPublishedByOrganization(organizationId: OrganizationId): Promise<Offering[]>;
  listForTenant(scope: TenantScope, statuses?: readonly OfferingStatus[]): Promise<Offering[]>;
  listAllPublishedIds(): Promise<OfferingId[]>;
  insert(scope: TenantScope, offering: Offering): Promise<void>;
  update(scope: TenantScope, offering: Offering, expectedVersion: number): Promise<void>;
}

export interface ClaimRepository {
  findById(id: ClaimId): Promise<TechnicalClaim | null>;
  /**
   * Published claims relevant to the given offerings: claims about the
   * offerings themselves plus organization- and capability-level claims of
   * their owning organizations.
   */
  listPublishedForOfferings(offeringIds: readonly OfferingId[]): Promise<TechnicalClaim[]>;
  listPublishedForOrganization(organizationId: OrganizationId): Promise<TechnicalClaim[]>;
  listForTenant(
    scope: TenantScope,
    filter: { readonly status?: TechnicalClaim['status']; readonly offeringId?: OfferingId },
  ): Promise<TechnicalClaim[]>;
  listAwaitingPlatformReview(limit: number): Promise<TechnicalClaim[]>;
  countPublishedOfferingsByConcept(conceptIds: readonly ConceptId[]): Promise<Map<ConceptId, number>>;
  insert(scope: TenantScope, claim: TechnicalClaim): Promise<void>;
  update(scope: TenantScope, claim: TechnicalClaim, expectedVersion: number): Promise<void>;
}

export interface CapabilityRepository {
  listPublishedByOrganization(organizationId: OrganizationId): Promise<Capability[]>;
  listForTenant(scope: TenantScope): Promise<Capability[]>;
  insert(scope: TenantScope, capability: Capability): Promise<void>;
}

export interface EvidenceRepository {
  findById(id: EvidenceId): Promise<Evidence | null>;
  findManyByIds(ids: readonly EvidenceId[]): Promise<Evidence[]>;
  listPublicForOfferings(offeringIds: readonly OfferingId[]): Promise<Evidence[]>;
  listPublicForOrganization(organizationId: OrganizationId): Promise<Evidence[]>;
  listForTenant(scope: TenantScope): Promise<Evidence[]>;
  offeringsWithProductionReferences(offeringIds: readonly OfferingId[]): Promise<Set<OfferingId>>;
  findByAsset(assetId: AssetId): Promise<Evidence | null>;
  insert(scope: TenantScope, evidence: Evidence): Promise<void>;
}

export interface VideoQuery {
  readonly offeringIds: readonly OfferingId[] | null;
  readonly text: string | null;
  readonly limit: number;
}

export interface AssetRepository {
  findById(id: AssetId): Promise<Asset | null>;
  listPublicVideos(query: VideoQuery): Promise<Asset[]>;
  listPublicForOfferings(offeringIds: readonly OfferingId[]): Promise<Asset[]>;
  listForTenant(scope: TenantScope): Promise<Asset[]>;
  insert(scope: TenantScope, asset: Asset): Promise<void>;
  /** Used by the ingestion pipeline (system principal) to advance processing state. */
  save(asset: Asset): Promise<void>;
}

export interface RequirementRepository {
  findById(scope: TenantScope, id: RequirementId): Promise<Requirement | null>;
  listForTenant(scope: TenantScope): Promise<Requirement[]>;
  insert(scope: TenantScope, requirement: Requirement): Promise<void>;
  update(scope: TenantScope, requirement: Requirement, expectedVersion: number): Promise<void>;
  recordDemandSignal(
    scope: TenantScope,
    requirementId: RequirementId,
    conceptIds: readonly ConceptId[],
    minimumMaturity: string | null,
  ): Promise<void>;
  listDemandSignals(limit: number): Promise<{ conceptId: ConceptId; requirementCount: number }[]>;
}

export interface EngagementRepository {
  findById(id: EngagementId): Promise<EngagementRequest | null>;
  findByIdempotencyKey(buyerScope: TenantScope, key: string): Promise<EngagementRequest | null>;
  listForBuyer(scope: TenantScope): Promise<EngagementRequest[]>;
  listForSupplier(scope: TenantScope): Promise<EngagementRequest[]>;
  insert(scope: TenantScope, engagement: EngagementRequest): Promise<void>;
  /** Persists a status change (and supplier response) only if the stored status is still `from`; else CONFLICT. */
  updateStatus(engagement: EngagementRequest, from: EngagementRequest['status']): Promise<void>;
}

export interface AuditQuery {
  readonly organizationId: OrganizationId | null;
  readonly action: string | null;
  readonly limit: number;
  readonly before: Date | null;
}

export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
  list(query: AuditQuery): Promise<AuditEvent[]>;
}

export interface InvitationRepository {
  insert(invitation: Invitation): Promise<void>;
  findById(id: InvitationId): Promise<Invitation | null>;
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
  /** Accepts only a still-pending invitation; false when it was already used, revoked or expired. */
  markAccepted(id: InvitationId, userId: UserId, now: Date): Promise<boolean>;
  /** Revokes only a still-pending invitation; false otherwise. */
  revoke(id: InvitationId, now: Date): Promise<boolean>;
  /** Platform (sign-up) invitations, newest first. Platform administrators only. */
  listPlatform(limit: number): Promise<Invitation[]>;
  listForOrganization(scope: TenantScope): Promise<Invitation[]>;
}

export interface OAuthRepository {
  insertClient(client: OAuthClient): Promise<void>;
  findClient(clientId: string): Promise<OAuthClient | null>;
  insertCode(code: OAuthAuthorizationCode): Promise<void>;
  findCode(codeHash: string): Promise<OAuthAuthorizationCode | null>;
  /** Marks an unused code as used; false if it was used before (replay). */
  markCodeUsed(codeHash: string, at: Date): Promise<boolean>;
  insertRefreshToken(token: OAuthRefreshToken): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<OAuthRefreshToken | null>;
  /** Marks an unused refresh token as used (rotation); false if it was used before (reuse). */
  markRefreshTokenUsed(tokenHash: string, at: Date): Promise<boolean>;
}

export interface AccessGrantRepository {
  insert(grant: AccessGrant): Promise<void>;
  findById(id: AccessGrantId): Promise<AccessGrant | null>;
  listForUser(userId: UserId, kind: AccessGrant['kind']): Promise<AccessGrant[]>;
  /** Revokes only the user's own, not yet revoked grant; false otherwise. */
  revoke(id: AccessGrantId, userId: UserId, at: Date): Promise<boolean>;
  /** Revokes a grant regardless of who asks (OAuth reuse detection, client revocation). */
  revokeById(id: AccessGrantId, at: Date): Promise<void>;
  /** Records use, at most every few minutes (keeps the hot path cheap). */
  touch(id: AccessGrantId, at: Date): Promise<void>;
}

export interface UserTokenRepository {
  insert(token: UserToken): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<UserToken | null>;
  /** Marks a still-unused token as used; false if it was already used. */
  markUsed(id: UserTokenId, at: Date): Promise<boolean>;
  countCreatedSince(userId: UserId, purpose: UserTokenPurpose, since: Date): Promise<number>;
  /** Marks every unused token of this purpose as used (e.g. after a successful reset). */
  invalidateAll(userId: UserId, purpose: UserTokenPurpose, at: Date): Promise<void>;
}

export interface Repositories {
  readonly organizations: OrganizationRepository;
  readonly users: UserRepository;
  readonly invitations: InvitationRepository;
  readonly userTokens: UserTokenRepository;
  readonly accessGrants: AccessGrantRepository;
  readonly oauth: OAuthRepository;
  readonly offerings: OfferingRepository;
  readonly claims: ClaimRepository;
  readonly capabilities: CapabilityRepository;
  readonly evidence: EvidenceRepository;
  readonly assets: AssetRepository;
  readonly requirements: RequirementRepository;
  readonly engagements: EngagementRepository;
  readonly audit: AuditLog;
}

/** Runs `work` in a single database transaction with transaction-bound repositories. */
export type TransactionRunner = <T>(work: (repositories: Repositories) => Promise<T>) => Promise<T>;
