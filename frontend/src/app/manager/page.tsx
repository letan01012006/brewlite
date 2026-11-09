"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { LogoutButton } from "@/components/auth/logout-button";

export default function ManagerPage() {
  const { user, token, isLoading, initAuth, refreshUser, error } = useAuthStore();
  const router = useRouter();
  useEffect(() => { void initAuth(); }, [initAuth]);
  useEffect(() => {
    if (!isLoading && !token) router.replace("/login");
    if (!isLoading && user && user.role !== "MANAGER") router.replace(user.role === "BARISTA" ? "/barista" : "/");
  }, [isLoading, token, user, router]);
  if (isLoading || !token) return <p className="p-8">Đang kiểm tra đăng nhập...</p>;
  if (!user) return <div className="p-8"><p>{error}</p><button onClick={() => void refreshUser()}>Thử lại</button></div>;
  if (user.role !== "MANAGER") return null;
  return <main className="max-w-2xl mx-auto p-8 space-y-6">
    <h1 className="text-2xl font-bold">Quản lý BrewLite</h1>
    <p>Xin chào {user.fullName}. Tài khoản của bạn có quyền cấp nhân viên BARISTA.</p>
    <p>Mở Swagger, đăng nhập bằng số điện thoại tại POST /api/auth/login, sao chép accessToken vào Authorize rồi gọi POST /api/admin/staff.</p>
    <Link href="http://localhost:4000/api/docs" target="_blank" rel="noreferrer" className="block underline">Mở Swagger để cấp tài khoản nhân viên</Link>
    <LogoutButton />
  </main>;
}
