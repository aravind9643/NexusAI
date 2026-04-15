import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from './components/sidebar/sidebar';
import { ChatViewComponent } from './components/chat-view/chat-view';
import { SettingsDialogComponent } from './components/settings-dialog/settings-dialog';
import { ToastContainerComponent } from './components/toast-container/toast-container';
import { ProviderService } from './services/provider.service';
import { ChatService } from './services/chat.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, SidebarComponent, ChatViewComponent, SettingsDialogComponent, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  providerService = inject(ProviderService);
  chatService = inject(ChatService);

  showSettings = signal(false);
  sidebarCollapsed = this.chatService.sidebarCollapsed;

  ngOnInit(): void {
    // Fetch models from all enabled providers on startup
    this.providerService.fetchAllModels();
  }



  openSettings(): void {
    this.showSettings.set(true);
  }

  closeSettings(): void {
    this.showSettings.set(false);
  }
}
