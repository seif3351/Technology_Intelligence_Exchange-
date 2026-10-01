import type { Repositories, TransactionRunner } from '@atx/application';
import type pg from 'pg';
import { type Queryable, withTransaction } from '../db';
import { createAuditLog, createEngagementRepository, createRequirementRepository } from './buyers';
import {
  createAssetRepository,
  createCapabilityRepository,
  createClaimRepository,
  createEvidenceRepository,
  createOfferingRepository,
} from './catalog';
import { createOrganizationRepository, createUserRepository } from './organizations';

export const createRepositories = (db: Queryable): Repositories => ({
  organizations: createOrganizationRepository(db),
  users: createUserRepository(db),
  offerings: createOfferingRepository(db),
  claims: createClaimRepository(db),
  capabilities: createCapabilityRepository(db),
  evidence: createEvidenceRepository(db),
  assets: createAssetRepository(db),
  requirements: createRequirementRepository(db),
  engagements: createEngagementRepository(db),
  audit: createAuditLog(db),
});

export const createTransactionRunner =
  (pool: pg.Pool): TransactionRunner =>
  (work) =>
    withTransaction(pool, (client) => work(createRepositories(client)));
