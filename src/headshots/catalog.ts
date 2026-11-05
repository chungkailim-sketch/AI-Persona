/**
 * The fifty illustrated headshots every cast draws its portraits from. The catalog (who each one
 * depicts) is plain data so a page can match a persona to a portrait without touching the database;
 * the artwork itself is drawn by `draw.ts`, stored in the `Headshot` table and served from there.
 *
 * They are illustrations of invented people, spread across regions, ages and looks. They are never
 * presented as photographs of the persona, who is itself illustrative.
 */
export type Region = 'east_asian' | 'southeast_asian' | 'south_asian' | 'middle_eastern' | 'african' | 'european' | 'latin';
export type Gender = 'F' | 'M';

export type HairStyle = 'long' | 'bob' | 'bun' | 'pixie' | 'curly' | 'wavy' | 'short' | 'side' | 'buzz' | 'curlyshort' | 'bald' | 'hijab';
export type Outfit = 'tee' | 'shirt' | 'blazer' | 'turtle';

export interface HeadshotSpec {
  key: string;
  region: Region;
  gender: Gender;
  age: number;
  skin: string;
  hair: string;
  style: HairStyle;
  outfit: Outfit;
  color: string; // clothing
  bg: string;
  beard?: 'stubble' | 'full' | 'mustache';
  glasses?: boolean;
  earrings?: boolean;
}

const HAIR = { black: '#1d1816', dark: '#3a2a20', brown: '#5b3d2a', auburn: '#7d3f24', blond: '#c8a15c', grey: '#a9a9ae', white: '#e4e4e8', silver: '#c4c4ca' };
const CLOTH = ['#2f5d50', '#1e3a5f', '#8a3b3b', '#44546a', '#6b4e8c', '#b5651d', '#2a2a38', '#3d7a5a', '#a04668', '#5b6770'];
const BG = ['#dcefe0', '#e3ecf7', '#f6e6d4', '#efe3f3', '#fbeeda', '#dff1f1', '#f3e1e1', '#e8efd9'];

type Row = [Region, Gender, number, string, string, HairStyle, Outfit, ('stubble' | 'full' | 'mustache' | 'glasses' | 'earrings')?, ('glasses' | 'earrings')?];

const ROWS: Row[] = [
  // East Asian
  ['east_asian', 'F', 26, '#f1d4b8', HAIR.black, 'long', 'tee'],
  ['east_asian', 'F', 34, '#ecc9a6', HAIR.black, 'bob', 'blazer', 'earrings'],
  ['east_asian', 'F', 47, '#efcfae', HAIR.dark, 'bun', 'shirt', 'glasses'],
  ['east_asian', 'F', 62, '#e8c4a0', HAIR.silver, 'pixie', 'turtle'],
  ['east_asian', 'M', 24, '#f0d1b3', HAIR.black, 'short', 'tee'],
  ['east_asian', 'M', 38, '#ebc6a2', HAIR.black, 'side', 'blazer', 'glasses'],
  ['east_asian', 'M', 53, '#e6c09a', HAIR.dark, 'buzz', 'shirt', 'stubble'],
  ['east_asian', 'M', 66, '#e9c5a2', HAIR.white, 'short', 'turtle', 'glasses'],
  // Southeast Asian
  ['southeast_asian', 'F', 23, '#d9a97c', HAIR.black, 'long', 'tee'],
  ['southeast_asian', 'F', 31, '#cfa079', HAIR.dark, 'wavy', 'shirt', 'earrings'],
  ['southeast_asian', 'F', 41, '#d4a273', HAIR.black, 'hijab', 'blazer'],
  ['southeast_asian', 'F', 55, '#c99a6e', HAIR.grey, 'bob', 'turtle'],
  ['southeast_asian', 'M', 27, '#d6a478', HAIR.black, 'short', 'tee'],
  ['southeast_asian', 'M', 36, '#cc9a6c', HAIR.black, 'side', 'shirt', 'mustache'],
  ['southeast_asian', 'M', 49, '#c8966a', HAIR.dark, 'short', 'blazer', 'glasses'],
  ['southeast_asian', 'M', 60, '#c2905f', HAIR.grey, 'buzz', 'shirt'],
  // South Asian
  ['south_asian', 'F', 28, '#b98156', HAIR.black, 'long', 'shirt', 'earrings'],
  ['south_asian', 'F', 39, '#ad7550', HAIR.black, 'wavy', 'blazer'],
  ['south_asian', 'F', 52, '#a96f49', HAIR.dark, 'bun', 'turtle', 'glasses'],
  ['south_asian', 'M', 25, '#b57b52', HAIR.black, 'short', 'tee', 'stubble'],
  ['south_asian', 'M', 42, '#a8704a', HAIR.black, 'side', 'blazer', 'full'],
  ['south_asian', 'M', 58, '#a06843', HAIR.silver, 'short', 'shirt', 'mustache'],
  // Middle Eastern
  ['middle_eastern', 'F', 29, '#d8a97e', HAIR.dark, 'hijab', 'shirt'],
  ['middle_eastern', 'F', 37, '#dcb08a', HAIR.black, 'long', 'blazer', 'earrings'],
  ['middle_eastern', 'F', 50, '#cfa07a', HAIR.grey, 'bob', 'turtle'],
  ['middle_eastern', 'M', 30, '#d3a075', HAIR.black, 'short', 'tee', 'full'],
  ['middle_eastern', 'M', 44, '#cc9a70', HAIR.dark, 'side', 'blazer', 'stubble'],
  ['middle_eastern', 'M', 63, '#c6946a', HAIR.white, 'buzz', 'shirt', 'full'],
  // African
  ['african', 'F', 25, '#6a4430', HAIR.black, 'curly', 'tee', 'earrings'],
  ['african', 'F', 36, '#5a3a27', HAIR.black, 'bun', 'blazer'],
  ['african', 'F', 54, '#7a5239', HAIR.grey, 'pixie', 'shirt', 'glasses'],
  ['african', 'M', 26, '#5f3f2c', HAIR.black, 'curlyshort', 'tee'],
  ['african', 'M', 40, '#6e4833', HAIR.black, 'buzz', 'blazer', 'stubble'],
  ['african', 'M', 59, '#7b5238', HAIR.silver, 'bald', 'shirt', 'full'],
  // European
  ['european', 'F', 24, '#f6dcc6', HAIR.blond, 'long', 'tee'],
  ['european', 'F', 33, '#efc9a9', HAIR.brown, 'bob', 'shirt', 'earrings'],
  ['european', 'F', 45, '#f3d3b8', HAIR.auburn, 'wavy', 'blazer'],
  ['european', 'F', 58, '#ecd0b6', HAIR.silver, 'pixie', 'turtle', 'glasses'],
  ['european', 'F', 70, '#efd3ba', HAIR.white, 'bun', 'shirt'],
  ['european', 'M', 28, '#f3d5bb', HAIR.brown, 'side', 'tee', 'stubble'],
  ['european', 'M', 41, '#e9c3a0', HAIR.dark, 'short', 'blazer', 'glasses'],
  ['european', 'M', 55, '#efcdb0', HAIR.grey, 'short', 'shirt', 'mustache'],
  ['european', 'M', 67, '#f1d2b8', HAIR.white, 'bald', 'turtle', 'glasses'],
  // Latin American
  ['latin', 'F', 27, '#d2a07a', HAIR.dark, 'long', 'shirt'],
  ['latin', 'F', 38, '#c68f67', HAIR.black, 'wavy', 'blazer', 'earrings'],
  ['latin', 'F', 51, '#d9aa84', HAIR.auburn, 'bob', 'turtle'],
  ['latin', 'M', 29, '#cf9d76', HAIR.black, 'side', 'tee', 'stubble'],
  ['latin', 'M', 43, '#c48b63', HAIR.dark, 'short', 'blazer', 'mustache'],
  ['latin', 'M', 57, '#d4a47c', HAIR.grey, 'buzz', 'shirt', 'glasses'],
  // One more to make fifty
  ['east_asian', 'F', 19, '#f2d6bb', HAIR.dark, 'wavy', 'tee'],
];

export const HEADSHOTS: HeadshotSpec[] = ROWS.map((r, i) => {
  const flags = [r[7], r[8]].filter(Boolean) as string[];
  return {
    key: `hs-${String(i + 1).padStart(2, '0')}`,
    region: r[0],
    gender: r[1],
    age: r[2],
    skin: r[3],
    hair: r[4],
    style: r[5],
    outfit: r[6],
    color: CLOTH[(i * 3 + 1) % CLOTH.length]!,
    bg: BG[(i * 5 + 2) % BG.length]!,
    beard: (['stubble', 'full', 'mustache'] as const).find((b) => flags.includes(b)),
    glasses: flags.includes('glasses'),
    earrings: flags.includes('earrings'),
  };
});

// ── Matching a persona to a portrait ─────────────────────────────────────────

const REGION_OF: [Region, string[]][] = [
  ['east_asian', ['china', 'mainland china', 'hong kong', 'hong kong sar', 'taiwan', 'japan', 'korea', 'south korea']],
  ['southeast_asian', ['indonesia', 'malaysia', 'thailand', 'vietnam', 'viet nam', 'philippines', 'singapore']],
  ['south_asian', ['india', 'pakistan', 'bangladesh']],
  ['middle_eastern', ['uae', 'united arab emirates', 'saudi arabia', 'ksa', 'kuwait', 'qatar', 'egypt', 'turkey', 'türkiye', 'israel', 'morocco']],
  ['african', ['nigeria', 'south africa', 'kenya']],
  ['latin', ['brazil', 'mexico', 'argentina', 'chile', 'colombia', 'peru']],
];

export function regionOfMarket(market: string): Region {
  const m = market.trim().toLowerCase();
  return REGION_OF.find(([, names]) => names.includes(m))?.[0] ?? 'european';
}

export function genderOf(text: string | undefined | null): Gender | null {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return null;
  if (/^(f|female|woman|girl|女)/.test(t)) return 'F';
  if (/^(m|male|man|boy|男)/.test(t)) return 'M';
  return null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The best portrait for a persona: same gender, the market's region, the closest age. `taken` keeps
 * faces from repeating within a cast; ties break on the persona's id so the choice is stable.
 */
export function pickHeadshot(p: { id: string; market: string; gender?: string | null; age?: number | null }, taken: ReadonlySet<string> = new Set()): string {
  const gender = genderOf(p.gender);
  const region = regionOfMarket(p.market);
  const age = p.age && p.age > 0 ? p.age : 40;
  let best = HEADSHOTS[0]!;
  let bestScore = Infinity;
  for (const h of HEADSHOTS) {
    const score =
      (gender && h.gender !== gender ? 1000 : 0) +
      (h.region !== region ? 120 : 0) +
      Math.abs(h.age - age) +
      (taken.has(h.key) ? 400 : 0) +
      (hash(`${p.id}:${h.key}`) % 1000) / 500; // < 2 years of age, a stable tiebreak
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best.key;
}

export const headshotUrl = (key: string) => `/api/headshots/${key}`;
