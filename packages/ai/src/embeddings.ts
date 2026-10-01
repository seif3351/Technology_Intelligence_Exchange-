import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from '@atx/application';
import { normalizeForMatching } from '@atx/domain';

/**
 * Deterministic local embedding via feature hashing of word unigrams,
 * bigrams and character trigrams. No network, no model download, fully
 * reproducible — a useful semantic-ish signal for development and as an
 * offline fallback. Swap for a learned model in production via config.
 */
export const createHashingEmbeddingProvider = (dimensions = 384): EmbeddingProvider => ({
  model: `hashing-v1-${dimensions}`,
  async embed(texts) {
    return texts.map((text) => hashEmbed(text, dimensions));
  },
});

const bucket = (feature: string, dimensions: number): { index: number; sign: number } => {
  const digest = createHash('md5').update(feature).digest();
  return { index: digest.readUInt32LE(0) % dimensions, sign: (digest[4] ?? 0) & 1 ? 1 : -1 };
};

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'we', 'i', 'need', 'that', 'can', 'is', 'are', 'our', 'be', 'by', 'it', 'this', 'from', 'as', 'at', 'using']);

export const hashEmbed = (text: string, dimensions: number): number[] => {
  const vector = new Array<number>(dimensions).fill(0);
  const words = normalizeForMatching(text).split(' ').filter((word) => word && !STOPWORDS.has(word));
  const add = (feature: string, weight: number) => {
    const { index, sign } = bucket(feature, dimensions);
    vector[index] = (vector[index] ?? 0) + sign * weight;
  };
  words.forEach((word, i) => {
    add(`w:${word}`, 1);
    const next = words[i + 1];
    if (next) add(`b:${word} ${next}`, 0.7);
    const padded = `^${word}$`;
    for (let j = 0; j + 3 <= padded.length; j++) add(`c:${padded.slice(j, j + 3)}`, 0.25);
  });
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
};

/** OpenAI-compatible /v1/embeddings endpoint (OpenAI, Azure OpenAI, vLLM, Ollama, ...). */
export const createHttpEmbeddingProvider = (options: { readonly baseUrl: string; readonly apiKey: string | null; readonly model: string; readonly timeoutMs?: number }): EmbeddingProvider => ({
  model: options.model,
  async embed(texts) {
    const response = await fetch(new URL('embeddings', options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
      body: JSON.stringify({ model: options.model, input: texts }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`);
    const body = (await response.json()) as { data?: { embedding?: unknown; index?: number }[] };
    const data = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== texts.length || data.some((item) => !Array.isArray(item.embedding))) {
      throw new Error('Embedding provider returned a malformed response');
    }
    return data.map((item) => (item.embedding as unknown[]).map(Number));
  },
});
