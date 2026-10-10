let memoryToken: string | null = null;
let memoryOnly = false;
const listeners = new Set<(token: string) => void>();

export function accessToken() {
  if (typeof window === "undefined") return null;
  if (memoryOnly) return memoryToken;
  try {
    return localStorage.getItem("brewlite_token");
  } catch {
    return memoryToken;
  }
}

export function saveToken(token: string | null) {
  memoryToken = token;
  memoryOnly = false;
  if (typeof window === "undefined") return;
  try {
    if (token) localStorage.setItem("brewlite_token", token);
    else localStorage.removeItem("brewlite_token");
    localStorage.removeItem("brewlite_user");
  } catch {
    memoryOnly = true;
    /* Sign-in still works for this tab when storage is unavailable. */
  }
}

export function onUnauthorized(listener: (token: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function unauthorized(token: string) {
  // A late 401 from an old account must not sign out a newer session.
  if (accessToken() === token) listeners.forEach((listener) => listener(token));
}
