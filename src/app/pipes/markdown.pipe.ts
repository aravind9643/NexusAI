import { Pipe, PipeTransform } from '@angular/core';
import { marked } from 'marked';
import hljs from 'highlight.js';

@Pipe({
  name: 'markdown',
  standalone: true,
})
export class MarkdownPipe implements PipeTransform {
  constructor() {
    const renderer = new marked.Renderer();

    renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      let highlighted: string;
      try {
        highlighted = hljs.highlight(text, { language }).value;
      } catch {
        highlighted = hljs.highlightAuto(text).value;
      }
      const escapedLang = this.escapeHtml(language);
      return `<div class="code-block">
        <div class="code-header">
          <span class="code-lang">${escapedLang}</span>
          <button class="copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(text)}'))">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
        </div>
        <pre><code class="hljs language-${escapedLang}">${highlighted}</code></pre>
      </div>`;
    };

    renderer.codespan = ({ text }: { text: string }) => {
      return `<code class="inline-code">${text}</code>`;
    };

    marked.setOptions({
      renderer,
      breaks: true,
      gfm: true,
    });
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  transform(value: string): string {
    if (!value) return '';
    try {
      return marked.parse(value) as string;
    } catch {
      return value;
    }
  }
}
