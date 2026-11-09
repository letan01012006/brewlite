"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuthStore } from "@/store/auth-store";
import { safeRedirect } from "@/lib/safe-redirect";
import type { User } from "@/types";

export default function VerifyOtpPage() {
  return <Suspense fallback={<p>Đang tải xác thực...</p>}><VerifyOtpForm /></Suspense>;
}

function VerifyOtpForm() {
  const params = useSearchParams();
  const phone = params.get("phone") ?? "";
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [remaining, setRemaining] = useState(params.get("resendAfter") === "60" ? 60 : 0);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining(remaining - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const res = await apiFetch<{ user: User; accessToken: string }>("/auth/verify-otp", {
        method: "POST", auth: false, body: JSON.stringify({ phone, code }),
      });
      setAuth(res.user, res.accessToken);
      router.replace(safeRedirect(params.get("redirect")));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Không thể xác thực. Vui lòng thử lại.");
    } finally { setBusy(false); }
  }

  async function resend() {
    setBusy(true); setMessage("");
    try {
      await apiFetch("/auth/resend-otp", { method: "POST", auth: false, body: JSON.stringify({ phone }) });
      setRemaining(60); setCode(""); setMessage("Đã gửi mã mới. Vui lòng kiểm tra SMS.");
    } catch (error) {
      if (error instanceof ApiError && error.code === "OTP_RESEND_TOO_SOON") setRemaining(60);
      setMessage(error instanceof ApiError ? error.message : "Không thể gửi OTP. Vui lòng thử lại.");
    } finally { setBusy(false); }
  }

  if (!/^0[0-9]{9}$/.test(phone)) return <Link href="/register">Số điện thoại không hợp lệ. Quay lại đăng ký.</Link>;
  return <section className="w-full rounded-3xl border border-stone-300 bg-white p-8 dark:bg-stone-950 space-y-5">
    <h1 className="text-2xl font-bold">Xác thực số điện thoại</h1>
    <p>Nhập mã SMS gồm 6 chữ số gửi tới {phone}. Mã có hiệu lực 5 phút, tối đa 5 lần nhập sai.</p>
    {message && <p role="status" className="text-sm text-amber-700">{message}</p>}
    <form onSubmit={verify} className="space-y-4">
      <label className="block">Mã OTP
        <input name="code" aria-label="Mã OTP" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required className="mt-2 w-full rounded-xl border border-stone-300 p-3 text-2xl tracking-widest dark:bg-stone-900" />
      </label>
      <button disabled={busy} className="w-full rounded-xl bg-amber-700 text-white p-3 disabled:opacity-50">{busy ? "Đang xử lý..." : "Xác thực và đăng nhập"}</button>
    </form>
    <button onClick={() => void resend()} disabled={busy || remaining > 0} className="underline disabled:opacity-50">{remaining ? `Gửi lại sau ${remaining} giây` : "Gửi lại OTP"}</button>
    <Link href="/login" className="block text-sm underline">Quay lại đăng nhập</Link>
  </section>;
}
