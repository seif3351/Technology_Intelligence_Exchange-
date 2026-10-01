import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { LlmUnavailableError, type StructuredLlm, UNTRUSTED_CONTENT_RULES, delimitUntrusted } from './llm';

export interface AnthropicLlmOptions {
  readonly apiKey: string;
  /** Defaults to Claude Opus 5.5. */
  readonly model?: string;
  readonly effort?: 'low' | 'medium' | 'high';
  readonly timeoutMs?: number;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/**
 * Anthropic adapter using structured outputs (output_config.format with a Zod
 * schema) so responses are schema-validated by the SDK. Server-side refusal
 * fallbacks are enabled ("default" routing). Any refusal, truncation or
 * parse failure surfaces as LlmUnavailableError so callers degrade gracefully.
 */
export const createAnthropicLlm = (options: AnthropicLlmOptions): StructuredLlm => {
  const client = new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 60_000, maxRetries: 2 });
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  return {
    name: `anthropic:${model}`,
    async generate<T extends z.ZodType>(request: {
      readonly system: string;
      readonly instructions: string;
      readonly untrustedContent: string;
      readonly schema: T;
      readonly maxOutputTokens: number;
    }): Promise<z.infer<T>> {
      let response;
      try {
        response = await client.beta.messages.parse({
          model,
          max_tokens: request.maxOutputTokens,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: `${request.system}\n\n${UNTRUSTED_CONTENT_RULES}`,
          output_config: { effort: options.effort ?? 'low', format: betaZodOutputFormat(request.schema) },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: request.instructions },
                { type: 'text', text: delimitUntrusted(request.untrustedContent) },
              ],
            },
          ],
        });
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          throw new LlmUnavailableError(`Anthropic API error ${error.status ?? 'network'}`);
        }
        throw error;
      }
      if (response.stop_reason === 'refusal') throw new LlmUnavailableError('Model declined the request');
      if (response.stop_reason === 'max_tokens') throw new LlmUnavailableError('Model output was truncated');
      if (response.parsed_output === null || response.parsed_output === undefined) {
        throw new LlmUnavailableError('Model output did not match the schema');
      }
      return response.parsed_output as z.infer<T>;
    },
  };
};
