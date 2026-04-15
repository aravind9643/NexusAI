import { Component, inject, signal, output, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
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
  isAddingFolder = signal(false);
  newFolderName = signal('');
  movingConvId = signal<string | null>(null);
  dragOverFolderId = signal<string | null>(null);
  isDraggingOverRecent = signal(false);
  draggingId = signal<string | null>(null);

  @ViewChild('folderInput') set folderInput(el: ElementRef) {
    if (el) {
      setTimeout(() => el.nativeElement.focus(), 0);
    }
  }

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

  // Folder Methods
  addFolder(): void {
    this.isAddingFolder.set(true);
    this.newFolderName.set('');
  }

  confirmAddFolder(): void {
    const name = this.newFolderName().trim();
    if (name) {
      this.chatService.createFolder(name);
      this.isAddingFolder.set(false);
      this.newFolderName.set('');
    }
  }

  cancelAddFolder(): void {
    this.isAddingFolder.set(false);
    this.newFolderName.set('');
  }

  openMoveModal(convId: string, event: Event): void {
    event.stopPropagation();
    this.movingConvId.set(convId);
  }

  closeMoveModal(): void {
    this.movingConvId.set(null);
  }

  confirmMoveToFolder(folderId?: string): void {
    const convId = this.movingConvId();
    if (convId) {
      this.chatService.updateConversation(convId, { folderId });
      this.toast.success(folderId ? 'Moved to folder' : 'Moved to Recent');
    }
    this.closeMoveModal();
  }

  toggleFolder(id: string): void {
    const folder = this.chatService.folders().find(f => f.id === id);
    if (folder) {
      this.chatService.updateFolder(id, { isExpanded: !folder.isExpanded });
    }
  }

  // Drag & Drop
  onDragStart(event: DragEvent, convId: string): void {
    if (event.dataTransfer) {
      this.draggingId.set(convId);
      event.dataTransfer.setData('convId', convId);
      event.dataTransfer.effectAllowed = 'move';
      
      // Ensure the drag ghost image is exactly the conversation item row
      const target = (event.target as HTMLElement).closest('.conversation-item') as HTMLElement;
      if (target) {
        event.dataTransfer.setDragImage(target, 20, 20);
      }
    }
  }

  onDragEnd(): void {
    this.draggingId.set(null);
  }

  onDragOverFolder(event: DragEvent, folderId: string): void {
    event.preventDefault();
    this.dragOverFolderId.set(folderId);
  }

  onDragLeaveFolder(): void {
    this.dragOverFolderId.set(null);
  }

  onDropToFolder(event: DragEvent, folderId: string): void {
    event.preventDefault();
    this.dragOverFolderId.set(null);
    const convId = event.dataTransfer?.getData('convId');
    if (convId) {
      this.chatService.updateConversation(convId, { folderId });
      this.toast.success('Moved to folder');
    }
  }

  onDragOverRecent(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingOverRecent.set(true);
  }

  onDragLeaveRecent(): void {
    this.isDraggingOverRecent.set(false);
  }

  onDropToRecent(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingOverRecent.set(false);
    const convId = event.dataTransfer?.getData('convId');
    if (convId) {
      this.chatService.updateConversation(convId, { folderId: undefined });
      this.toast.success('Moved to Recent');
    }
  }

  deleteFolder(id: string, event: Event): void {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this folder? Conversations will be moved out of the folder.')) {
      this.chatService.deleteFolder(id);
    }
  }

  renameFolder(id: string, event: Event): void {
    event.stopPropagation();
    const folder = this.chatService.folders().find(f => f.id === id);
    if (!folder) return;
    const name = prompt('Rename Folder:', folder.name);
    if (name && name !== folder.name) {
      this.chatService.updateFolder(id, { name });
    }
  }

  getConversationsInFolder(folderId?: string): Conversation[] {
    return this.filteredConversations().filter(c => c.folderId === folderId && !c.isPinned);
  }

  getPinnedConversations(): Conversation[] {
    return this.filteredConversations().filter(c => c.isPinned);
  }

  getUncategorizedConversations(): Conversation[] {
    // Return conversations that are neither in a folder nor pinned
    return this.filteredConversations().filter(c => !c.folderId && !c.isPinned);
  }

  moveToFolder(convId: string, folderId?: string): void {
    this.chatService.updateConversation(convId, { folderId });
  }
}
