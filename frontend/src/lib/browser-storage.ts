// Optional preferences must never prevent the application from starting.
export function readPreference(storage: 'localStorage' | 'sessionStorage', key: string): string | null {
  try { return window[storage].getItem(key); } catch { return null; }
}

export function writePreference(storage: 'localStorage' | 'sessionStorage', key: string, value: string): void {
  try { window[storage].setItem(key, value); } catch { /* Keep in-memory UI state. */ }
}
