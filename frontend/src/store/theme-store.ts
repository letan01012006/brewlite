'use client';

import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  initTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',

  initTheme: () => {
    if (typeof window === 'undefined') return;
    const isDarkInDom = document.documentElement.classList.contains('dark');
    const saved = localStorage.getItem('brewlite_theme') as Theme | null;
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
      localStorage.setItem('brewlite_theme', next);
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }

    set({ theme: next });
  },
}));
