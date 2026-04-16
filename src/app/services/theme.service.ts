import { Injectable, signal, effect } from '@angular/core';

export interface ThemePreset {
  id: string;
  name: string;
  color: string;
  gradient: string;
}

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  presets: ThemePreset[] = [
    { id: 'purple', name: 'Nexus Purple', color: '#8B5CF6', gradient: 'linear-gradient(135deg, #8B5CF6, #7C3AED)' },
    { id: 'blue', name: 'Cyber Blue', color: '#3B82F6', gradient: 'linear-gradient(135deg, #3B82F6, #2563EB)' },
    { id: 'emerald', name: 'Emerald', color: '#10B981', gradient: 'linear-gradient(135deg, #10B981, #059669)' },
    { id: 'orange', name: 'Sunset', color: '#F59E0B', gradient: 'linear-gradient(135deg, #F59E0B, #D97706)' },
    { id: 'rose', name: 'Ruby', color: '#F43F5E', gradient: 'linear-gradient(135deg, #F43F5E, #E11D48)' },
    { id: 'cyan', name: 'Ocean', color: '#06B6D4', gradient: 'linear-gradient(135deg, #06B6D4, #0891B2)' },
  ];

  activeTheme = signal<ThemePreset>(this.loadTheme());

  constructor() {
    effect(() => {
      const theme = this.activeTheme();
      this.applyTheme(theme);
    });
  }

  saveCurrentTheme(): void {
    localStorage.setItem('nexus-theme', JSON.stringify(this.activeTheme()));
  }

  private loadTheme(): ThemePreset {
    const stored = localStorage.getItem('nexus-theme');
    if (stored) return JSON.parse(stored);
    return this.presets[0];
  }

  setTheme(preset: ThemePreset): void {
    this.activeTheme.set(preset);
  }

  setThemeById(id: string): void {
    const preset = this.presets.find(p => p.id === id);
    if (preset) this.activeTheme.set(preset);
  }

  private applyTheme(theme: ThemePreset): void {
    const root = document.documentElement;
    root.style.setProperty('--accent-color', theme.color);
    root.style.setProperty('--accent-gradient', theme.gradient);
    
    // Calculate RGB for glow
    const rgb = this.hexToRgb(theme.color);
    if (rgb) {
      root.style.setProperty('--accent-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
      root.style.setProperty('--accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`);
    }
  }

  private hexToRgb(hex: string): { r: number, g: number, b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }
}
