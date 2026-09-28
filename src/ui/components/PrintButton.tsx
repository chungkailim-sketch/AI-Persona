'use client';
import { Icon } from './Icon';

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink hover:border-brand">
      <Icon name="print" size={14} /> Print or save as PDF
    </button>
  );
}
