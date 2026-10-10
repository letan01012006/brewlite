"use client";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";

export function AuthGate({
  children,
  path,
  barista = false,
}: {
  children: ReactNode;
  path: string;
  barista?: boolean;
}) {
  const { user, token, isLoading, error, initAuth, refreshUser } =
    useAuthStore();
  const router = useRouter();
  useEffect(() => {
    void initAuth();
  }, [initAuth]);
  useEffect(() => {
    if (isLoading) return;
    if (!token) router.replace(`/login?redirect=${encodeURIComponent(path)}`);
    else if (user && barista && user.role !== "BARISTA") router.replace("/");
  }, [isLoading, token, user, barista, path, router]);
  if (!token || isLoading)
    return <p className="p-8 text-center">Đang kiểm tra đăng nhập...</p>;
  if (!user)
    return (
      <div className="p-8 text-center space-y-3">
        <p>{error || "Đang tải tài khoản..."}</p>
        <button onClick={() => void refreshUser()} className="underline">
          Thử lại
        </button>
      </div>
    );
  if (barista && user.role !== "BARISTA") return null;
  return children;
}
