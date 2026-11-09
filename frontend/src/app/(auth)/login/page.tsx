"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { apiFetch, ApiError } from "@/lib/api/client";
import { safeRedirect } from "@/lib/safe-redirect";
import type { User } from "@/types";

interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: User;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={<p className="p-8 text-center">Đang tải đăng nhập...</p>}
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = safeRedirect(searchParams.get("redirect"));

  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const setAuth = useAuthStore((state) => state.setAuth);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg("Vui lòng nhập đầy đủ số điện thoại/email và mật khẩu");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ [mode]: email.trim(), password }),
      });

      // Lưu Auth vào Zustand Store & LocalStorage
      setAuth(res.user, res.accessToken);

      // Chuyển trang theo vai trò
      if (res.user.role === "BARISTA") {
        router.push("/barista");
      } else if (res.user.role === "MANAGER") {
        router.push("/manager");
      } else {
        router.push(redirectPath);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_NOT_VERIFIED" && mode === "phone") {
        router.push(`/verify-otp?phone=${encodeURIComponent(email.trim())}&redirect=${encodeURIComponent(redirectPath)}`);
      } else if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(
          "Không thể đăng nhập. Vui lòng kiểm tra lại kết nối backend.",
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full bg-white dark:bg-[#161210] rounded-3xl border border-[#ede5dc] dark:border-[#2a221c] p-6 sm:p-8 shadow-2xl space-y-6 animate-fadeIn light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
        {/* Header */}
        <div className="text-center space-y-1.5">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 flex items-center justify-center text-3xl mx-auto border border-amber-200/60 dark:border-amber-800/50 shadow-sm light:shadow-cafe-card light:bg-cafe-accent light:text-cafe-primary light:border-cafe-line ">
            ☕
          </div>
          <h1 className="text-2xl font-extrabold text-stone-900 dark:text-[#f4ede6] tracking-tight light:text-cafe-ink ">
            Đăng Nhập BrewLite
          </h1>
          <p className="text-xs text-stone-500 dark:text-[#a39589] light:text-cafe-muted ">
            Trải nghiệm đặt cà phê không tiền mặt & tích điểm thành viên
          </p>
        </div>

        {/* Thông báo lỗi */}
        {errorMsg && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl p-3 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2 animate-fadeIn">
            <span className="shrink-0 mt-0.5">⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form Đăng nhập */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="flex gap-4 text-sm">
            <button type="button" aria-pressed={mode === "phone"} onClick={() => { setMode("phone"); setEmail(""); }} className="underline">Số điện thoại</button>
            <button type="button" aria-pressed={mode === "email"} onClick={() => { setMode("email"); setEmail(""); }} className="underline">Email (tài khoản cũ)</button>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 dark:text-[#cfc3b9] block mb-1.5 light:text-cafe-muted ">
              {mode === "phone" ? "Số điện thoại" : "Email tài khoản cũ"} <span className="text-rose-500">*</span>
            </label>
            <input
              type={mode === "phone" ? "tel" : "email"}
              name={mode}
              autoComplete="username"
              pattern={mode === "phone" ? "0[0-9]{9}" : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={mode === "phone" ? "0912345678" : "example@brewlite.com"}
              required
              className="w-full text-sm px-4 py-2.5 rounded-xl border border-[#ede5dc] dark:border-[#2a221c] bg-white dark:bg-[#1a1411] text-stone-900 dark:text-[#f4ede6] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 placeholder:text-stone-400 dark:placeholder:text-[#6e5f54] light:border-cafe-line light:bg-cafe-surface light:text-cafe-ink light:focus:border-cafe-primary light:focus:ring-cafe-primary/20 light:placeholder:text-cafe-muted "
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 dark:text-[#cfc3b9] block mb-1.5 light:text-cafe-muted ">
              Mật khẩu <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu..."
                required
                className="w-full text-sm px-4 py-2.5 pr-10 rounded-xl border border-[#ede5dc] dark:border-[#2a221c] bg-white dark:bg-[#1a1411] text-stone-900 dark:text-[#f4ede6] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 placeholder:text-stone-400 dark:placeholder:text-[#6e5f54] light:border-cafe-line light:bg-cafe-surface light:text-cafe-ink light:focus:border-cafe-primary light:focus:ring-cafe-primary/20 light:placeholder:text-cafe-muted "
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-xs cursor-pointer light:text-cafe-muted light:hover:text-cafe-muted "
              >
                {showPassword ? "Ẩn" : "Hiện"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 disabled:opacity-40 text-white font-bold text-sm py-3 px-4 rounded-xl shadow-md shadow-amber-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed active:scale-98 light:shadow-cafe-card cafe-primary "
          >
            {isLoading ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Đang đăng nhập...</span>
              </>
            ) : (
              <span>Đăng Nhập</span>
            )}
          </button>
        </form>

        {/* Chuyển sang Đăng ký */}
        <div className="pt-2 text-center text-xs text-stone-500 dark:text-stone-400 border-t border-stone-100 dark:border-stone-800 light:text-cafe-muted light:border-cafe-line ">
          Chưa có tài khoản?{" "}
          <Link
            href={`/register${redirectPath ? `?redirect=${encodeURIComponent(redirectPath)}` : ""}`}
            className="font-bold text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 underline ml-1 light:text-cafe-primary light:hover:text-cafe-primary "
          >
            Đăng ký tài khoản mới
          </Link>
        </div>
      </div>
  );
}
