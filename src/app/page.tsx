'use client';

import { useState, useEffect } from 'react';
import { TeacherProLayout } from '@/components/teacher-pro/layout';

/**
 * Hydration-safe wrapper: Zustand persist middleware reads from localStorage
 * on the client, which can differ from the server-rendered HTML and cause
 * React error #418 (hydration mismatch). We skip rendering until the
 * client-side store has fully hydrated.
 */
function HydrationGuard({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100dvh',
          fontFamily: 'system-ui, sans-serif',
          direction: 'rtl',
          color: '#6b21a8',
          gap: '12px',
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span>جاري التحميل...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  return <>{children}</>;
}

export default function Home() {
  return (
    <HydrationGuard>
      <TeacherProLayout />
    </HydrationGuard>
  );
}
