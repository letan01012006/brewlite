import React from 'react';
import { AppHeader } from '@/components/layout/app-header';

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12 pt-2 md:pt-6 transition-all">
        {children}
      </main>

    </div>
  );
}
