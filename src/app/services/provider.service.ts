import { Injectable, signal, computed } from '@angular/core';
import { ProviderConfig, ProviderModel, ProviderType, PROVIDER_PRESETS } from '../models/provider.model';

@Injectable({
  providedIn: 'root',
})
export class ProviderService {
  private storageKey = 'nexus-providers';

  providers = signal<ProviderConfig[]>(this.loadProviders());
  models = signal<ProviderModel[]>([]);
  isLoadingModels = signal<boolean>(false);
  connectionErrors = signal<Record<string, string>>({});

  enabledProviders = computed(() => this.providers().filter((p) => p.enabled));

  activeProvider = computed(() => {
    const enabled = this.enabledProviders();
    return enabled.length > 0 ? enabled[0] : null;
  });

  private loadProviders(): ProviderConfig[] {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
    // Default: just Ollama
    return [
      {
        id: 'ollama-default',
        type: 'ollama' as ProviderType,
        name: 'Ollama (Local)',
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        enabled: true,
        preset: 'ollama',
      },
    ];
  }

  saveProviders(providers: ProviderConfig[]): void {
    this.providers.set(providers);
    localStorage.setItem(this.storageKey, JSON.stringify(providers));
  }

  addProvider(preset: string): ProviderConfig {
    const presetConfig = PROVIDER_PRESETS[preset];
    const provider: ProviderConfig = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      type: presetConfig?.type || 'openai-compatible',
      name: presetConfig?.name || 'Custom Provider',
      baseUrl: presetConfig?.baseUrl || '',
      apiKey: presetConfig?.apiKey || '',
      enabled: true,
      preset: preset as any,
    };
    this.providers.update((p) => [...p, provider]);
    this.saveProviders(this.providers());
    return provider;
  }

  updateProvider(id: string, updates: Partial<ProviderConfig>): void {
    this.providers.update((providers) =>
      providers.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
    this.saveProviders(this.providers());
  }

  removeProvider(id: string): void {
    this.providers.update((p) => p.filter((prov) => prov.id !== id));
    this.saveProviders(this.providers());
    // Remove models from this provider
    this.models.update((m) => m.filter((model) => model.providerId !== id));
  }

  getProviderById(id: string): ProviderConfig | undefined {
    return this.providers().find((p) => p.id === id);
  }

  async fetchAllModels(): Promise<void> {
    this.isLoadingModels.set(true);
    const allModels: ProviderModel[] = [];
    const errors: Record<string, string> = {};

    const promises = this.enabledProviders().map(async (provider) => {
      try {
        const models = await this.fetchModelsForProvider(provider);
        allModels.push(...models);
      } catch (error: any) {
        errors[provider.id] = error.message || 'Failed to fetch models';
      }
    });

    await Promise.all(promises);
    this.models.set(allModels);
    this.connectionErrors.set(errors);
    this.isLoadingModels.set(false);
  }

  async fetchModelsForProvider(provider: ProviderConfig): Promise<ProviderModel[]> {
    if (provider.type === 'ollama') {
      return this.fetchOllamaModels(provider);
    } else {
      return this.fetchOpenAIModels(provider);
    }
  }

  // ---- Ollama API ----

  private async fetchOllamaModels(provider: ProviderConfig): Promise<ProviderModel[]> {
    const response = await fetch(`${provider.baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
    const data = await response.json();
    return (data.models || []).map((m: any) => ({
      id: m.name,
      name: m.name,
      providerId: provider.id,
      providerName: provider.name,
      size: this.formatSize(m.size),
      paramSize: this.extractParamSize(m),
    }));
  }

  // ---- OpenAI-compatible API (OpenRouter, OpenAI, Groq, etc.) ----

  private async fetchOpenAIModels(provider: ProviderConfig): Promise<ProviderModel[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.apiKey) {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }

    const response = await fetch(`${provider.baseUrl}/models`, { headers });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Invalid API key');
      throw new Error(`API error: ${response.statusText}`);
    }
    const data = await response.json();
    return (data.data || []).map((m: any) => {
      const contextLen = m.context_window || m.context_length;
      return {
        id: m.id,
        name: this.formatOpenAIModelName(m.id),
        providerId: provider.id,
        providerName: provider.name,
        contextLength: contextLen,
        // For OpenAI-compatible providers, we try to extract param size from ID
        // and show context as well if available
        paramSize: this.extractParamSizeFromId(m.id),
        size: contextLen ? `${Math.round(contextLen / 1024)}k` : 'Cloud'
      };
    });
  }

  // ---- Chat API ----

  async *streamChat(
    providerId: string,
    model: string,
    messages: { role: string; content: string; images?: string[] }[],
    temperature: number,
    abortSignal?: AbortSignal
  ): AsyncGenerator<{ content: string; done: boolean; stats?: any }> {
    const provider = this.getProviderById(providerId);
    if (!provider) throw new Error('Provider not found');

    if (provider.type === 'ollama') {
      yield* this.streamOllamaChat(provider, model, messages, temperature, abortSignal);
    } else {
      yield* this.streamOpenAIChat(provider, model, messages, temperature, abortSignal);
    }
  }

  private async *streamOllamaChat(
    provider: ProviderConfig,
    model: string,
    messages: { role: string; content: string; images?: string[] }[],
    temperature: number,
    abortSignal?: AbortSignal
  ): AsyncGenerator<{ content: string; done: boolean; stats?: any }> {
    const response = await fetch(`${provider.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { temperature },
      }),
      signal: abortSignal,
    });

    if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            yield {
              content: parsed.message?.content || '',
              done: parsed.done || false,
              stats: parsed.done ? {
                eval_count: parsed.eval_count,
                eval_duration: parsed.eval_duration,
                total_duration: parsed.total_duration,
              } : undefined,
            };
          } catch { /* skip malformed */ }
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        yield {
          content: parsed.message?.content || '',
          done: parsed.done || false,
          stats: parsed.done ? {
            eval_count: parsed.eval_count,
            eval_duration: parsed.eval_duration,
            total_duration: parsed.total_duration,
          } : undefined,
        };
      } catch { /* skip */ }
    }
  }

  private async *streamOpenAIChat(
    provider: ProviderConfig,
    model: string,
    messages: { role: string; content: string; images?: string[] }[],
    temperature: number,
    abortSignal?: AbortSignal
  ): AsyncGenerator<{ content: string; done: boolean; stats?: any }> {
    const formattedMessages = messages.map(msg => {
      if (msg.images && msg.images.length > 0) {
        const content: any[] = [{ type: 'text', text: msg.content }];
        msg.images.forEach(img => {
          // Detect mime type or default to image/jpeg
          const mimeType = img.startsWith('data:') ? img.split(';')[0].split(':')[1] : 'image/jpeg';
          const base64 = img.includes('base64,') ? img.split('base64,')[1] : img;
          content.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` }
          });
        });
        return { role: msg.role, content };
      }
      return { role: msg.role, content: msg.content };
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (provider.apiKey) {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }
    // OpenRouter specific headers
    if (provider.preset === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin;
      headers['X-Title'] = 'NexusAI Chat';
    }

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: true,
        temperature,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`API error (${response.status}): ${errBody || response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalTokens = 0;
    const startTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          const elapsed = Date.now() - startTime;
          yield {
            content: '',
            done: true,
            stats: {
              eval_count: totalTokens,
              total_duration: elapsed * 1_000_000, // convert ms to ns for consistency
              eval_duration: elapsed * 1_000_000,
            },
          };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            totalTokens++;
            yield { content: delta, done: false };
          }
        } catch { /* skip malformed SSE */ }
      }
    }

    // Final yield if no [DONE] received
    const elapsed = Date.now() - startTime;
    yield {
      content: '',
      done: true,
      stats: {
        eval_count: totalTokens,
        total_duration: elapsed * 1_000_000,
        eval_duration: elapsed * 1_000_000,
      },
    };
  }

  async chat(
    providerId: string,
    model: string,
    messages: { role: string; content: string }[],
    temperature: number
  ): Promise<{ content: string; stats?: any }> {
    const provider = this.getProviderById(providerId);
    if (!provider) throw new Error('Provider not found');

    if (provider.type === 'ollama') {
      return this.ollamaChat(provider, model, messages, temperature);
    } else {
      return this.openAIChat(provider, model, messages, temperature);
    }
  }

  private async ollamaChat(
    provider: ProviderConfig,
    model: string,
    messages: { role: string; content: string }[],
    temperature: number
  ): Promise<{ content: string; stats?: any }> {
    const response = await fetch(`${provider.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, options: { temperature } }),
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
    const data = await response.json();
    return {
      content: data.message.content,
      stats: {
        eval_count: data.eval_count,
        eval_duration: data.eval_duration,
        total_duration: data.total_duration,
      },
    };
  }

  private async openAIChat(
    provider: ProviderConfig,
    model: string,
    messages: { role: string; content: string }[],
    temperature: number
  ): Promise<{ content: string; stats?: any }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.apiKey) {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }
    if (provider.preset === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin;
      headers['X-Title'] = 'NexusAI Chat';
    }

    const startTime = Date.now();
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, temperature }),
    });
    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
    const data = await response.json();
    const elapsed = Date.now() - startTime;

    return {
      content: data.choices?.[0]?.message?.content || '',
      stats: {
        eval_count: data.usage?.completion_tokens,
        total_duration: elapsed * 1_000_000,
        eval_duration: elapsed * 1_000_000,
      },
    };
  }

  // ---- Helpers ----

  private formatSize(bytes: number): string {
    const numBytes = Number(bytes);
    if (!numBytes || isNaN(numBytes) || numBytes < 1024 * 1024) return 'Cloud';
    const gb = numBytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = numBytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  }

  private extractParamSize(model: any): string {
    if (model.details?.parameter_size) return model.details.parameter_size;
    return this.extractParamSizeFromId(model.name || model.id) || '';
  }

  private extractParamSizeFromId(id: string): string | undefined {
    if (!id) return undefined;
    // Match patterns like "70b", "8x7b", "405b", "86m"
    const match = id.match(/(\d+x)?\d+(\.\d+)?[bBmM]/i);
    return match ? match[0].toUpperCase() : undefined;
  }

  private formatOpenAIModelName(id: string): string {
    const parts = id.split('/');
    const name = parts[parts.length - 1];
    return name
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async deleteOllamaModel(providerId: string, modelName: string): Promise<void> {
    const provider = this.getProviderById(providerId);
    if (!provider) throw new Error('Provider not found');

    const response = await fetch(`${provider.baseUrl}/api/delete`, {
      method: 'DELETE',
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) throw new Error(`Failed to delete model: ${response.statusText}`);
    await this.fetchAllModels();
  }

  async *pullOllamaModel(providerId: string, modelName: string): AsyncIterator<{ status: string; completed?: number; total?: number }> {
    const provider = this.getProviderById(providerId);
    if (!provider) throw new Error('Provider not found');

    const response = await fetch(`${provider.baseUrl}/api/pull`, {
      method: 'POST',
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) throw new Error(`Failed to pull model: ${response.statusText}`);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            yield parsed;
          } catch { /* skip */ }
        }
      }
    }
    
    await this.fetchAllModels();
  }
}
