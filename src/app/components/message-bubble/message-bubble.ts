import { Component, Input, inject, output, HostListener } from '@angular/core';
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
  previewImage = output<string>();

  private toast = inject(ToastService);

  copyMessage(): void {
    navigator.clipboard.writeText(this.message.content);
    this.toast.success('Copied to clipboard');
  }

  @HostListener('click', ['$event'])
  handleCopyButtonClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const copyBtn = target.closest('.copy-btn') as HTMLElement;

    if (copyBtn && copyBtn.dataset['code']) {
      event.preventDefault();
      event.stopPropagation();

      const base64Code = copyBtn.dataset['code'];
      try {
        // Robust way to decode base64 utf-8
        const code = decodeURIComponent(
          Array.prototype.map.call(atob(base64Code), (c) => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join('')
        );

        navigator.clipboard.writeText(code).then(() => {
          this.toast.success('Code copied!');

          // Visual feedback
          const textSpan = copyBtn.querySelector('span');
          if (textSpan) {
            const originalText = textSpan.innerText;
            textSpan.innerText = 'Copied!';
            copyBtn.classList.add('copied');

            setTimeout(() => {
              textSpan.innerText = originalText;
              copyBtn.classList.remove('copied');
            }, 2000);
          }
        });
      } catch (e) {
        console.error('Copy failed', e);
        // Fallback for non-unicode if robust fetch fails
        try {
          navigator.clipboard.writeText(atob(base64Code));
        } catch (inner) { /* ignore */ }
      }
    }
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

  openImageFull(url: string, event: Event): void {
    event.stopPropagation();
    this.previewImage.emit(url);
  }
}
