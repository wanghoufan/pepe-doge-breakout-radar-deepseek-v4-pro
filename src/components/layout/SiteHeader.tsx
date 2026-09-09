'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: '总览' },
  { href: '/asset/PEPE', label: 'PEPE' },
  { href: '/asset/DOGE', label: 'DOGE' },
  { href: '/asset/ETHFI', label: 'ETHFI' },
  { href: '/history', label: '历史样本' },
  { href: '/similarity', label: '相似性' },
  { href: '/methodology', label: '方法论' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-radar/50 bg-radar/10">
            <span className="h-2.5 w-2.5 rounded-full bg-radar shadow-[0_0_10px_2px_rgba(46,230,168,0.7)]" />
          </span>
          <span className="text-sm font-semibold tracking-wide">
            PEPE·DOGE·ETHFI <span className="text-radar">突破雷达</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                isActive(item.href)
                  ? 'bg-radar/15 text-radar'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          className="rounded-md border border-border p-2 text-muted-foreground md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="切换菜单"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? (
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <nav className="border-t border-border/70 px-4 pb-3 pt-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                'block rounded-md px-3 py-2 text-sm',
                isActive(item.href) ? 'bg-radar/15 text-radar' : 'text-muted-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}