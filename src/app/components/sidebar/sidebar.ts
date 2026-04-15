import { Component, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';
import { ToastService } from '../../services/toast.service';
import { Conversation } from '../../models/chat.model';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class SidebarComponent {
  chatService = inject(ChatService);
  toast = inject(ToastService);

  isCollapsed = this.chatService.sidebarCollapsed;
  searchQuery = signal('');
  editingId = signal<string | null>(null);
  editTitle = signal('');
  showDeleteConfirm = signal<string | null>(null);
  searchMode = signal<'title' | 'content'>('title');
  contentSearchResults = signal<any[]>([]);

  filteredConversations = () => {
    const query = this.searchQuery().toLowerCase();
    const convs = this.chatService.sortedConversations();
    if (!query) return convs;

    if (this.searchMode() === 'content') {
      // Show conversations that have matching messages
      const results = this.chatService.searchInMessages(query);
      this.contentSearchResults.set(results);
      const matchedIds = new Set(results.map((r) => r.conversationId));
      return convs.filter((c) => matchedIds.has(c.id));
    }

    return convs.filter((c) => c.title.toLowerCase().includes(query));
  };

  newChat(): void {
    this.chatService.createConversation();
  }

  selectConversation(conv: Conversation): void {
    this.chatService.setActiveConversation(conv.id);
    // Auto-collapse on mobile
    if (window.innerWidth <= 768) {
      this.isCollapsed.set(true);
    }
  }

  startRename(conv: Conversation, event: Event): void {
    event.stopPropagation();
    this.editingId.set(conv.id);
    this.editTitle.set(conv.title);
  }

  saveRename(id: string): void {
    if (this.editTitle().trim()) {
      this.chatService.renameConversation(id, this.editTitle().trim());
    }
    this.editingId.set(null);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  confirmDelete(id: string, event: Event): void {
    event.stopPropagation();
    this.showDeleteConfirm.set(id);
  }

  deleteConversation(id: string): void {
    this.chatService.deleteConversation(id);
    this.showDeleteConfirm.set(null);
  }

  cancelDelete(): void {
    this.showDeleteConfirm.set(null);
  }

  toggleCollapse(): void {
    this.isCollapsed.update((v) => !v);
  }

  clearAll(): void {
    this.chatService.clearAllConversations();
  }

  exportChats(): void {
    this.chatService.exportConversations();
    this.toast.success('Conversations exported');
  }

  downloadMarkdown(id: string, event: Event): void {
    event.stopPropagation();
    this.chatService.exportConversationAsMarkdown(id);
    this.toast.success('Downloaded as Markdown');
  }

  async importChats(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const count = await this.chatService.importConversations(file);
        this.toast.success(`Imported ${count} conversations`);
      } catch {
        this.toast.error('Invalid file format');
      }
    };
    input.click();
  }

  toggleSearchMode(): void {
    this.searchMode.update((m) => (m === 'title' ? 'content' : 'title'));
    // Re-trigger search
    const q = this.searchQuery();
    this.searchQuery.set('');
    this.searchQuery.set(q);
  }

  getTimeAgo(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  }
}
