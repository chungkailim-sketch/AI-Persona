/**
 * A long section, collapsed by default (the same look as the Results step's "Report preview"). Its
 * title stays in view; the content opens on a click, or when a link points at an id inside it
 * (see OpenSectionFromHash, mounted by the app shell).
 */
export function Collapsible({
  title,
  note,
  open = false,
  id,
  className = '',
  children,
}: {
  title: React.ReactNode;
  /** One line after the title, in lighter type. */
  note?: React.ReactNode;
  open?: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={open} className={`panel scroll-mt-48 ${className}`}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
        {title}
        {note ? <span className="font-normal text-ink-subtle">{' — '}{note}</span> : null}
      </summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}
