/**
 * The hundred illustrated headshots every cast draws its portraits from. The catalog (who each one
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
/** What the person does: shapes the photo's clothes and setting, and is matched to a persona's occupation. */
export type Role = 'student' | 'office' | 'executive' | 'tech' | 'creative' | 'healthcare' | 'service' | 'trades' | 'entrepreneur' | 'homemaker' | 'retired';

/** Bumped when the photo prompt changes: photos made with an older style are regenerated on deploy. */
export const PHOTO_STYLE = 'lifestyle-role-v1';

export interface HeadshotSpec {
  key: string;
  region: Region;
  gender: Gender;
  age: number;
  skin: string;
  hair: string;
  style: HairStyle;
  outfit: Outfit;
  role: Role;
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
  // Second fifty: more faces for the markets casts use most, so no face repeats within a cast
  ['east_asian', 'F', 22, '#f3d8be', HAIR.black, 'bob', 'tee', 'earrings'],
  ['east_asian', 'F', 30, '#eecfb0', HAIR.dark, 'long', 'turtle'],
  ['east_asian', 'F', 41, '#ebc8a5', HAIR.black, 'wavy', 'shirt', 'earrings'],
  ['east_asian', 'F', 55, '#e7c39e', HAIR.grey, 'bob', 'shirt', 'glasses'],
  ['east_asian', 'F', 71, '#e6c3a1', HAIR.white, 'bun', 'turtle'],
  ['east_asian', 'M', 19, '#f1d3b6', HAIR.black, 'curlyshort', 'tee'],
  ['east_asian', 'M', 31, '#ecc8a4', HAIR.black, 'short', 'shirt'],
  ['east_asian', 'M', 45, '#e8c39e', HAIR.dark, 'side', 'turtle', 'glasses'],
  ['east_asian', 'M', 59, '#e4bf99', HAIR.grey, 'short', 'shirt'],
  ['southeast_asian', 'F', 19, '#dbab7f', HAIR.black, 'wavy', 'tee', 'earrings'],
  ['southeast_asian', 'F', 27, '#d2a076', HAIR.dark, 'hijab', 'tee'],
  ['southeast_asian', 'F', 35, '#cd9c72', HAIR.black, 'bun', 'shirt'],
  ['southeast_asian', 'F', 47, '#c99870', HAIR.black, 'hijab', 'turtle', 'glasses'],
  ['southeast_asian', 'F', 63, '#c69469', HAIR.white, 'bun', 'shirt'],
  ['southeast_asian', 'M', 21, '#d8a77a', HAIR.black, 'curlyshort', 'tee'],
  ['southeast_asian', 'M', 32, '#d0a073', HAIR.black, 'buzz', 'tee', 'stubble'],
  ['southeast_asian', 'M', 42, '#ca986c', HAIR.dark, 'short', 'turtle'],
  ['southeast_asian', 'M', 55, '#c49264', HAIR.grey, 'side', 'shirt', 'glasses'],
  ['southeast_asian', 'M', 68, '#c08e60', HAIR.white, 'short', 'turtle'],
  ['south_asian', 'F', 21, '#bd8659', HAIR.black, 'long', 'tee'],
  ['south_asian', 'F', 33, '#b07852', HAIR.black, 'bun', 'shirt', 'earrings'],
  ['south_asian', 'F', 46, '#aa714b', HAIR.dark, 'wavy', 'turtle'],
  ['south_asian', 'F', 64, '#a46c47', HAIR.silver, 'bun', 'shirt', 'glasses'],
  ['south_asian', 'M', 33, '#b27852', HAIR.black, 'curlyshort', 'shirt', 'stubble'],
  ['south_asian', 'M', 50, '#a56d47', HAIR.dark, 'short', 'turtle', 'glasses'],
  ['south_asian', 'M', 68, '#9e6741', HAIR.white, 'bald', 'shirt', 'full'],
  ['middle_eastern', 'F', 22, '#dbae84', HAIR.black, 'hijab', 'tee'],
  ['middle_eastern', 'F', 43, '#d6a67d', HAIR.dark, 'wavy', 'shirt', 'earrings'],
  ['middle_eastern', 'F', 60, '#cb9d77', HAIR.grey, 'hijab', 'turtle', 'glasses'],
  ['middle_eastern', 'M', 22, '#d6a479', HAIR.black, 'curlyshort', 'tee', 'stubble'],
  ['middle_eastern', 'M', 36, '#cf9e73', HAIR.black, 'short', 'shirt', 'full'],
  ['middle_eastern', 'M', 52, '#c9976d', HAIR.dark, 'buzz', 'turtle', 'mustache'],
  ['african', 'F', 19, '#664230', HAIR.black, 'curly', 'tee'],
  ['african', 'F', 31, '#5d3c29', HAIR.black, 'long', 'shirt', 'earrings'],
  ['african', 'F', 44, '#704a34', HAIR.black, 'bun', 'turtle'],
  ['african', 'F', 66, '#7c5339', HAIR.white, 'curly', 'shirt', 'glasses'],
  ['african', 'M', 33, '#5b3c2a', HAIR.black, 'buzz', 'tee', 'full'],
  ['african', 'M', 48, '#6a4531', HAIR.black, 'bald', 'turtle'],
  ['european', 'F', 19, '#f7dfca', HAIR.brown, 'wavy', 'tee', 'earrings'],
  ['european', 'F', 29, '#f2d4bb', HAIR.auburn, 'long', 'shirt'],
  ['european', 'F', 38, '#eecbad', HAIR.blond, 'bun', 'turtle', 'glasses'],
  ['european', 'F', 50, '#f0cfb3', HAIR.brown, 'bob', 'shirt'],
  ['european', 'M', 21, '#f4d8c0', HAIR.blond, 'short', 'tee'],
  ['european', 'M', 34, '#eecaa9', HAIR.brown, 'curlyshort', 'shirt', 'full'],
  ['european', 'M', 48, '#ebc6a5', HAIR.dark, 'side', 'turtle', 'stubble'],
  ['european', 'M', 75, '#efd0b6', HAIR.white, 'short', 'shirt', 'glasses'],
  ['latin', 'F', 20, '#d5a37d', HAIR.dark, 'curly', 'tee', 'earrings'],
  ['latin', 'F', 64, '#d0a17c', HAIR.grey, 'bun', 'shirt', 'glasses'],
  ['latin', 'M', 21, '#cc9a72', HAIR.black, 'curlyshort', 'tee'],
  ['latin', 'M', 68, '#c99c78', HAIR.white, 'short', 'turtle', 'mustache'],
];

const YOUNG: Role[] = ['office', 'creative', 'tech', 'service', 'healthcare', 'trades', 'entrepreneur'];
const MIDDLE: Role[] = ['office', 'entrepreneur', 'healthcare', 'executive', 'trades', 'homemaker', 'tech', 'service'];
const SENIOR: Role[] = ['executive', 'entrepreneur', 'homemaker', 'trades', 'office', 'healthcare'];

/** A spread of occupations over the catalog, plausible for each age: each age band takes its
 *  occupations in turn, separately for women and men, so every region gets a mix. */
const turn = new Map<string, number>();
function roleFor(age: number, gender: Gender): Role {
  if (age < 23) return 'student';
  const band = age >= 62 ? 'senior+' : age < 35 ? 'young' : age < 50 ? 'middle' : 'senior';
  const pool: Role[] = band === 'senior+' ? ['retired', 'retired', 'entrepreneur'] : band === 'young' ? YOUNG : band === 'middle' ? MIDDLE : SENIOR;
  const k = `${band}:${gender}`;
  const n = turn.get(k) ?? 0;
  turn.set(k, n + 1);
  return pool[n % pool.length]!;
}

export const HEADSHOTS: HeadshotSpec[] = ROWS.map((r, i) => {
  const flags = [r[7], r[8]].filter(Boolean) as string[];
  return {
    role: roleFor(r[2], r[1]),
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

const ROLE_WORDS: [Role, RegExp][] = [
  ['retired', /retire|pension/i],
  ['student', /student|undergrad|graduate student|intern\b|universit|college/i],
  ['homemaker', /home ?maker|housewife|househusband|stay[- ]at[- ]home|full[- ]time (mum|mom|parent)/i],
  ['healthcare', /nurse|doctor|physician|pharmac|clinic|medical|dentist|therapist|midwife|caregiver|health/i],
  ['tech', /engineer|developer|software|programmer|\bit\b|data|tech|analyst/i],
  ['creative', /design|artist|creative|photograph|content creator|influencer|media|writer|architect|marketing|stylist/i],
  ['executive', /director|executive|head of|vice president|\bvp\b|ceo|cfo|partner|lawyer|banker|senior manager|general manager/i],
  ['entrepreneur', /owner|entrepreneur|founder|self[- ]employed|merchant|trader|vendor|seller|shopkeeper|business/i],
  ['service', /retail|cashier|waiter|waitress|barista|hospitality|shop assistant|sales assistant|call cent|customer service|salon|beaut|cook|chef|server/i],
  ['trades', /driver|mechanic|technician|construction|factory|farmer|electrician|plumber|labou?r|worker|delivery|courier|logistics|security|fisher/i],
  ['office', /manager|officer|clerk|admin|accountant|teacher|lecturer|civil servant|assistant|coordinator|executive assistant|sales|bank/i],
]

/** The occupation family a persona's occupation belongs to; by age and income tier when it says nothing. */
export function roleOf(occupation: string | null | undefined, age: number, tier?: number | null): Role {
  const o = (occupation ?? '').trim();
  for (const [role, re] of ROLE_WORDS) if (o && re.test(o)) return role;
  if (age >= 62) return 'retired';
  if (age < 23) return 'student';
  return tier === 1 ? (age >= 40 ? 'executive' : 'office') : tier === 3 ? (age >= 40 ? 'trades' : 'service') : 'office';
}

const NEAR: Partial<Record<Role, Role[]>> = {
  office: ['executive', 'tech'], executive: ['office', 'entrepreneur'], tech: ['office', 'creative'], creative: ['tech', 'office'],
  service: ['trades', 'entrepreneur'], trades: ['service'], entrepreneur: ['executive', 'service'], homemaker: ['retired'], retired: ['homemaker'],
  healthcare: ['service'], student: ['service', 'creative'],
};

/**
 * The best portrait for a persona: same gender, the market's region, the occupation family (from
 * the persona's occupation, or its age and income tier), the closest age. `taken` keeps faces
 * from repeating within a cast; ties break on the persona's id so the choice is stable.
 */
export function pickHeadshot(
  p: { id: string; market: string; gender?: string | null; age?: number | null; occupation?: string | null; tier?: number | null },
  taken: ReadonlySet<string> = new Set(),
): string {
  const gender = genderOf(p.gender);
  const region = regionOfMarket(p.market);
  const age = p.age && p.age > 0 ? p.age : 40;
  const role = roleOf(p.occupation, age, p.tier);
  // A stated occupation weighs about fifteen years of age; one guessed from age and tier, a few.
  const stated = Boolean(p.occupation && p.occupation.trim());
  const [miss, near] = stated ? [24, 10] : [8, 3];
  let best = HEADSHOTS[0]!;
  let bestScore = Infinity;
  for (const h of HEADSHOTS) {
    const score =
      (gender && h.gender !== gender ? 1000 : 0) +
      (h.region !== region ? 120 : 0) +
      (h.role === role ? 0 : NEAR[role]?.includes(h.role) ? near : miss) +
      Math.abs(h.age - age) * 1.5 +
      // A face already used in this cast is a last resort: only when every face of that gender is taken.
      (taken.has(h.key) ? 100_000 : 0) +
      (hash(`${p.id}:${h.key}`) % 1000) / 500; // a stable tiebreak
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best.key;
}

export const headshotUrl = (key: string) => `/api/headshots/${key}`;
