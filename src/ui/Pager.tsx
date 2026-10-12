'use client';

/**
 * Show a long list five items at a time.
 *
 * Presentation only: every item is still rendered on the server and passed in, so nothing about
 * what a list contains changes — only how much of it is on screen at once.
 */
import { useState, type ReactNode } from 'react';

export const PAGE_SIZE = 5;

export function usePage(total: number, size = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages - 1);
  return { page: current, pages, start: current * size, end: Math.min(total, (current + 1) * size), setPage };
}

export function PagerControls({
  page,
  pages,
  start,
  end,
  total,
  setPage,
}: {
  page: number;
  pages: number;
  start: number;
  end: number;
  total: number;
  setPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
      <button
        type="button"
        className="rounded border border-line px-2 py-0.5 disabled:opacity-40"
        onClick={() => setPage(page - 1)}
        disabled={page === 0}
      >
        Previous
      </button>
      <span className="font-mono">
        {`${start + 1}–${end} of ${total}`}
      </span>
      <button
        type="button"
        className="rounded border border-line px-2 py-0.5 disabled:opacity-40"
        onClick={() => setPage(page + 1)}
        disabled={page >= pages - 1}
      >
        Next
      </button>
      <span>
        {`Page ${page + 1} of ${pages}`}
      </span>
    </nav>
  );
}

/** A list (ul/ol) whose items are paged. */
export function PagedList({ items, as = 'ul', className }: { items: ReactNode[]; as?: 'ul' | 'ol'; className?: string }) {
  const p = usePage(items.length);
  const Tag = as;
  return (
    <>
      <Tag className={className}>{items.slice(p.start, p.end)}</Tag>
      <PagerControls {...p} total={items.length} />
    </>
  );
}

/** A table whose body rows are paged; the header stays put. */
export function PagedTable({ head, rows, className }: { head: ReactNode; rows: ReactNode[]; className?: string }) {
  const p = usePage(rows.length);
  return (
    <>
      <table className={className}>
        {head}
        <tbody>{rows.slice(p.start, p.end)}</tbody>
      </table>
      <PagerControls {...p} total={rows.length} />
    </>
  );
}
