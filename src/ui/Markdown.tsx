/**
 * A small, safe Markdown view: headings, paragraphs, lists, tables, bold and italics. It builds React
 * elements (never HTML strings), so text from a model or an uploaded file cannot inject markup.
 */
import type { ReactNode } from 'react';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) out.push(<strong key={`${key}-${i++}`}>{m[2]}</strong>);
    else if (m[3]) out.push(<em key={`${key}-${i++}`}>{m[3]}</em>);
    else if (m[4]) out.push(<code key={`${key}-${i++}`} className="rounded bg-bg px-1 text-[0.9em]">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const cls = level === 1 ? 'text-lg font-semibold' : level === 2 ? 'text-base font-semibold' : 'text-sm font-semibold';
      blocks.push(<p key={key} role="heading" aria-level={Math.min(6, level + 2)} className={`mt-3 text-ink ${cls}`}>{inline(h[2]!, key)}</p>);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key} className="my-2 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            {head && (
              <thead>
                <tr>{head.map((c, j) => <th key={j} className="border border-line bg-bg px-2 py-1 text-left font-semibold text-ink">{inline(c, `${key}h${j}`)}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} className="border border-line px-2 py-1 align-top text-ink-muted">{inline(c, `${key}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key} className={`my-1 pl-5 text-sm text-ink ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((t, j) => <li key={j}>{inline(t, `${key}i${j}`)}</li>)}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|\s*\||\s*([-*+]|\d+[.)])\s+)/.test(lines[i]!)) {
      para.push(lines[i]!.trim());
      i++;
    }
    blocks.push(<p key={key} className="my-1 text-sm text-ink">{inline(para.join(' '), key)}</p>);
  }
  return <div className={className}>{blocks}</div>;
}
