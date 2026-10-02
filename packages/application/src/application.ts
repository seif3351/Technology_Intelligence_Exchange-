import type { ApplicationDeps } from './deps';
import { AccountService } from './services/account';
import { AdminService } from './services/admin';
import { AgentTokenService } from './services/agent-tokens';
import { CatalogService } from './services/catalog';
import { EngagementService } from './services/engagements';
import { IdentityService, type PasswordHasher } from './services/identity';
import { IndexingService } from './services/indexing';
import { IngestionService } from './services/ingestion';
import { InvitationService } from './services/invitations';
import { MaintenanceService } from './services/maintenance';
import { MatchingService } from './services/matching';
import { MembershipService } from './services/members';
import { OAuthService } from './services/oauth';
import { PublicationService } from './services/publication';
import { RequirementAlertService } from './services/requirement-alerts';
import { RequirementService } from './services/requirements';
import { EvidenceService } from './services/evidence';
import { SupplierService } from './services/supplier';

/** Explicit composition of all use cases. Interfaces (API, MCP, worker, web) depend on this. */
export const createApplication = (deps: ApplicationDeps, passwords: PasswordHasher) => {
  const matching = new MatchingService(deps);
  return {
    deps,
    matching,
    catalog: new CatalogService(deps, matching),
    supplier: new SupplierService(deps),
    evidence: new EvidenceService(deps),
    publication: new PublicationService(deps),
    requirements: new RequirementService(deps),
    requirementAlerts: new RequirementAlertService(deps, matching),
    engagements: new EngagementService(deps),
    admin: new AdminService(deps),
    ingestion: new IngestionService(deps),
    indexing: new IndexingService(deps),
    identity: new IdentityService(deps, passwords),
    account: new AccountService(deps, passwords),
    agentTokens: new AgentTokenService(deps),
    invitations: new InvitationService(deps),
    members: new MembershipService(deps),
    oauth: new OAuthService(deps),
    maintenance: new MaintenanceService(deps),
  };
};

export type Application = ReturnType<typeof createApplication>;
