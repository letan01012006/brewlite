"use client";

import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";

export function LogoutButton() {
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (!window.confirm("Bạn có chắc muốn đăng xuất?")) return;
        logout();
        router.replace("/login");
      }}
      title="Đăng xuất"
      aria-label="Đăng xuất"
      className="p-2 text-stone-300 hover:text-red-300 hover:bg-red-950/30 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 light:text-cafe-muted cafe-icon light:hover:text-rose-700 light:hover:bg-rose-50"
    >
      <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    </button>
  );
}
