import React from 'react';
import { AppHeader } from '@/components/layout/app-header';
import { BottomNav } from '@/components/layout/bottom-nav';

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Top Mobile Header */}
      <AppHeader />

      {/* Responsive Content Shell: Full width on mobile, expands up to max-w-7xl on desktop */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-[calc(8.5rem+env(safe-area-inset-bottom,0px))] md:pb-12 pt-2 md:pt-6 transition-all">
        {children}
      </main>

      {/* Bottom Navigation for Mobile */}
      <BottomNav />
    </div>
  );
}
