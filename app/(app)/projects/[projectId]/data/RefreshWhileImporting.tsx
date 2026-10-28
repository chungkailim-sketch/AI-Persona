'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-reads the page every few seconds while any file is still importing, then stops. */
export function RefreshWhileImporting({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
