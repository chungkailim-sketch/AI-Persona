import type { ReactNode } from 'react';
import { SimulationNotice } from './SimulationNotice';
import { BrandLogo } from '../shell/BrandLogo';

/**
 * Report mode: the result without the operating chrome. Keeps what a reader two months later needs
 * — brand, title, date, run configuration, methodology, evidence, limitations and the simulation
 * notice — in a page-friendly single column that prints on the light palette.
 */
export function ReportModeLayout({
  title,
  projectName,
  generatedAt,
  isMock,
  config,
  actions,
  children,
}: {
  title: string;
  projectName: string;
  generatedAt: string;
  isMock: boolean;
  config: { label: string; value: string }[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="no-print sticky top-0 z-10 border-b border-line bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-[860px] items-center justify-between gap-3 px-5 py-2">{actions}</div>
      </div>
      <article id="main" className="mx-auto max-w-[860px] px-5 py-8 print:max-w-none print:px-0 print:py-0" data-report-mode>
        <header className="border-b border-line pb-5">
          <div className="flex items-center gap-2">
            <BrandLogo height={22} />
            <span className="sr-only">RF AI Persona Intelligence</span>
            <span className="ml-auto font-mono text-[11px] text-ink-subtle">Generated {generatedAt}</span>
          </div>
          <p className="eyebrow mt-5">{projectName}</p>
          <h1 className="mt-1 text-3xl">{title}</h1>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-3">
            {config.map((c) => (
              <div key={c.label} className="min-w-0">
                <dt className="text-ink-subtle">{c.label}</dt>
                <dd className="break-words font-mono text-[11.5px] text-ink">{c.value}</dd>
              </div>
            ))}
          </dl>
        </header>
        <SimulationNotice isMock={isMock} className="mt-5" />
        <div className="mt-6 flex flex-col gap-8">{children}</div>
      </article>
    </div>
  );
}
