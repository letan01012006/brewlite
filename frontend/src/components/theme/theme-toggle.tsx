'use client';

import React, { useEffect, useState } from 'react';
import { useThemeStore } from '@/store/theme-store';

export function ThemeToggle() {
  const { theme, toggleTheme, initTheme } = useThemeStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    initTheme();
    setMounted(true);
  }, [initTheme]);

  if (!mounted) {
    return <div className="w-8 h-8 rounded-xl bg-amber-900/40" />;
  }

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Chuyển chế độ Sáng / Tối"
      title={isDark ? 'Chuyển sang Giao diện Sáng' : 'Chuyển sang Giao diện Tối'}
      className="p-2 rounded-xl bg-amber-900/40 hover:bg-amber-800/60 dark:bg-stone-800 dark:hover:bg-stone-700 border border-amber-800/60 dark:border-stone-700 text-amber-200 hover:text-white transition-all cursor-pointer flex items-center justify-center active:scale-95 shadow-sm"
    >
      {isDark ? (
        <span className="text-base" role="img" aria-label="Giao diện Sáng">
          ☀️
        </span>
      ) : (
        <span className="text-base" role="img" aria-label="Giao diện Tối">
          🌙
        </span>
      )}
    </button>
  );
}
