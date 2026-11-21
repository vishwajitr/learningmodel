import Anthropic from '@anthropic-ai/sdk';
import type { ProviderStatus } from '../../../../shared/types.js';
import { config } from '../../config.js';
import { HttpError, ProviderUnavailableError } from '../../lib/errors.js';
import type { LLMProvider, LLMRequest } from '../types.js';

const SETUP = [
  'Create an API key at https://platform.claude.com and add ANTHROPIC_API_KEY=... to the .env file (server side only).',
  'Optionally set ANTHROPIC_MODEL (default: claude-opus-5-5).',
  'Restart the server: npm run dev',
];

export class AnthropicLLM implements LLMProvider {
  readonly id = 'anthropic';
  readonly name = 'Claude (Anthropic API)';
  readonly kind = 'llm' as const;
  readonly isDemo = false;
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!config.llm.hasAnthropicKey) throw new ProviderUnavailableError('ANTHROPIC_API_KEY is not set.', SETUP, this.id);
    this.client ??= new Anthropic();
    return this.client;
  }

  async status(): Promise<ProviderStatus> {
    const ready = config.llm.hasAnthropicKey;
    return {
      id: this.id,
      name: this.name,
      kind: 'llm',
      state: ready ? 'ready' : 'not_configured',
      isDemo: false,
      message: ready ? `Using model ${config.llm.anthropicModel}` : 'No API key configured',
      setupInstructions: ready ? [] : SETUP,
      details: { model: config.llm.anthropicModel },
    };
  }

  async generateJSON<T>(req: LLMRequest): Promise<T> {
    const client = this.getClient();
    try {
      const stream = client.beta.messages.stream({
        model: config.llm.anthropicModel,
        max_tokens: req.maxTokens ?? 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: req.system,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: req.schema } },
        messages: [{ role: 'user', content: req.prompt }],
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        throw new HttpError(422, 'The model declined this request. Try rephrasing the topic.', 'LLM_REFUSAL');
      }
      if (message.stop_reason === 'max_tokens') {
        throw new HttpError(502, 'The model response was cut off (max_tokens). Try a shorter duration.', 'LLM_TRUNCATED');
      }
      const text = message.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ProviderUnavailableError('Anthropic rejected the API key.', SETUP, this.id);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new HttpError(429, 'Anthropic rate limit reached. Wait a moment and retry.', 'LLM_RATE_LIMIT');
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new ProviderUnavailableError('Could not reach the Anthropic API (network error).', SETUP, this.id);
      }
      if (err instanceof Anthropic.APIError) {
        throw new HttpError(502, `Anthropic API error: ${err.message}`, 'LLM_ERROR');
      }
      if (err instanceof SyntaxError) throw new HttpError(502, 'The model returned invalid JSON.', 'LLM_BAD_JSON');
      throw err;
    }
  }
}
