'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId } from 'react';
import { useSession } from '@/hooks/use-session';
import { visibleNav } from '@/lib/nav';

export function AppHeader() {
  const { user, lines, line, requestLineChange, logout, loggingOut } = useSession();
  const pathname = usePathname();
  const selectId = useId();

  // Links the backend would refuse for this role or line type are not offered.
  const nav = visibleNav(user.role, line.type);

  return (
    <header className="app-header no-print">
      <div className="app-header-inner">
        <Link href="/kasir" className="wordmark">
          Lia POS
        </Link>

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

      <nav className="app-nav" aria-label="Navigasi utama">
        <div className="app-nav-inner">
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
        </div>
      </nav>
    </header>
  );
}
