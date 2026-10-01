/**
 * Reciprocal Rank Fusion of several ranked candidate lists (keyword,
 * semantic, structured). RRF is robust to incomparable raw scores, which is
 * exactly the situation when fusing ts_rank with cosine similarity.
 */
export const RRF_K = 60;

export interface RankedList {
  readonly source: string;
  readonly ids: readonly string[];
}

export interface FusedCandidate {
  readonly id: string;
  readonly rrf: number;
  /** rrf normalized to 0..1 against the best possible score for the given lists. */
  readonly relevance: number;
  readonly sources: readonly string[];
}

export const reciprocalRankFusion = (lists: readonly RankedList[]): FusedCandidate[] => {
  const scores = new Map<string, { rrf: number; sources: string[] }>();
  for (const list of lists) {
    list.ids.forEach((id, index) => {
      const entry = scores.get(id) ?? { rrf: 0, sources: [] };
      entry.rrf += 1 / (RRF_K + index + 1);
      entry.sources.push(list.source);
      scores.set(id, entry);
    });
  }
  const nonEmpty = lists.filter((list) => list.ids.length > 0).length;
  const best = nonEmpty === 0 ? 1 : nonEmpty / (RRF_K + 1);
  return [...scores.entries()]
    .map(([id, entry]) => ({
      id,
      rrf: entry.rrf,
      relevance: Math.min(1, entry.rrf / best),
      sources: entry.sources,
    }))
    .sort((a, b) => b.rrf - a.rrf || a.id.localeCompare(b.id));
};
