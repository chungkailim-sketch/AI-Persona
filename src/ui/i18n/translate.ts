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
const STRICT_NUMBER = /\d+(?:[.,]\d+)*/g;

/**
 * Translate one piece of interface text, or return null when it is not interface wording.
 * Surrounding whitespace is kept, so a phrase between two elements still reads correctly.
 */
export function translate(text: string, dict: Record<string, string> = ZH): string | null {
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  const core = text.slice(lead.length, text.length - trail.length).replace(/\s+/g, ' ');
  if (!core || !/[A-Za-z]/.test(core)) return null;

  const whole = translateCore(core, dict);
  if (whole !== null) return lead + whole + trail;
  const pieces = piecewise(core, dict);
  return pieces === null ? null : lead + pieces + trail;
}

// Translations a page adds for its own content (a report's model-written text, translated once and
// stored), consulted after the interface dictionary.
const EXTRA: Record<string, string> = {};
export function registerTranslations(entries: Record<string, string>): void {
  for (const [en, zh] of Object.entries(entries)) EXTRA[en.replace(/\s+/g, ' ').trim()] = zh;
}

function translateCore(core: string, dict: Record<string, string>): string | null {
  const exact = dict[core] ?? (dict === ZH ? EXTRA[core] : undefined);
  if (exact !== undefined) return exact;

  // Numbers are first read greedily ("100." whole, as most keys were written), then strictly, so a
  // key whose number is followed by a full stop ("0 to 100. An…") also matches.
  let numbers = core.match(NUMBER);
  if (!numbers) return null;
  let template = dict[core.replace(NUMBER, '#')];
  if (template === undefined) {
    numbers = core.match(STRICT_NUMBER);
    template = numbers ? dict[core.replace(STRICT_NUMBER, '#')] : undefined;
    if (template === undefined || !numbers) return null;
  }
  // `#1`, `#2` … place numbers by position, for phrases whose word order differs in translation.
  if (/#\d/.test(template)) return template.replace(/#(\d)/g, (_, n: string) => numbers[Number(n) - 1] ?? '#');
  let i = 0;
  return template.replace(/#/g, () => numbers[i++] ?? '#');
}

/**
 * Text composed from several interface phrases — "Indonesia · Premium Pioneers", "Validation:
 * Completed; Parsing: Completed", two sentences in one node — is translated piece by piece. Pieces
 * that are not interface wording (a name, a dataset value) stay exactly as they were; if no piece is
 * interface wording, the text is left alone.
 */
function piecewise(core: string, dict: Record<string, string>, depth = 0): string | null {
  if (depth > 3) return null;
  const part = (p: string) => translateCore(p, dict) ?? piecewise(p, dict, depth + 1);
  for (const sep of [' · ', '; ']) {
    if (!core.includes(sep)) continue;
    const parts = core.split(sep);
    const out = parts.map((p) => part(p.trim()) ?? p);
    return out.some((o, i) => o !== parts[i]) ? out.join(sep === '; ' ? '；' : sep) : null;
  }
  const sentences = core.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/);
  if (sentences.length > 1) {
    const out = sentences.map((p) => part(p) ?? p);
    return out.some((o, i) => o !== sentences[i]) ? out.join(' ') : null;
  }
  // Quoted text, a label with a figure before or after it, a name with a list in brackets.
  const quoted = /^([“"‘])(.+)([”"’])$/.exec(core);
  if (quoted) {
    const inner = part(quoted[2]!);
    return inner === null ? null : `“${inner}”`;
  }
  const trailing = /^(.+?) (\d[\d.,]*%?)$/.exec(core);
  if (trailing) {
    const head = part(trailing[1]!);
    if (head !== null) return `${head} ${trailing[2]}`;
  }
  const leading = /^(\d[\d.,]*%?) (.+)$/.exec(core);
  if (leading) {
    const tail = part(leading[2]!);
    if (tail !== null) return `${leading[1]} ${tail}`;
  }
  const bracketed = /^(.+?) \(([^()]+)\)(\.?)$/.exec(core);
  if (bracketed) {
    const items = bracketed[2]!.split(', ');
    const head = part(bracketed[1]!);
    const inner = items.map((x) => part(x) ?? x);
    if (head !== null || inner.some((x, i) => x !== items[i])) return `${head ?? bracketed[1]}（${inner.join('、')}）${bracketed[3] ? '。' : ''}`;
  }
  const labelled = /^([A-Za-z][A-Za-z &'-]{1,40}): (.+)$/.exec(core);
  if (labelled) {
    const label = translateCore(labelled[1]!, dict);
    if (label === null) return null;
    return `${label}：${part(labelled[2]!) ?? labelled[2]}`;
  }
  return null;
}

let reverse: Map<string, string> | null = null;
/** The English for a Chinese interface phrase (whole phrases only), or null. */
export function untranslate(text: string, dict: Record<string, string> = ZH): string | null {
  if (!reverse) {
    reverse = new Map();
    for (const [en, zh] of Object.entries(dict)) if (!en.includes('#') && !reverse.has(zh)) reverse.set(zh, en);
  }
  return reverse.get(text.trim()) ?? null;
}

/**
 * Interface text in the language the page is showing — for text a component writes into a field
 * itself (a suggested question picked from a list), which the page-wide translation cannot see.
 */
export function localize(text: string): string {
  if (typeof document === 'undefined' || document.documentElement.dataset.lang !== 'zh') return text;
  return translate(text) ?? text;
}
