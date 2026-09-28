/**
 * Interface language (English / Simplified Chinese).
 *
 * The interface is written in English in the components. When Chinese is chosen, the rendered
 * wording is swapped for its translation in the browser, phrase by phrase, from the `ZH`
 * dictionary. Anything not in the dictionary — dataset values, persona text, model output, names —
 * is left exactly as it is, so translation can never alter data.
 */
import { ZH } from './zh';

export type Lang = 'en' | 'zh';
export const LANG_COOKIE = 'pi_lang';
export const LANG_EVENT = 'pi:lang';

export function parseLang(v: string | undefined | null): Lang {
  return v === 'zh' ? 'zh' : 'en';
}

const NUMBER = /\d[\d,.]*/g;

/**
 * Translate one piece of interface text, or return null when it is not interface wording.
 * Surrounding whitespace is kept, so a phrase between two elements still reads correctly.
 */
export function translate(text: string, dict: Record<string, string> = ZH): string | null {
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  const core = text.slice(lead.length, text.length - trail.length).replace(/\s+/g, ' ');
  if (!core || !/[A-Za-z]/.test(core)) return null;

  const exact = dict[core];
  if (exact !== undefined) return lead + exact + trail;

  const numbers = core.match(NUMBER);
  if (!numbers) return null;
  const template = dict[core.replace(NUMBER, '#')];
  if (template === undefined) return null;
  // `#1`, `#2` … place numbers by position, for phrases whose word order differs in translation.
  if (/#\d/.test(template)) return lead + template.replace(/#(\d)/g, (_, n: string) => numbers[Number(n) - 1] ?? '#') + trail;
  let i = 0;
  return lead + template.replace(/#/g, () => numbers[i++] ?? '#') + trail;
}
