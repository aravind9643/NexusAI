import { Component, Input, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatMessage } from '../../models/chat.model';
import { MarkdownPipe } from '../../pipes/markdown.pipe';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-message-bubble',
  standalone: true,
  imports: [CommonModule, MarkdownPipe],
  templateUrl: './message-bubble.html',
  styleUrl: './message-bubble.scss',
})
export class MessageBubbleComponent {
  @Input({ required: true }) message!: ChatMessage;
  @Input() isLast = false;
  regenerate = output<void>();
  edit = output<void>();

  private toast = inject(ToastService);

  copyMessage(): void {
    navigator.clipboard.writeText(this.message.content);
    this.toast.success('Copied to clipboard');
  }

  getFormattedTime(): string {
    const date = new Date(this.message.timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const remainSec = Math.round(sec % 60);
    return `${min}m ${remainSec}s`;
  }
}
