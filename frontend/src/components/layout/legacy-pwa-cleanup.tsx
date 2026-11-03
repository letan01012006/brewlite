'use client';

import { useEffect } from 'react';
import { cleanupLegacyPwa } from '@/lib/legacy-pwa-cleanup';

export function LegacyPwaCleanup() {
  useEffect(() => {
    void cleanupLegacyPwa();
  }, []);
  return null;
}
