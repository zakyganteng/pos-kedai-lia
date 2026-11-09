'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId } from 'react';
import { useSession } from '@/hooks/use-session';
import type { CurrentUser } from '@/lib/types';

/** `roles` omitted means every signed in role sees the link. */
const NAV: { href: string; label: string; roles?: CurrentUser['role'][] }[] = [
  { href: '/kasir', label: 'Kasir' },
  { href: '/struk', label: 'Struk' },
  { href: '/katalog', label: 'Katalog', roles: ['owner', 'admin'] },
];

export function AppHeader() {
  const { user, lines, line, requestLineChange, logout, loggingOut } = useSession();
  const pathname = usePathname();
  const selectId = useId();

  // A cashier is not offered a link the backend would refuse anyway.
  const nav = NAV.filter((item) => item.roles === undefined || item.roles.includes(user.role));

  return (
    <header className="app-header no-print">
      <div className="app-header-inner">
        <Link href="/kasir" className="wordmark">
          Lia POS
        </Link>

        <nav className="app-nav" aria-label="Navigasi utama">
          {nav.map((item) => {
            const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                aria-current={current ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="header-right">
          <div className="line-pick">
            <label className="field-label" htmlFor={selectId}>
              Unit usaha
            </label>
            {lines.length > 1 ? (
              <select
                id={selectId}
                className="select"
                value={line.id}
                onChange={(event) => requestLineChange(event.target.value)}
              >
                {lines.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="line-static" id={selectId}>
                {line.name}
              </span>
            )}
          </div>

          <span className="meta header-user">{user.name}</span>

          <button type="button" className="btn btn-secondary" onClick={logout} disabled={loggingOut}>
            {loggingOut ? 'Keluar…' : 'Keluar'}
          </button>
        </div>
      </div>
    </header>
  );
}
