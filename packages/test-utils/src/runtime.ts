import path from 'node:path';
import type { RequestContext, UserPrincipal } from '@atx/application';
import { loadConfig } from '@atx/config';
import { asId } from '@atx/domain';
import { migrate } from '@atx/infrastructure';
import { type Runtime, createRuntime, seedDemoData, seedOntology, stableUuid } from '@atx/runtime';
import { REPO_ROOT } from './ontology';

export const TEST_DATABASE_URL = process.env['DATABASE_URL_TEST'] ?? 'postgres://atx:atx@localhost:5432/atx_test';

/**
 * Creates a runtime bound to a freshly reset test database with migrations,
 * the ontology and the synthetic demo data loaded. Integration tests only.
 */
export const createTestRuntime = async (overrides: Record<string, string> = {}): Promise<Runtime> => {
  const env = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    STORAGE_DIR: path.join(REPO_ROOT, '.var/test-storage'),
    AUTH_DEV_KEY_FILE: path.join(REPO_ROOT, '.var/test-signing-key.json'),
    FEATURE_ENGAGEMENT_ACTIONS: 'true',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    ...overrides,
  });
  const runtime = await createRuntime(env, 'atx-test');
  await runtime.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(runtime.pool);
  await seedOntology(runtime, path.join(REPO_ROOT, 'data/ontology'));
  await seedDemoData(runtime, path.join(REPO_ROOT, 'data/seed/demo.yaml'));
  return runtime;
};

/** Well-known ids of the synthetic demo dataset. */
export const DEMO = {
  users: {
    admin: asId<'UserId'>(stableUuid('user:admin')),
    buyer: asId<'UserId'>(stableUuid('user:buyer')),
    vectorforge: asId<'UserId'>(stableUuid('user:vectorforge')),
    northstar: asId<'UserId'>(stableUuid('user:northstar')),
  },
  orgs: {
    aurelia: asId<'OrganizationId'>(stableUuid('org:aurelia')),
    vectorforge: asId<'OrganizationId'>(stableUuid('org:vectorforge')),
    northstar: asId<'OrganizationId'>(stableUuid('org:northstar')),
    drivemesh: asId<'OrganizationId'>(stableUuid('org:drivemesh')),
  },
  offerings: {
    vectorforgeMiddleware: asId<'OfferingId'>(stableUuid('offering:vectorforge:vf-mw')),
    northstarItp: asId<'OfferingId'>(stableUuid('offering:northstar:ns-itp')),
    northstarLogs: asId<'OfferingId'>(stableUuid('offering:northstar:ns-logs')),
    drivemeshSim: asId<'OfferingId'>(stableUuid('offering:drivemesh:dm-sim')),
  },
  requirement: asId<'RequirementId'>(stableUuid('requirement:aurelia:0')),
} as const;

export const anonymous: RequestContext = { principal: { kind: 'anonymous', channel: 'api' }, requestId: 'test-anon' };

export const contextFor = async (runtime: Runtime, userId: string, scopes: readonly string[] | 'all' = 'all'): Promise<RequestContext & { principal: UserPrincipal }> => ({
  principal: await runtime.app.identity.principalFor(asId(userId), { channel: 'api', clientId: null, grantedScopes: scopes }),
  requestId: `test-${userId.slice(0, 8)}`,
});
