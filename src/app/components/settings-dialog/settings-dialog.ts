import { Component, signal, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProviderService } from '../../services/provider.service';
import { ChatService } from '../../services/chat.service';
import { ToastService } from '../../services/toast.service';
import { ProviderConfig, PROVIDER_PRESETS } from '../../models/provider.model';

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss',
})
export class SettingsDialogComponent {
  closed = output<void>();

  providerService = inject(ProviderService);
  chatService = inject(ChatService);
  toast = inject(ToastService);

  activeTab = signal<'providers' | 'general' | 'models' | 'analytics' | 'help' | 'about'>('providers');
  pullingModel = signal<string>('');
  pullStatus = signal<string>('');
  pullProgress = signal<number>(0);
  isDeletingModel = signal<string>('');
  testingProvider = signal<string>('');

  // Local settings copy
  settings = signal(this.chatService.getSettings());
  providers = signal<ProviderConfig[]>(
    JSON.parse(JSON.stringify(this.providerService.providers()))
  );

  availablePresets = [
    { key: 'ollama', name: 'Ollama (Local)', icon: '🦙' },
    { key: 'openrouter', name: 'OpenRouter', icon: '🌐' },
    { key: 'openai', name: 'OpenAI', icon: '🤖' },
    { key: 'groq', name: 'Groq', icon: '⚡' },
    { key: 'lmstudio', name: 'LM Studio', icon: '💻' },
    { key: 'custom', name: 'Custom (OpenAI-compatible)', icon: '🔧' },
  ];

  addProvider(presetKey: string): void {
    const preset = PROVIDER_PRESETS[presetKey] || {};
    const provider: ProviderConfig = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      type: preset.type || 'openai-compatible',
      name: preset.name || 'Custom Provider',
      baseUrl: preset.baseUrl || '',
      apiKey: preset.apiKey || '',
      enabled: true,
      preset: presetKey as any,
    };
    this.providers.update((p) => [...p, provider]);
  }

  removeProvider(id: string): void {
    this.providers.update((p) => p.filter((prov) => prov.id !== id));
  }

  updateProviderField(id: string, field: string, value: any): void {
    this.providers.update((providers) =>
      providers.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }

  async testProvider(provider: ProviderConfig): Promise<void> {
    this.testingProvider.set(provider.id);
    try {
      if (provider.type === 'web-llm') {
        const hasWebGPU = !!(navigator as any).gpu;
        if (hasWebGPU) {
          this.toast.success(`${provider.name}: WebGPU is supported! 🚀`);
        } else {
          this.toast.error(`${provider.name}: WebGPU not supported in this browser`);
        }
      } else if (provider.type === 'ollama') {
        const res = await fetch(provider.baseUrl);
        if (res.ok) {
          this.toast.success(`${provider.name} connected!`);
        } else {
          this.toast.error(`${provider.name}: Server error`);
        }
      } else {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (provider.apiKey) {
          headers['Authorization'] = `Bearer ${provider.apiKey}`;
        }
        const res = await fetch(`${provider.baseUrl}/models`, { headers });
        if (res.ok) {
          const data = await res.json();
          const count = data.data?.length || 0;
          this.toast.success(`${provider.name}: ${count} models available`);
        } else if (res.status === 401) {
          this.toast.error(`${provider.name}: Invalid API key`);
        } else {
          this.toast.error(`${provider.name}: Error ${res.status}`);
        }
      }
    } catch (error: any) {
      this.toast.error(`${provider.name}: Cannot connect`);
    } finally {
      this.testingProvider.set('');
    }
  }

  updateSetting(key: string, value: any): void {
    this.settings.update((s) => ({ ...s, [key]: value }));
  }

  save(): void {
    this.chatService.saveSettings(this.settings());
    this.providerService.saveProviders(this.providers());
    // Refetch models with updated providers
    this.providerService.fetchAllModels();
    this.toast.success('Settings saved');
    this.closed.emit();
  }

  cancel(): void {
    this.closed.emit();
  }

  getUsageStats(): any {
    const convs = this.chatService.conversations();
    let totalTokens = 0;
    let totalMessages = 0;
    let totalUserMessages = 0;
    let totalAssistantMessages = 0;
    let totalDuration = 0;
    let durationCount = 0;
    const modelUsage: Record<string, { tokens: number; messages: number }> = {};

    for (const conv of convs) {
      for (const msg of conv.messages) {
        totalMessages++;
        if (msg.role === 'user') totalUserMessages++;
        if (msg.role === 'assistant') {
          totalAssistantMessages++;
          if (msg.tokenCount) {
            totalTokens += msg.tokenCount;
            const model = msg.model || conv.model;
            if (!modelUsage[model]) modelUsage[model] = { tokens: 0, messages: 0 };
            modelUsage[model].tokens += msg.tokenCount;
            modelUsage[model].messages++;
          }
          if (msg.tokensPerSecond) {
            totalDuration += msg.tokensPerSecond;
            durationCount++;
          }
        }
      }
    }

    const topModels = Object.entries(modelUsage)
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 5)
      .map(([model, data]) => ({ model, ...data }));

    return {
      totalConversations: convs.length,
      totalMessages,
      totalUserMessages,
      totalAssistantMessages,
      totalTokens,
      avgSpeed: durationCount > 0 ? Math.round((totalDuration / durationCount) * 10) / 10 : 0,
      topModels,
    };
  }

  // Model management
  getOllamaModels() {
    return this.providerService.models().filter(m => {
      const p = this.providerService.getProviderById(m.providerId);
      return p?.type === 'ollama';
    });
  }

  async deleteModel(providerId: string, modelName: string) {
    if (!confirm(`Are you sure you want to delete ${modelName}?`)) return;

    this.isDeletingModel.set(modelName);
    try {
      await this.providerService.deleteOllamaModel(providerId, modelName);
      this.toast.success('Model deleted');
    } catch (e: any) {
      this.toast.error(e.message || 'Failed to delete model');
    } finally {
      this.isDeletingModel.set('');
    }
  }

  async pullModel(modelName: string) {
    if (!modelName.trim()) return;

    const provider = this.providerService.activeProvider();
    if (!provider || provider.type !== 'ollama') {
      this.toast.error('Ollama provider not active');
      return;
    }

    this.pullingModel.set(modelName);
    this.pullStatus.set('Initializing...');
    this.pullProgress.set(0);

    try {
      const gen = this.providerService.pullOllamaModel(provider.id, modelName);
      for await (const chunk of gen as any) {
        this.pullStatus.set(chunk.status);
        if (chunk.completed && chunk.total) {
          this.pullProgress.set((chunk.completed / chunk.total) * 100);
        }
      }
      this.toast.success(`Success: ${modelName} installed`);
      this.pullingModel.set('');
    } catch (e: any) {
      this.toast.error(e.message || 'Failed to pull model');
      this.pullingModel.set('');
    }
  }
}
