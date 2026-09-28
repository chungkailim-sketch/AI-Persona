/**
 * A small, original outline icon set (24-unit grid, 1.75 stroke, currentColor). Icons are always
 * paired with text or an accessible label; on their own they are `aria-hidden`.
 */
import type { SVGProps } from 'react';

const PATHS: Record<string, string> = {
  check: 'M5 12.5l4.2 4.2L19 7',
  alert: 'M12 4l9 16H3L12 4zM12 10v4.5M12 17.5v.01',
  cross: 'M6 6l12 12M18 6L6 18',
  dot: 'M12 12m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
  live: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 12m-8.5 0a8.5 8.5 0 1 0 17 0',
  minus: 'M6 12h12',
  retry: 'M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1M17.5 3.5v3.6h-3.6M6.5 20.5v-3.6h3.6',
  slash: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M6.4 17.6L17.6 6.4',
  clock: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 7.5V12l3 2',
  flag: 'M6 20V4.5M6 5h10.5l-2 3.5 2 3.5H6',
  hand: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a5.5 5.5 0 0 1-4.6-2.5L4.5 14.5a1.5 1.5 0 0 1 2.5-1.6L8 14',
  home: 'M4 11l8-6.5 8 6.5M6 9.5V19h12V9.5',
  folder: 'M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2H19a1.5 1.5 0 0 1 1.5 1.5V17A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17z',
  database: 'M12 4c4.1 0 7 1.1 7 2.5S16.1 9 12 9 5 7.9 5 6.5 7.9 4 12 4zM5 6.5v11C5 18.9 7.9 20 12 20s7-1.1 7-2.5v-11M5 12c0 1.4 2.9 2.5 7 2.5s7-1.1 7-2.5',
  doc: 'M7 3.5h7l4 4v13H7zM14 3.5V8h4M9.5 12h6M9.5 15.5h6',
  users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M17.5 14a5.5 5.5 0 0 1 3 5',
  play: 'M8 5.5v13l10.5-6.5z',
  chart: 'M4.5 19.5h15M7 16V11M11 16V7M15 16v-6M19 16V9',
  sliders: 'M5 7h9M18 7h1M5 17h2M11 17h8M14 5v4M7 15v4',
  gear: 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM12 3.5l1.6 2.3 2.7-.6.6 2.7 2.3 1.6-1.4 2.5 1.4 2.5-2.3 1.6-.6 2.7-2.7-.6L12 20.5l-1.6-2.3-2.7.6-.6-2.7-2.3-1.6 1.4-2.5-1.4-2.5 2.3-1.6.6-2.7 2.7.6z',
  shield: 'M12 3.5l7 2.8v5.2c0 4.3-2.9 7.5-7 9-4.1-1.5-7-4.7-7-9V6.3z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chevronLeft: 'M14.5 6l-6 6 6 6',
  chevronRight: 'M9.5 6l6 6-6 6',
  chevronDown: 'M6 9.5l6 6 6-6',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4',
  moon: 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z',
  monitor: 'M3.5 5h17v11h-17zM9 20h6M12 16v4',
  help: 'M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.01',
  copy: 'M9 9h10.5v10.5H9zM15 9V4.5H4.5V15H9',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14',
  search: 'M10.5 10.5m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M15 15l5 5',
  pause: 'M8.5 6v12M15.5 6v12',
  resume: 'M8 5.5v13l10.5-6.5z',
  arrowDown: 'M12 5v14M6.5 13.5L12 19l5.5-5.5',
  external: 'M14 4.5h5.5V10M19.5 4.5l-8 8M17 14v5.5H4.5V7H10',
  print: 'M7 9V4h10v5M7 17H4.5v-7h15v7H17M7 14h10v6H7z',
  plug: 'M9 3.5v5M15 3.5v5M6.5 8.5h11v2.5a5.5 5.5 0 0 1-11 0zM12 16.5v4',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, title, ...rest }: { name: string; size?: number; title?: string } & SVGProps<SVGSVGElement>) {
  const d = PATHS[name] ?? PATHS.dot!;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
