import type { ProviderStatus } from '../../../../shared/types.js';
import { config } from '../../config.js';
import { fetchWithTimeout } from '../../lib/exec.js';
import { HttpError, ProviderUnavailableError } from '../../lib/errors.js';
import type { LLMProvider, LLMRequest } from '../types.js';

const SETUP = [
  'Install Ollama (free, runs locally): https://ollama.com/download',
  `Pull a model: ollama pull ${config.llm.ollamaModel}  (for Hindi/Marathi quality, larger models such as qwen2.5:14b or llama3.1:70b work better)`,
  'Start it: ollama serve  (default URL http://127.0.0.1:11434)',
  'Optionally set OLLAMA_URL and OLLAMA_MODEL in .env',
];

export class OllamaLLM implements LLMProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (local open-source LLM)';
  readonly kind = 'llm' as const;
  readonly isDemo = false;

  async status(): Promise<ProviderStatus> {
    const base = { id: this.id, name: this.name, kind: 'llm' as const, isDemo: false };
    try {
      const res = await fetchWithTimeout(`${config.llm.ollamaUrl}/api/tags`, {}, 1500);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { models?: { name: string }[] };
      const names = (body.models ?? []).map((m) => m.name);
      const has = names.some((n) => n === config.llm.ollamaModel || n.startsWith(config.llm.ollamaModel + ':'));
      return {
        ...base,
        state: has ? 'ready' : 'not_installed',
        message: has
          ? `Model ${config.llm.ollamaModel} available`
          : `Ollama is running but model "${config.llm.ollamaModel}" is not pulled`,
        setupInstructions: has ? [] : [`ollama pull ${config.llm.ollamaModel}`],
        details: { url: config.llm.ollamaUrl, models: names },
      };
    } catch {
      return { ...base, state: 'unreachable', message: `Ollama not reachable at ${config.llm.ollamaUrl}`, setupInstructions: SETUP };
    }
  }

  async generateJSON<T>(req: LLMRequest): Promise<T> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${config.llm.ollamaUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: config.llm.ollamaModel,
            stream: false,
            format: req.schema,
            options: { temperature: 0.8 },
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.prompt },
            ],
          }),
        },
        10 * 60 * 1000,
      );
    } catch {
      throw new ProviderUnavailableError(`Ollama not reachable at ${config.llm.ollamaUrl}`, SETUP, this.id);
    }
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404) throw new ProviderUnavailableError(`Ollama model not found: ${text}`, SETUP, this.id);
      throw new HttpError(502, `Ollama error ${res.status}: ${text}`, 'LLM_ERROR');
    }
    const body = (await res.json()) as { message?: { content?: string } };
    try {
      return JSON.parse(body.message?.content ?? '') as T;
    } catch {
      throw new HttpError(502, 'Ollama returned invalid JSON. Try a larger model.', 'LLM_BAD_JSON');
    }
  }
}
