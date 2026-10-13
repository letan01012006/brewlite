'use client';

import { create } from 'zustand';
import { readPreference, writePreference } from '@/lib/browser-storage';

export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  initTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'light',

  initTheme: () => {
    if (typeof window === 'undefined') return;
    const isDarkInDom = document.documentElement.classList.contains('dark');
    const stored = readPreference('localStorage', 'brewlite_theme');
    const saved = stored === 'dark' || stored === 'light' ? stored : null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme: Theme = saved || (isDarkInDom ? 'dark' : prefersDark ? 'dark' : 'light');

    if (initialTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    set({ theme: initialTheme });
  },

  toggleTheme: () => {
    const isCurrentlyDark = document.documentElement.classList.contains('dark');
    const next: Theme = isCurrentlyDark ? 'light' : 'dark';

    if (typeof window !== 'undefined') {
      writePreference('localStorage', 'brewlite_theme', next);
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }

    set({ theme: next });
  },
}));
