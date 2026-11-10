'use client';

import type { Pagination } from '@/lib/types';

/** Previous/next pager shared by every paginated list. Hidden for one page. */
export function Pager({
  label,
  page,
  pagination,
  loading,
  onPage,
}: {
  /** Accessible name, e.g. "Halaman daftar pelanggan". */
  label: string;
  page: number;
  pagination: Pagination | null;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const totalPages = pagination?.totalPages ?? 1;
  if (totalPages <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1 || loading}
      >
        Sebelumnya
      </button>
      <span className="meta" role="status">
        Halaman {pagination?.page ?? page} dari {totalPages}
        {pagination ? ` · ${pagination.total} data` : ''}
      </span>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages || loading}
      >
        Berikutnya
      </button>
    </nav>
  );
}
