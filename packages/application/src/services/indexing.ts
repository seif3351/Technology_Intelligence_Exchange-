import { createHash } from 'node:crypto';
import { type OfferingId, isPubliclyListed } from '@atx/domain';
import type { ApplicationDeps } from '../deps';

/**
 * Maintains the derived search index. The index is disposable: it can be
 * rebuilt at any time from canonical relational data (see reindexAll).
 */
export class IndexingService {
  constructor(private readonly deps: ApplicationDeps) {}

  async reindexOffering(offeringId: OfferingId): Promise<'indexed' | 'unchanged' | 'removed'> {
    const offering = await this.deps.repos.offerings.findById(offeringId);
    const organization = offering
      ? await this.deps.repos.organizations.findById(offering.organizationId)
      : null;
    if (!offering || offering.status !== 'published' || !organization || !isPubliclyListed(organization)) {
      await this.deps.searchIndex.remove(offeringId);
      return 'removed';
    }
    const ontology = await this.deps.ontology.current();
    const [claims, capabilities] = await Promise.all([
      this.deps.repos.claims.listPublishedForOfferings([offering.id]),
      this.deps.repos.capabilities.listPublishedByOrganization(offering.organizationId),
    ]);
    const conceptText = claims
      .map((claim) => {
        const concept = ontology.getConcept(claim.conceptId);
        return concept ? `${concept.label} ${concept.aliases.join(' ')} ${claim.statement}` : claim.statement;
      })
      .join('. ');
    const text = [
      offering.name,
      offering.summary,
      offering.description,
      organization.name,
      capabilities.map((capability) => `${capability.name} ${capability.description}`).join('. '),
      conceptText,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 20_000);
    const contentHash = createHash('sha256')
      .update(`${this.deps.embeddings?.model ?? 'none'}\n${text}`)
      .digest('hex');
    const previousHash = await this.deps.searchIndex.currentHash(offering.id);
    if (previousHash === contentHash) return 'unchanged';

    let embedding: { model: string; vector: number[] } | null = null;
    if (this.deps.embeddings) {
      try {
        const [vector] = await this.deps.embeddings.embed([text]);
        if (vector) embedding = { model: this.deps.embeddings.model, vector };
      } catch {
        // Keyword and structured retrieval still work; the next reindex retries.
      }
    }
    await this.deps.searchIndex.upsert({ offeringId: offering.id, text, contentHash, embedding });
    // Newly listed (first time in the index): check watched buyer requirements.
    if (previousHash === null)
      await this.deps.jobs.enqueue(
        'requirement.alerts',
        { offeringId: offering.id },
        { dedupeKey: `requirement-alerts:${offering.id}` },
      );
    return 'indexed';
  }

  async reindexAll(): Promise<{ indexed: number; unchanged: number; removed: number }> {
    const ids = await this.deps.repos.offerings.listAllPublishedIds();
    const counts = { indexed: 0, unchanged: 0, removed: 0 };
    for (const id of ids) counts[await this.reindexOffering(id)] += 1;
    return counts;
  }
}
