import {
  Component,
  inject,
  signal,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  HostListener,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';
import { ProviderService } from '../../services/provider.service';
import { ToastService } from '../../services/toast.service';
import { MessageBubbleComponent } from '../message-bubble/message-bubble';
import { ProviderModel } from '../../models/provider.model';
import { ChatMessage } from '../../models/chat.model';

@Component({
  selector: 'app-chat-view',
  standalone: true,
  imports: [CommonModule, FormsModule, MessageBubbleComponent],
  templateUrl: './chat-view.html',
  styleUrl: './chat-view.scss',
})
export class ChatViewComponent implements AfterViewChecked {
  chatService = inject(ChatService);
  providerService = inject(ProviderService);

  private toast = inject(ToastService);

  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  @ViewChild('messageInput') messageInput!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef;

  inputText = signal('');
  modelSearchQuery = signal('');
  showModelSelector = signal(false);
  showScrollBottom = signal(false);
  isRecording = signal(false);
  shouldScrollToBottom = true;

  private recognition: any = null;

  models = this.providerService.models;
  activeConversation = this.chatService.activeConversation;

  private previousMessageCount = 0;

  constructor() {
    effect(() => {
      const conv = this.chatService.activeConversation();
      if (conv) {
        const currentCount = conv.messages.length;
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (currentCount !== this.previousMessageCount || lastMsg?.isStreaming) {
          this.shouldScrollToBottom = true;
          this.previousMessageCount = currentCount;
        }
      }
    });
  }

  toggleSidebar(): void {
    this.chatService.sidebarCollapsed.update((v) => !v);
  }

  // Keyboard shortcuts
  @HostListener('window:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent): void {
    // Escape: close dropdown/dialogs
    if (event.key === 'Escape') {
      if (this.showModelSelector()) {
        this.showModelSelector.set(false);
        event.preventDefault();
      }
    }
    // Ctrl+N: new chat
    if (event.ctrlKey && event.key === 'n') {
      event.preventDefault();
      this.chatService.createConversation();
      setTimeout(() => this.messageInput?.nativeElement?.focus(), 100);
    }
    // Ctrl+/: focus input
    if (event.ctrlKey && event.key === '/') {
      event.preventDefault();
      this.messageInput?.nativeElement?.focus();
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  onMessagesScroll(): void {
    const el = this.messagesContainer?.nativeElement;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.showScrollBottom.set(distanceFromBottom > 200);
  }

  scrollToBottom(): void {
    try {
      const el = this.messagesContainer?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
        this.showScrollBottom.set(false);
      }
    } catch (err) {}
  }

  async sendMessage(): Promise<void> {
    const text = this.inputText().trim();
    if (!text || this.chatService.isGenerating()) return;

    this.inputText.set('');
    this.shouldScrollToBottom = true;

    if (this.messageInput?.nativeElement) {
      this.messageInput.nativeElement.style.height = 'auto';
    }

    await this.chatService.sendMessage(text);

    setTimeout(() => {
      this.messageInput?.nativeElement?.focus();
    }, 100);
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  autoResize(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  selectModel(model: ProviderModel): void {
    this.chatService.saveLastUsedModel(model.id, model.providerId);
    const conv = this.chatService.activeConversation();
    if (conv) {
      this.chatService.updateConversationModel(conv.id, model.id, model.providerId);
    } else {
      this.chatService.createConversation(model.id, model.providerId);
    }
    this.showModelSelector.set(false);
    this.modelSearchQuery.set('');
  }

  getCurrentModel(): string {
    const conv = this.chatService.activeConversation();
    if (conv?.model) {
      const parts = conv.model.split('/');
      return parts[parts.length - 1];
    }
    return 'Select Model';
  }

  getCurrentProviderName(): string {
    const conv = this.chatService.activeConversation();
    if (conv?.providerId) {
      const provider = this.providerService.getProviderById(conv.providerId);
      return provider?.name || '';
    }
    return '';
  }

  getGroupedModels(): { providerName: string; models: ProviderModel[] }[] {
    const groups: Record<string, { providerName: string; models: ProviderModel[] }> = {};
    const query = this.modelSearchQuery().toLowerCase();
    
    for (const model of this.models()) {
      if (query && !model.name.toLowerCase().includes(query)) {
        continue;
      }
      
      if (!groups[model.providerId]) {
        groups[model.providerId] = { providerName: model.providerName, models: [] };
      }
      groups[model.providerId].models.push(model);
    }
    return Object.values(groups);
  }

  toggleModelSelector(): void {
    const isOpening = !this.showModelSelector();
    this.showModelSelector.set(isOpening);
    if (!isOpening) {
      this.modelSearchQuery.set('');
    }
  }

  stopGeneration(): void {
    this.chatService.stopGeneration();
  }

  async regenerateResponse(): Promise<void> {
    await this.chatService.regenerateLastResponse();
    setTimeout(() => {
      this.messageInput?.nativeElement?.focus();
    }, 100);
  }

  async editMessage(message: ChatMessage): Promise<void> {
    // Put the message content back in the input and remove it + subsequent messages
    this.inputText.set(message.content);
    this.chatService.editUserMessage(message.id);
    setTimeout(() => {
      this.messageInput?.nativeElement?.focus();
      this.autoResizeInput();
    }, 50);
  }

  private autoResizeInput(): void {
    const el = this.messageInput?.nativeElement;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }

  // Date grouping helpers
  getDateLabel(message: ChatMessage, index: number): string | null {
    const conv = this.activeConversation();
    if (!conv) return null;

    const msgDate = new Date(message.timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // Don't show if same date as previous message
    if (index > 0) {
      const prevDate = new Date(conv.messages[index - 1].timestamp);
      if (this.isSameDay(msgDate, prevDate)) return null;
    }

    if (this.isSameDay(msgDate, today)) return 'Today';
    if (this.isSameDay(msgDate, yesterday)) return 'Yesterday';
    return msgDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: msgDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  getSuggestions(): { icon: string; text: string; prompt: string }[] {
    return [
      { icon: '💡', text: 'Explain a concept', prompt: 'Explain quantum computing in simple terms' },
      { icon: '✍️', text: 'Help me write', prompt: 'Help me write a professional email to request a meeting' },
      { icon: '🔧', text: 'Debug code', prompt: 'Help me debug this code and explain the issue' },
      { icon: '🎨', text: 'Creative ideas', prompt: 'Give me 5 creative project ideas for learning web development' },
    ];
  }

  useSuggestion(prompt: string): void {
    this.inputText.set(prompt);
    if (this.messageInput?.nativeElement) {
      this.messageInput.nativeElement.focus();
    }
  }

  // Voice Input
  toggleVoiceInput(): void {
    if (this.isRecording()) {
      this.stopRecording();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.toast.error('Speech recognition not supported in this browser');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    let finalTranscript = this.inputText();

    this.recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + ' ';
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      this.inputText.set(finalTranscript + interim);
      this.autoResizeInput();
    };

    this.recognition.onerror = () => {
      this.isRecording.set(false);
      this.toast.error('Voice recognition error');
    };

    this.recognition.onend = () => {
      this.isRecording.set(false);
    };

    this.recognition.start();
    this.isRecording.set(true);
  }

  private stopRecording(): void {
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
    this.isRecording.set(false);
  }

  // File Attachment
  triggerFileUpload(): void {
    this.fileInput?.nativeElement?.click();
  }

  handleFileAttach(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      this.toast.error('File too large (max 1MB)');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const prefix = `\n\n---\n📎 **${file.name}**\n\`\`\`\n${content}\n\`\`\`\n---\n`;
      this.inputText.update((t) => t + prefix);
      this.autoResizeInput();
      this.toast.success(`Attached: ${file.name}`);
    };
    reader.readAsText(file);
    input.value = '';
  }
}
