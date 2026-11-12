import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/600.css';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { loadReport } from '@/roundtable/report';
import { SlideDeck } from '@/ui/report/Slides';
import { PrintButton } from '@/ui/components/PrintButton';
import { projectModules } from '@/modules/project';
import { LANG_COOKIE, parseLang } from '@/ui/i18n/translate';
import { DECK_LANGUAGES, isDeckLang, type DeckLang } from '@/roundtable/reportLocale';
import { DeckTranslator } from '@/ui/report/DeckTranslator';

export const metadata = { title: 'Roundtable report · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

const HTML_LANG: Record<DeckLang, string> = { en: 'en', zh: 'zh-CN', id: 'id', vi: 'vi', th: 'th', fr: 'fr', pt: 'pt', es: 'es' };

/**
 * The slide report with no application chrome. "Print or save as PDF" prints one slide per page
 * at 16:9 (13.333 × 7.5 in); in the print dialog choose "Save as PDF" and turn on background graphics.
 *
 * The language switch shows the whole deck — labels and content — in English, Chinese, Bahasa
 * Indonesia, Vietnamese, Thai, French, Portuguese or Spanish; the PDF prints in that language.
 */
export default async function RoundtableReportPage(props: PageProps<'/projects/[projectId]/report'>) {
  const { projectId } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser(`/projects/${projectId}/report`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'report.view', projectId)) notFound();
  const report = await loadReport(projectId);
  if (!report) notFound();
  // The deck's language: chosen here, else the interface language.
  const asked = Array.isArray(search.lang) ? search.lang[0] : search.lang;
  const lang: DeckLang = isDeckLang(asked) ? asked : parseLang((await cookies()).get(LANG_COOKIE)?.value) === 'zh' ? 'zh' : 'en';

  return (
    <div className="min-h-dvh bg-bg">
      <div className="no-print sticky top-0 z-10 border-b border-line bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-5 py-2">
          <Link href={`/projects/${projectId}/results` as Route} className="text-sm text-link underline-offset-2 hover:underline">← Back to the project</Link>
          <nav aria-label="Report language" className="flex flex-wrap items-center gap-1" data-no-translate>
            {(Object.keys(DECK_LANGUAGES) as DeckLang[]).map((k) => (
              <Link
                key={k}
                href={`/projects/${projectId}/report?lang=${k}` as Route}
                lang={HTML_LANG[k]}
                aria-current={k === lang ? 'true' : undefined}
                className={`rounded-full border px-2.5 py-1 text-xs ${k === lang ? 'border-brand bg-brand-soft font-semibold text-ink' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'}`}
              >
                {DECK_LANGUAGES[k].label}
              </Link>
            ))}
          </nav>
          <PrintButton />
        </div>
      </div>
      <DeckTranslator key={lang} projectId={projectId} lang={lang} label={DECK_LANGUAGES[lang].label} rootId="deck" />
      <main
        id="main"
        lang={HTML_LANG[lang]}
        data-no-translate
        className="mx-auto max-w-[1320px] px-5 py-6 print:max-w-none print:p-0"
        style={lang === 'th' ? { fontFamily: "var(--font-sans), 'Noto Sans Thai', sans-serif" } : undefined}
      >
        <div id="deck">
          <SlideDeck r={report} modules={await projectModules(projectId)} />
        </div>
      </main>
    </div>
  );
}
