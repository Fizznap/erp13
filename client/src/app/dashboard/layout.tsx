'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function MobileDashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  const navItems = [
    { href: '/dashboard', label: 'Feed', icon: '▤' },
    { href: '/dashboard/classroom', label: 'Classroom', icon: '◈' },
    { href: '/dashboard/help', label: 'Help', icon: '?' },
    { href: '/dashboard/reminders', label: 'Reminders', icon: '!' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--color-bg-secondary)' }}>
      
      {/* Top Header */}
      <header style={{
        height: 56,
        background: 'var(--color-bg-primary)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        justifyContent: 'space-between',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, background: 'var(--color-accent)', borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Snippet</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{user.fullName}</span>
          <button onClick={logout} className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }}>Out</button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {children}
      </main>

      {/* Mobile-first Bottom Nav */}
      <nav style={{
        height: 64,
        background: 'var(--color-bg-primary)',
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        flexShrink: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                width: '100%',
                height: '100%',
                textDecoration: 'none',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              <span style={{ fontSize: 20, fontWeight: isActive ? 700 : 400 }}>{item.icon}</span>
              <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

    </div>
  );
}
