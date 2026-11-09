"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";

export function CustomerGate({ children }: { children: ReactNode }) {
  const { user, token, isLoading, error, initAuth, refreshUser } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (!isLoading && user?.role === "BARISTA") router.replace("/barista");
    if (!isLoading && user?.role === "MANAGER") router.replace("/manager");
  }, [isLoading, user, router]);

  if (isLoading)
    return <p className="p-8 text-center">Đang kiểm tra tài khoản...</p>;

  if (token && !user)
    return (
      <div className="p-8 text-center space-y-3">
        <p>{error || "Đang tải tài khoản..."}</p>
        <button onClick={() => void refreshUser()} className="underline">
          Thử lại
        </button>
      </div>
    );

  if (user?.role === "BARISTA" || user?.role === "MANAGER") return null;

  return children;
}
