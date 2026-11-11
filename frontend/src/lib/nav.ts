import type { BusinessLine, Role } from './types';

export type NavItem = {
  href: string;
  label: string;
  /** Omitted: every signed-in role. */
  roles?: readonly Role[];
  /** Omitted: every business line type. */
  lineType?: BusinessLine['type'];
};

const MANAGERS: readonly Role[] = ['owner', 'admin'];
const OWNER: readonly Role[] = ['owner'];

/**
 * Main navigation. Roles and line types mirror the backend's own checks, so a
 * link is only shown where the API will answer it.
 */
export const NAV: readonly NavItem[] = [
  { href: '/kasir', label: 'Kasir' },
  { href: '/antrean', label: 'Antrean', lineType: 'salon' },
  { href: '/struk', label: 'Struk' },
  { href: '/laporan', label: 'Laporan' },
  { href: '/stok', label: 'Stok', lineType: 'food_beverage' },
  { href: '/katalog', label: 'Katalog', roles: MANAGERS },
  { href: '/pelanggan', label: 'Pelanggan' },
  { href: '/notifikasi', label: 'Notifikasi', roles: MANAGERS },
  { href: '/rekonsiliasi', label: 'Rekonsiliasi', roles: MANAGERS },
  { href: '/pengguna', label: 'Pengguna', roles: OWNER },
  { href: '/sistem', label: 'Sistem', roles: OWNER },
];

export function visibleNav(role: Role, lineType: BusinessLine['type']): NavItem[] {
  return NAV.filter(
    (item) =>
      (item.roles === undefined || item.roles.includes(role)) &&
      (item.lineType === undefined || item.lineType === lineType),
  );
}

export function canManage(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

export function isOwner(role: Role): boolean {
  return role === 'owner';
}
