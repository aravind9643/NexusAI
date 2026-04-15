// Provider configuration types

export type ProviderType = 'ollama' | 'openai-compatible';

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  // Pre-configured provider presets
  preset?: 'ollama' | 'openrouter' | 'openai' | 'groq' | 'custom';
}

export interface ProviderModel {
  id: string;          // model id (e.g. "gemma4:31b-cloud" or "anthropic/claude-3.5-sonnet")
  name: string;        // display name
  providerId: string;  // which provider this model belongs to
  providerName: string;
  size?: string;       // e.g. "Cloud", "4.1 GB"
  paramSize?: string;  // e.g. "31B", "70B"
  contextLength?: number;
}

// Pre-configured provider presets
export const PROVIDER_PRESETS: Record<string, Partial<ProviderConfig>> = {
  ollama: {
    type: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
  },
  openrouter: {
    type: 'openai-compatible',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  openai: {
    type: 'openai-compatible',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
  },
  groq: {
    type: 'openai-compatible',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
};
