'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal } from '@/components/ui/modal';
import { readPreference, writePreference } from '@/lib/browser-storage';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function getIsStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function subscribeStandalone(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  const mql = window.matchMedia('(display-mode: standalone)');
  mql.addEventListener('change', callback);
  window.addEventListener('appinstalled', callback);
  return () => {
    mql.removeEventListener('change', callback);
    window.removeEventListener('appinstalled', callback);
  };
}

const emptySubscribe = () => () => {};

function getIsIos() {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const isInstalled = useSyncExternalStore(subscribeStandalone, getIsStandalone, () => false);
  const isIos = useSyncExternalStore(emptySubscribe, getIsIos, () => false);

  useEffect(() => {
    if (!window.isSecureContext) return;
    let unregisterLoad: (() => void) | undefined;
    let iosTimer: ReturnType<typeof setTimeout> | undefined;

    // Detect iOS client and show banner if not dismissed
    if (isIos && !isInstalled) {
      const dismissed = readPreference('sessionStorage', 'brewlite_pwa_dismissed');
      if (!dismissed) {
        iosTimer = setTimeout(() => setIsVisible(true), 0);
      }
    }

    // Register Service Worker reliably without missing window 'load'
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const isProduction = process.env.NODE_ENV === 'production';
      const forceDev = new URLSearchParams(window.location.search).get('pwa') === '1';

      if (isProduction || forceDev) {
        const register = () => {
          navigator.serviceWorker
            .register('/sw.js')
            .then((registration) => {
              console.log('[PWA] Service Worker registered with scope:', registration.scope);
            })
            .catch((error) => {
              console.warn('[PWA] Service Worker registration failed:', error);
            });
        };

        if (document.readyState === 'complete') {
          register();
        } else {
          window.addEventListener('load', register);
          unregisterLoad = () => window.removeEventListener('load', register);
        }
      }
    }

    // Listen for BeforeInstallPromptEvent (Android / Chromium)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setInstallPrompt(promptEvent);

      const dismissed = readPreference('sessionStorage', 'brewlite_pwa_dismissed');
      if (!dismissed) {
        setIsVisible(true);
      }
    };

    const handleAppInstalled = () => {
      setIsVisible(false);
      setInstallPrompt(null);
      console.log('[PWA] App installed successfully');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      if (iosTimer) clearTimeout(iosTimer);
      unregisterLoad?.();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isIos, isInstalled]);

  const handleInstallClick = async () => {
    if (isIos) {
      setShowIosGuide(true);
      return;
    }

    if (!installPrompt) return;

    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
    } catch (err) {
      console.warn('[PWA] Install prompt error:', err);
    } finally {
      // MDN: prompt() can only be called once per event, clear prompt after user makes any choice
      setInstallPrompt(null);
      setIsVisible(false);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setShowIosGuide(false);
    writePreference('sessionStorage', 'brewlite_pwa_dismissed', 'true');
  };

  if (!isVisible || isInstalled) return null;

  return (
    <>
      <aside
        aria-label="Cài đặt ứng dụng"
        className="fixed top-[calc(var(--app-header-height)+0.5rem)] left-4 right-4 max-w-sm mx-auto z-50 bg-[#1c1410]/95 dark:bg-stone-900/95 text-stone-100 border border-amber-500/40 rounded-2xl p-3 shadow-2xl backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-4 duration-300"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-lg shadow shrink-0">
            ☕
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-amber-200 truncate">Cài đặt ứng dụng BrewLite</h2>
            <p className="text-[11px] text-stone-300 truncate">
              {isIos ? 'Thêm vào Màn hình chính trên iOS' : 'Đặt nước nhanh từ màn hình chính'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleInstallClick}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-95 text-stone-950 font-bold text-xs transition-all shadow cursor-pointer"
          >
            {isIos ? 'Hướng dẫn' : 'Cài đặt'}
          </button>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Đóng thông báo"
          >
            ✕
          </button>
        </div>
      </aside>

      {/* Modal Hướng dẫn cài đặt thủ công cho iOS Safari */}
      {showIosGuide && (
        <Modal onClose={() => setShowIosGuide(false)} labelledBy="ios-guide-title">
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in"
        >
          <div className="bg-[#1c1410] border border-amber-500/30 rounded-3xl p-5 max-w-sm w-full text-stone-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 id="ios-guide-title" className="font-bold text-amber-200 text-sm flex items-center gap-2">
                <span>📱</span> Cài đặt BrewLite trên iOS
              </h3>
              <button
                onClick={() => setShowIosGuide(false)}
                className="text-stone-400 hover:text-stone-200 text-sm p-1"
                aria-label="Đóng hướng dẫn"
              >
                ✕
              </button>
            </div>

            <ol className="text-xs text-stone-300 space-y-2.5 list-decimal list-inside leading-relaxed">
              <li>
                Mở trình duyệt <strong>Safari</strong> và nhấn nút <strong>Chia sẻ (Share) ⎋</strong> ở thanh dưới cùng.
              </li>
              <li>
                Cuộn xuống chọn <strong>Thêm vào Màn hình chính</strong> (<em>Add to Home Screen</em> ⊞).
              </li>
              <li>
                Nhấn <strong>Thêm</strong> (<em>Add</em>) ở góc trên bên phải màn hình để hoàn tất.
              </li>
            </ol>

            <button
              onClick={() => setShowIosGuide(false)}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs transition-all shadow"
            >
              Đã hiểu
            </button>
          </div>
        </div>
        </Modal>
      )}
    </>
  );
}
