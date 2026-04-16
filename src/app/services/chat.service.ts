import { Injectable, signal, computed, inject } from '@angular/core';
import { Conversation, ChatMessage, Folder } from '../models/chat.model';
import { ProviderService } from './provider.service';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private providerService = inject(ProviderService);
  private storageKey = 'ollama-chat-conversations';
  private foldersKey = 'ollama-chat-folders';
  private settingsKey = 'ollama-chat-settings';
  private lastModelKey = 'nexus-last-model';
  private abortController: AbortController | null = null;

  conversations = signal<Conversation[]>(this.loadConversations());
  folders = signal<Folder[]>(this.loadFolders());
  activeConversationId = signal<string | null>(null);
  isGenerating = signal<boolean>(false);
  sidebarCollapsed = signal<boolean>(window.innerWidth <= 768);

  activeConversation = computed(() => {
    const id = this.activeConversationId();
    return this.conversations().find((c) => c.id === id) || null;
  });

  sortedConversations = computed(() => {
    return [...this.conversations()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  });

  // Load settings (kept for backward compat)
  getSettings(): { systemPrompt: string; temperature: number; streamResponses: boolean } {
    const stored = localStorage.getItem(this.settingsKey);
    if (stored) {
      const s = JSON.parse(stored);
      return {
        systemPrompt: s.systemPrompt || 'You are a helpful AI assistant. Be concise and informative.',
        temperature: s.temperature ?? 0.7,
        streamResponses: s.streamResponses ?? true,
      };
    }
    return {
      systemPrompt: 'You are a helpful AI assistant. Be concise and informative.',
      temperature: 0.7,
      streamResponses: true,
    };
  }

  saveSettings(settings: { systemPrompt: string; temperature: number; streamResponses: boolean }): void {
    localStorage.setItem(this.settingsKey, JSON.stringify(settings));
  }

  private loadConversations(): Conversation[] {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      const convs = JSON.parse(stored);
      return convs.map((c: any) => ({
        ...c,
        providerId: c.providerId || 'ollama-default', // backward compat
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        messages: c.messages.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })),
      }));
    }
    return [];
  }

  private loadFolders(): Folder[] {
    const stored = localStorage.getItem(this.foldersKey);
    return stored ? JSON.parse(stored) : [];
  }

  private saveConversations(): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.conversations()));
    localStorage.setItem(this.foldersKey, JSON.stringify(this.folders()));
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  createConversation(model?: string, providerId?: string, folderId?: string): Conversation {
    const lastUsed = this.getLastUsedModel();
    const activeProvider = this.providerService.activeProvider();

    const conversation: Conversation = {
      id: this.generateId(),
      title: 'New Chat',
      messages: [],
      model: model || lastUsed?.model || '',
      providerId: providerId || lastUsed?.providerId || activeProvider?.id || 'ollama-default',
      createdAt: new Date(),
      updatedAt: new Date(),
      folderId
    };
    this.conversations.update((convs) => [conversation, ...convs]);
    this.activeConversationId.set(conversation.id);
    this.saveConversations();
    return conversation;
  }

  // Folder Methods
  createFolder(name: string): void {
    const folder: Folder = { id: this.generateId(), name, isExpanded: true };
    this.folders.update(f => [...f, folder]);
    this.saveConversations();
  }

  updateFolder(id: string, updates: Partial<Folder>): void {
    this.folders.update(folders => folders.map(f => f.id === id ? { ...f, ...updates } : f));
    this.saveConversations();
  }

  deleteFolder(id: string): void {
    this.folders.update(folders => folders.filter(f => f.id !== id));
    // Orphan conversations
    this.conversations.update(convs => convs.map(c => c.folderId === id ? { ...c, folderId: undefined } : c));
    this.saveConversations();
  }

  saveLastUsedModel(model: string, providerId: string): void {
    localStorage.setItem(this.lastModelKey, JSON.stringify({ model, providerId }));
  }

  getLastUsedModel(): { model: string; providerId: string } | null {
    const stored = localStorage.getItem(this.lastModelKey);
    return stored ? JSON.parse(stored) : null;
  }

  setActiveConversation(id: string): void {
    this.activeConversationId.set(id);
  }

  deleteConversation(id: string): void {
    this.conversations.update((convs) => convs.filter((c) => c.id !== id));
    if (this.activeConversationId() === id) {
      const remaining = this.conversations();
      this.activeConversationId.set(remaining.length > 0 ? remaining[0].id : null);
    }
    this.saveConversations();
  }

  renameConversation(id: string, title: string): void {
    this.conversations.update((convs) =>
      convs.map((c) => (c.id === id ? { ...c, title } : c))
    );
    this.saveConversations();
  }

  updateConversation(id: string, updates: Partial<Conversation>): void {
    this.conversations.update((convs) =>
      convs.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
    this.saveConversations();
  }

  updateConversationModel(id: string, model: string, providerId: string): void {
    this.updateConversation(id, { model, providerId });
  }

  togglePin(id: string): void {
    const conv = this.conversations().find(c => c.id === id);
    if (conv) {
      this.updateConversation(id, { isPinned: !conv.isPinned });
    }
  }

  clearAllConversations(): void {
    this.conversations.set([]);
    this.activeConversationId.set(null);
    this.saveConversations();
  }

  editUserMessage(messageId: string): void {
    const conv = this.activeConversation();
    if (!conv) return;

    const msgIndex = conv.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    // Remove this message and all subsequent messages
    const trimmedMessages = conv.messages.slice(0, msgIndex);
    this.conversations.update((convs) =>
      convs.map((c) =>
        c.id === conv.id ? { ...c, messages: trimmedMessages } : c
      )
    );
    this.saveConversations();
  }

  exportConversations(): void {
    const data = JSON.stringify(this.conversations(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexusai-chats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportConversationAsMarkdown(conversationId: string): void {
    const conv = this.conversations().find((c) => c.id === conversationId);
    if (!conv) return;

    let md = `# ${conv.title}\n\n`;
    md += `> Model: ${conv.model} | Created: ${new Date(conv.createdAt).toLocaleString()}\n\n---\n\n`;

    for (const msg of conv.messages) {
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (msg.role === 'user') {
        md += `### 🧑 You (${time})\n\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        md += `### 🤖 Assistant (${time})\n\n${msg.content}\n\n`;
      }
      md += `---\n\n`;
    }

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importConversations(file: File): Promise<number> {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error('Invalid format');

    const convs = imported.map((c: any) => ({
      ...c,
      providerId: c.providerId || 'ollama-default',
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
      messages: (c.messages || []).map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
    }));

    this.conversations.update((existing) => [...existing, ...convs]);
    this.saveConversations();
    return convs.length;
  }

  stopGeneration(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isGenerating.set(false);

    const conv = this.activeConversation();
    if (conv) {
      this.conversations.update((convs) =>
        convs.map((c) => {
          if (c.id === conv.id) {
            return {
              ...c,
              messages: c.messages.map((m) => ({ ...m, isStreaming: false })),
            };
          }
          return c;
        })
      );
      this.saveConversations();
    }
  }

  async sendMessage(content: string, images?: string[], includeThinking = true): Promise<void> {
    let conv = this.activeConversation();
    if (!conv) {
      conv = this.createConversation();
    }

    if (!conv.model) return;

    const userMessage: ChatMessage = {
      id: this.generateId(),
      role: 'user',
      content,
      images,
      timestamp: new Date(),
    };

    this.conversations.update((convs) =>
      convs.map((c) => {
        if (c.id === conv!.id) {
          return { ...c, messages: [...c.messages, userMessage], updatedAt: new Date() };
        }
        return c;
      })
    );

    if (conv.messages.length === 0) {
      const title = content.length > 40 ? content.substring(0, 40) + '...' : content;
      this.renameConversation(conv.id, title);
    }

    const provider = this.providerService.getProviderById(conv.providerId);
    const assistantMessage: ChatMessage = {
      id: this.generateId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      model: conv.model,
      providerName: provider?.name,
      isStreaming: true,
    };

    this.conversations.update((convs) =>
      convs.map((c) => {
        if (c.id === conv!.id) {
          return { ...c, messages: [...c.messages, assistantMessage] };
        }
        return c;
      })
    );

    this.isGenerating.set(true);
    this.abortController = new AbortController();

    try {
      const settings = this.getSettings();
      const updatedConv = this.conversations().find((c) => c.id === conv!.id)!;
      const apiMessages: { role: string; content: string; images?: string[] }[] = [];
      const systemPrompt = updatedConv.systemPrompt || settings.systemPrompt;
      if (systemPrompt) {
        apiMessages.push({ role: 'system', content: systemPrompt });
      }

      for (const msg of updatedConv.messages) {
        if (msg.role !== 'system' && msg.id !== assistantMessage.id) {
          apiMessages.push({
            role: msg.role,
            content: msg.content,
            images: msg.images
          });
        }
      }

      if (settings.streamResponses) {
        let fullContent = '';
        let fullThinking = '';
        let finalStats: any = null;
        let thinkingStartTime: number | null = null;
        let thinkingDuration = 0;

        for await (const chunk of this.providerService.streamChat(
          conv.providerId,
          conv.model,
          apiMessages,
          settings.temperature,
          this.abortController?.signal
        )) {
          // Track thinking duration
          if (chunk.isThinking && !thinkingStartTime) {
            thinkingStartTime = Date.now();
          } else if (!chunk.isThinking && thinkingStartTime && thinkingDuration === 0) {
            thinkingDuration = Date.now() - thinkingStartTime;
          }

          if (chunk.content || chunk.thinkingContent || chunk.isThinking) {
            fullContent += chunk.content || '';
            // Only accumulate thinking if enabled
            if (includeThinking) {
              fullThinking += chunk.thinkingContent || '';
            }
            
            this.conversations.update((convs) =>
              convs.map((c) => {
                if (c.id === conv!.id) {
                  return {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMessage.id
                        ? { 
                            ...m, 
                            content: fullContent, 
                            thinkingContent: fullThinking,
                            isThinking: chunk.isThinking,
                            thinkingDuration: thinkingDuration || (thinkingStartTime ? Date.now() - thinkingStartTime : 0),
                            isStreaming: !chunk.done 
                          }
                        : m
                    ),
                  };
                }
                return c;
              })
            );
          }
          if (chunk.done && chunk.stats) {
            finalStats = chunk.stats;
          }
        }

        const stats = this.extractStats(finalStats);
        this.conversations.update((convs) =>
          convs.map((c) => {
            if (c.id === conv!.id) {
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, isStreaming: false, ...stats }
                    : m
                ),
              };
            }
            return c;
          })
        );
      } else {
        const response = await this.providerService.chat(
          conv!.providerId,
          conv!.model,
          apiMessages,
          settings.temperature
        );
        const stats = this.extractStats(response?.stats);
        this.conversations.update((convs) =>
          convs.map((c) => {
            if (c.id === conv!.id) {
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: response.content, isStreaming: false, ...stats }
                    : m
                ),
              };
            }
            return c;
          })
        );
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Stopped by user
      } else {
        const errorContent = `⚠️ **Error:** ${error.message || 'Failed to get response'}.\n\nCheck your provider settings and make sure the model "${conv.model}" is available.`;
        this.conversations.update((convs) =>
          convs.map((c) => {
            if (c.id === conv!.id) {
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: errorContent, isStreaming: false }
                    : m
                ),
              };
            }
            return c;
          })
        );
      }
    } finally {
      this.isGenerating.set(false);
      this.abortController = null;
      this.saveConversations();
    }
  }

  private extractStats(stats: any): { tokenCount?: number; tokensPerSecond?: number; totalDuration?: number } {
    if (!stats) return {};
    const result: any = {};
    if (stats.eval_count) {
      result.tokenCount = stats.eval_count;
    }
    if (stats.eval_count && stats.eval_duration) {
      const seconds = stats.eval_duration / 1_000_000_000;
      result.tokensPerSecond = Math.round((stats.eval_count / seconds) * 10) / 10;
    }
    if (stats.total_duration) {
      result.totalDuration = Math.round(stats.total_duration / 1_000_000);
    }
    return result;
  }

  async regenerateLastResponse(): Promise<void> {
    const conv = this.activeConversation();
    if (!conv || conv.messages.length < 2 || this.isGenerating()) return;

    const messages = [...conv.messages];
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx === -1) return;

    messages.splice(lastAssistantIdx, 1);
    this.conversations.update((convs) =>
      convs.map((c) => (c.id === conv.id ? { ...c, messages } : c))
    );

    const provider = this.providerService.getProviderById(conv.providerId);
    const assistantMessage: ChatMessage = {
      id: this.generateId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      model: conv.model,
      providerName: provider?.name,
      isStreaming: true,
    };

    this.conversations.update((convs) =>
      convs.map((c) => {
        if (c.id === conv.id) {
          return { ...c, messages: [...c.messages, assistantMessage] };
        }
        return c;
      })
    );

    this.isGenerating.set(true);
    this.abortController = new AbortController();

    try {
      const settings = this.getSettings();
      const updatedConv = this.conversations().find((c) => c.id === conv.id)!;
      const apiMessages: { role: string; content: string; images?: string[] }[] = [];
      const systemPrompt = updatedConv.systemPrompt || settings.systemPrompt;
      if (systemPrompt) {
        apiMessages.push({ role: 'system', content: systemPrompt });
      }
      for (const msg of updatedConv.messages) {
        if (msg.role !== 'system' && msg.id !== assistantMessage.id) {
          apiMessages.push({
            role: msg.role,
            content: msg.content,
            images: msg.images
          });
        }
      }

      let fullContent = '';
      let finalStats: any = null;
      for await (const chunk of this.providerService.streamChat(
        conv.providerId,
        conv.model,
        apiMessages,
        settings.temperature,
        this.abortController?.signal
      )) {
        if (chunk.content) {
          fullContent += chunk.content;
          this.conversations.update((convs) =>
            convs.map((c) => {
              if (c.id === conv.id) {
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, content: fullContent, isStreaming: !chunk.done }
                      : m
                  ),
                };
              }
              return c;
            })
          );
        }
        if (chunk.done && chunk.stats) {
          finalStats = chunk.stats;
        }
      }

      const stats = this.extractStats(finalStats);
      this.conversations.update((convs) =>
        convs.map((c) => {
          if (c.id === conv.id) {
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, isStreaming: false, ...stats }
                  : m
              ),
            };
          }
          return c;
        })
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const errorContent = `⚠️ **Error:** ${error.message || 'Failed to regenerate'}`;
        this.conversations.update((convs) =>
          convs.map((c) => {
            if (c.id === conv.id) {
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: errorContent, isStreaming: false }
                    : m
                ),
              };
            }
            return c;
          })
        );
      }
    } finally {
      this.isGenerating.set(false);
      this.abortController = null;
      this.saveConversations();
    }
  }

  searchInMessages(query: string): { conversationId: string; messageId: string; content: string; role: string }[] {
    const results: any[] = [];
    if (!query) return results;

    const lowerQuery = query.toLowerCase();
    for (const conv of this.conversations()) {
      for (const msg of conv.messages) {
        if (msg.content.toLowerCase().includes(lowerQuery)) {
          results.push({
            conversationId: conv.id,
            messageId: msg.id,
            content: msg.content,
            role: msg.role
          });
        }
      }
    }
    return results;
  }
}
