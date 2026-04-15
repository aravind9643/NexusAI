export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[]; // base64 strings
  timestamp: Date;
  model?: string;
  providerName?: string;
  isStreaming?: boolean;
  thinkingContent?: string;
  isThinking?: boolean;
  // Token stats (from Ollama response)
  tokenCount?: number;
  tokensPerSecond?: number;
  totalDuration?: number; // in milliseconds
}

export interface Folder {
  id: string;
  name: string;
  isExpanded?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  providerId: string;
  createdAt: Date;
  updatedAt: Date;
  systemPrompt?: string;
  folderId?: string;
  isPinned?: boolean;
}

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaTagsResponse {
  models: OllamaModel[];
}

export interface OllamaChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  stream?: boolean;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface AppSettings {
  ollamaBaseUrl: string;
  defaultModel: string;
  systemPrompt: string;
  temperature: number;
  streamResponses: boolean;
}
