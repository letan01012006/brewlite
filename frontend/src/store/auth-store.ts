import { create } from "zustand";
import type { User } from "@/types";
import { apiFetch } from "@/lib/api/client";
import { accessToken, saveToken, onUnauthorized } from "@/lib/auth-session";
import { useCartStore } from "@/store/cart-store";

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  expire: () => void;
  initAuth: () => Promise<void>;
  refreshUser: () => Promise<void>;
}
let generation = 0;
let initialized = false;
let initialRequest: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isLoading: true,
  error: null,
  setAuth: (user, token) => {
    generation++;
    initialized = true;
    saveToken(token);
    useCartStore.getState().hydrate(user.id);
    set({ user, token, isLoading: false, error: null });
  },
  logout: () => {
    generation++;
    initialized = true;
    saveToken(null);
    useCartStore.getState().deactivate();
    useCartStore.getState().hydrate(null);
    set({ user: null, token: null, isLoading: false, error: null });
  },
  expire: () => {
    get().logout();
    set({
      error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    });
  },
  refreshUser: async () => {
    const token = get().token;
    if (!token) return;
    const request = ++generation;
    try {
      const user = await apiFetch<User>("/auth/me", { token });
      if (
        request !== generation ||
        get().token !== token ||
        accessToken() !== token
      )
        return;
      useCartStore.getState().hydrate(user.id);
      set({ user, isLoading: false, error: null });
    } catch {
      if (request !== generation || get().token !== token) return;
      set({
        isLoading: false,
        error:
          'Chưa cập nhật được tài khoản. Vui lòng kiểm tra kết nối và thử lại.',
      });
    }
  },
  initAuth: async () => {
    const token = accessToken();
    if (initialRequest && token === get().token) return initialRequest;
    if (initialized && token === get().token) return;
    generation++;
    initialized = true;
    if (!token) {
      useCartStore.getState().deactivate();
      useCartStore.getState().hydrate(null);
      set({ user: null, token: null, isLoading: false });
      return;
    }
    useCartStore.getState().deactivate();
    set({ token, user: null, isLoading: true, error: null });
    const request = get().refreshUser();
    initialRequest = request;
    await request;
    if (initialRequest === request) initialRequest = null;
  },
}));
onUnauthorized((token) => {
  if (useAuthStore.getState().token === token) useAuthStore.getState().expire();
});
