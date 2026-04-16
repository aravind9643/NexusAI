import { Injectable, signal, computed, inject } from '@angular/core';
import { Conversation, ChatMessage, Folder } from '../models/chat.model';
import { ProviderService } from './provider.service';
import { StorageService } from './storage.service';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private providerService = inject(ProviderService);
  private storage = inject(StorageService);
  private abortController: AbortController | null = null;

  conversations = signal<Conversation[]>([]);
  folders = signal<Folder[]>([]);
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

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    const [convs, folders] = await Promise.all([
      this.storage.getAllConversations(),
      this.storage.getAllFolders()
    ]);

    this.conversations.set(convs);
    this.folders.set(folders);
    
    if (convs.length > 0) {
      const sorted = convs.sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      this.activeConversationId.set(sorted[0].id);
    }
  }

  // Settings logic
  getSettings(): any {
    const stored = localStorage.getItem('ollama-chat-settings');
    if (stored) return JSON.parse(stored);
    return {
      systemPrompt: 'You are a helpful AI assistant. Be concise and informative.',
      temperature: 0.7,
      streamResponses: true,
    };
  }

  async saveSettings(settings: any): Promise<void> {
    await this.storage.saveSetting('settings', settings);
    localStorage.setItem('ollama-chat-settings', JSON.stringify(settings));
  }

  // Persistence helpers
  private saveConversations(): void {
    // This now saves folders and triggers storage of metadata if needed
    this.storage.saveFolders(this.folders());
  }

  private async saveOneConversation(conv: Conversation): Promise<void> {
    await this.storage.saveConversation(conv);
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
    this.saveOneConversation(conversation);
    this.saveConversations();
    return conversation;
  }

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
    this.conversations.update(convs => convs.map(c => c.folderId === id ? { ...c, folderId: undefined } : c));
    this.saveConversations();
  }

  saveLastUsedModel(model: string, providerId: string): void {
    localStorage.setItem('nexus-last-model', JSON.stringify({ model, providerId }));
  }

  getLastUsedModel(): { model: string; providerId: string } | null {
    const stored = localStorage.getItem('nexus-last-model');
    return stored ? JSON.parse(stored) : null;
  }

  setActiveConversation(id: string): void {
    this.activeConversationId.set(id);
  }

  async deleteConversation(id: string): Promise<void> {
    this.conversations.update((convs) => convs.filter((c) => c.id !== id));
    if (this.activeConversationId() === id) {
      const remaining = this.conversations();
      this.activeConversationId.set(remaining.length > 0 ? remaining[0].id : null);
    }
    await this.storage.deleteConversation(id);
  }

  renameConversation(id: string, title: string): void {
    this.conversations.update((convs) =>
      convs.map((c) => (c.id === id ? { ...c, title } : c))
    );
    const conv = this.conversations().find(c => c.id === id);
    if (conv) this.saveOneConversation(conv);
  }

  updateConversation(id: string, updates: Partial<Conversation>): void {
    this.conversations.update((convs) =>
      convs.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
    const conv = this.conversations().find(c => c.id === id);
    if (conv) this.saveOneConversation(conv);
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

  async clearAllConversations(): Promise<void> {
    const ids = this.conversations().map(c => c.id);
    this.conversations.set([]);
    this.activeConversationId.set(null);
    for (const id of ids) {
      await this.storage.deleteConversation(id);
    }
  }

  editUserMessage(messageId: string): void {
    const conv = this.activeConversation();
    if (!conv) return;

    const msgIndex = conv.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const trimmedMessages = conv.messages.slice(0, msgIndex);
    this.conversations.update((convs) =>
      convs.map((c) =>
        c.id === conv.id ? { ...c, messages: trimmedMessages } : c
      )
    );
    this.saveOneConversation({ ...conv, messages: trimmedMessages });
  }

  // Export/Import
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

  async importConversations(file: File): Promise<number> {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error('Invalid format');

    const convs = imported.map((c: any) => ({
      ...c,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
      messages: (c.messages || []).map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
    }));

    this.conversations.update((existing) => [...existing, ...convs]);
    for (const c of convs) {
      await this.storage.saveConversation(c);
    }
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
      this.updateConversation(conv.id, {
        messages: conv.messages.map(m => ({...m, isStreaming: false}))
      });
    }
  }

  async sendMessage(content: string, images?: string[], files?: any[], includeThinking = true): Promise<void> {
    let conv = this.activeConversation();
    if (!conv) {
      conv = this.createConversation();
    }

    const userMessage: ChatMessage = {
      id: this.generateId(),
      role: 'user',
      content,
      images,
      files,
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
      const apiMessages: any[] = [];
      const systemPrompt = updatedConv.systemPrompt || settings.systemPrompt;
      if (systemPrompt) apiMessages.push({ role: 'system', content: systemPrompt });

      for (const msg of updatedConv.messages) {
        if (msg.role !== 'system' && msg.id !== assistantMessage.id) {
          let fullContent = msg.content;
          if (msg.files && msg.files.length > 0) {
            msg.files.forEach(f => {
              if (f.type === 'text') {
                fullContent += `\n\n---\n📎 **${f.name}**\n\`\`\`\n${f.data}\n\`\`\`\n---\n`;
              }
            });
          }
          apiMessages.push({ role: msg.role, content: fullContent, images: msg.images });
        }
      }

      if (settings.streamResponses) {
        let fullContent = '';
        let fullThinking = '';
        let finalStats: any = null;
        let thinkingStartTime: number | null = null;
        let thinkingDuration = 0;

        for await (const chunk of this.providerService.streamChat(
          conv.providerId, conv.model, apiMessages, settings.temperature, this.abortController?.signal
        )) {
          if (chunk.isThinking && !thinkingStartTime) {
            thinkingStartTime = Date.now();
          } else if (!chunk.isThinking && thinkingStartTime && thinkingDuration === 0) {
            thinkingDuration = Date.now() - thinkingStartTime;
          }

          if (chunk.content || chunk.thinkingContent || chunk.isThinking) {
            fullContent += chunk.content || '';
            if (includeThinking) fullThinking += chunk.thinkingContent || '';
            
            this.conversations.update((convs) =>
              convs.map((c) => {
                if (c.id === conv!.id) {
                  return {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, content: fullContent, thinkingContent: fullThinking, isThinking: chunk.isThinking, thinkingDuration: thinkingDuration || (thinkingStartTime ? Date.now() - thinkingStartTime : 0), isStreaming: !chunk.done }
                        : m
                    ),
                  };
                }
                return c;
              })
            );
          }
          if (chunk.done && chunk.stats) finalStats = chunk.stats;
        }

        const stats = this.extractStats(finalStats);
        this.updateConversation(conv.id, {
          messages: this.activeConversation()!.messages.map(m => m.id === assistantMessage.id ? {...m, isStreaming: false, ...stats} : m)
        });
      } else {
        const response = await this.providerService.chat(conv.providerId, conv.model, apiMessages, settings.temperature);
        const stats = this.extractStats(response?.stats);
        this.updateConversation(conv.id, {
          messages: this.activeConversation()!.messages.map(m => m.id === assistantMessage.id ? {...m, content: response.content, isStreaming: false, ...stats} : m)
        });
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const errorContent = `⚠️ **Error:** ${error.message || 'Failed to get response'}`;
        this.updateConversation(conv.id, {
          messages: this.activeConversation()!.messages.map(m => m.id === assistantMessage.id ? {...m, content: errorContent, isStreaming: false} : m)
        });
      }
    } finally {
      this.isGenerating.set(false);
      this.abortController = null;
      const finalConv = this.conversations().find(c => c.id === conv!.id);
      if (finalConv) {
        this.saveOneConversation(finalConv);
        if (finalConv.title === 'New Chat' && finalConv.messages.length >= 2) {
          this.autoRenameConversation(finalConv.id);
        }
      }
    }
  }

  private async autoRenameConversation(id: string): Promise<void> {
    const conv = this.conversations().find(c => c.id === id);
    if (!conv || conv.messages.length < 2 || conv.title !== 'New Chat') return;

    const userMsg = conv.messages.find(m => m.role === 'user')?.content || '';
    const aiMsg = conv.messages.find(m => m.role === 'assistant')?.content || '';
    
    try {
      const prompt = `Task: Summarize the following chat exchange into a 2-4 word title. Respond ONLY with the title.\n\nUser: ${userMsg.substring(0, 150)}\nAssistant: ${aiMsg.substring(0, 150)}`;
      const response = await this.providerService.chat(conv.providerId, conv.model, [{role: 'user', content: prompt}], 0.3);
      const title = response.content.replace(/["'#*]/g, '').trim();
      if (title && title.length < 50 && !title.includes('\n')) {
        this.renameConversation(id, title);
      }
    } catch (e) {
      console.error('Auto-rename failed', e);
    }
  }

  private extractStats(stats: any): { tokenCount?: number; tokensPerSecond?: number; totalDuration?: number } {
    if (!stats) return {};
    const result: any = {};
    if (stats.eval_count) result.tokenCount = stats.eval_count;
    if (stats.eval_count && stats.eval_duration) {
      const seconds = stats.eval_duration / 1_000_000_000;
      result.tokensPerSecond = Math.round((stats.eval_count / seconds) * 10) / 10;
    }
    if (stats.total_duration) result.totalDuration = Math.round(stats.total_duration / 1_000_000);
    return result;
  }

  async regenerateLastResponse(): Promise<void> {
    const conv = this.activeConversation();
    if (!conv || conv.messages.length < 2 || this.isGenerating()) return;

    const assistantIdx = conv.messages.map(m => m.role).lastIndexOf('assistant');
    if (assistantIdx === -1) return;

    const trimmed = conv.messages.slice(0, assistantIdx);
    this.updateConversation(conv.id, { messages: trimmed });
    this.sendMessage(conv.messages[assistantIdx - 1].content, conv.messages[assistantIdx - 1].images);
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
