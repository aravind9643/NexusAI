import { Injectable, signal } from '@angular/core';
import * as webllm from '@mlc-ai/web-llm';

export interface WebLLMProgress {
  text: string;
  progress: number;
}

@Injectable({
  providedIn: 'root',
})
export class WebLLMService {
  private engine: webllm.MLCEngine | null = null;
  
  isLoading = signal(false);
  loadingProgress = signal(0);
  loadingStatus = signal('');
  currentModelId = signal<string | null>(null);

  /**
   * Available models compatible with WebLLM
   * These are standard IDs from MLC LLM repository
   */
  availableModels = [
    { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 3B (WebGPU)', size: '1.9 GB' },
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B (Tiny)', size: '0.9 GB' },
    { id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC', name: 'Llama 3.1 8B (Pro)', size: '4.7 GB' },
    { id: 'Gemma-2-2b-it-q4f16_1-MLC', name: 'Gemma 2 2B (WebGPU)', size: '1.6 GB' },
    { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', name: 'Phi-3.5 Mini (Fast)', size: '2.2 GB' },
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B (WebGPU)', size: '1.2 GB' },
    { id: 'Qwen2-0.5B-Instruct-q4f16_1-MLC', name: 'Qwen2 0.5B (Pocket)', size: '0.4 GB' },
    { id: 'SmolLM-135M-Instruct-v0.2-q4f16_1-MLC', name: 'SmolLM 135M (Ultra-Fast)', size: '0.1 GB' },
    { id: 'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC', name: 'TinyLlama 1.1B (WebGPU)', size: '0.7 GB' },
  ];

  async loadModel(modelId: string): Promise<void> {
    if (this.currentModelId() === modelId && this.engine) return;

    this.isLoading.set(true);
    this.loadingProgress.set(0);
    this.loadingStatus.set('Initializing WebGPU...');

    try {
      this.engine = new webllm.MLCEngine();
      
      this.engine.setInitProgressCallback((report: webllm.InitProgressReport) => {
        this.loadingStatus.set(report.text);
        // Extract percentage if possible, or use a heuristic
        this.loadingProgress.set(Math.round(report.progress * 100));
      });

      await this.engine.reload(modelId);
      this.currentModelId.set(modelId);
    } catch (error: any) {
      console.error('WebLLM Error:', error);
      this.loadingStatus.set(`Error: ${error.message}`);
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }

  async *streamChat(
    modelId: string,
    messages: any[],
    temperature: number,
    abortSignal?: AbortSignal
  ): AsyncGenerator<{ content: string; done: boolean; stats?: any }> {
    if (this.currentModelId() !== modelId) {
      await this.loadModel(modelId);
    }

    if (!this.engine) throw new Error('Engine not initialized');

    const completion = await this.engine.chat.completions.create({
      messages,
      stream: true,
      temperature,
    });

    let totalContent = '';
    const startTime = Date.now();

    for await (const chunk of completion) {
      const content = chunk.choices[0]?.delta?.content || '';
      totalContent += content;
      yield { content, done: false };
      
      if (abortSignal?.aborted) {
        await this.engine.interruptGenerate();
        break;
      }
    }

    const elapsed = Date.now() - startTime;
    yield {
      content: '',
      done: true,
      stats: {
        eval_count: totalContent.split(' ').length, // Rough estimate
        eval_duration: elapsed * 1000000,
        total_duration: elapsed * 1000000,
      }
    };
  }

  async unloadModel(): Promise<void> {
    if (this.engine) {
      await this.engine.unload();
      this.engine = null;
      this.currentModelId.set(null);
    }
  }
}
