/**
 * Draws a headshot as a self-contained SVG (256×256, to be shown in a circle). Pure: the same spec
 * always gives the same picture. Flat vector illustration — a face, hair, outfit and background —
 * with features tuned to the region and age in the spec.
 */
import type { HeadshotSpec } from './catalog';

/** Mix a hex colour towards black (negative) or white (positive). */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const CX = 128;
const HEAD_Y = 106;

export function drawHeadshot(s: HeadshotSpec): string {
  const old = s.age >= 50;
  const female = s.gender === 'F';
  const ea = s.region === 'east_asian';
  const dark = s.region === 'african';
  const rx = female ? 47 : 51;
  const ry = female ? 58 : 60;
  const skinShade = shade(s.skin, -0.14);
  const skinLight = shade(s.skin, 0.12);
  const hairDark = shade(s.hair, -0.25);
  const lip = female ? shade(dark ? '#8a3a3a' : '#c4585e', 0) : shade(s.skin, -0.22);
  const out: string[] = [];
  const push = (x: string) => out.push(x);

  push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="Illustrated headshot">`);
  push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(s.bg, 0.35)}"/><stop offset="1" stop-color="${shade(s.bg, -0.08)}"/></linearGradient>` +
    `<clipPath id="c"><rect width="256" height="256"/></clipPath></defs>`);
  push(`<g clip-path="url(#c)"><rect width="256" height="256" fill="url(#bg)"/>`);

  const hijab = s.style === 'hijab';

  // ── hair, back layer ──
  if (s.style === 'long') push(`<path d="M${CX - rx - 8} ${HEAD_Y - 10} C ${CX - rx - 18} 150, ${CX - rx - 12} 205, ${CX - rx + 4} 232 L ${CX + rx - 4} 232 C ${CX + rx + 12} 205, ${CX + rx + 18} 150, ${CX + rx + 8} ${HEAD_Y - 10} Z" fill="${s.hair}"/>`);
  if (s.style === 'wavy') push(`<path d="M${CX - rx - 10} ${HEAD_Y - 14} C ${CX - rx - 26} 150, ${CX - rx - 4} 170, ${CX - rx - 12} 214 C ${CX - rx + 6} 226, ${CX - rx + 18} 218, ${CX - rx + 20} 206 L ${CX + rx - 20} 206 C ${CX + rx - 18} 218, ${CX + rx - 6} 226, ${CX + rx + 12} 214 C ${CX + rx + 4} 170, ${CX + rx + 26} 150, ${CX + rx + 10} ${HEAD_Y - 14} Z" fill="${s.hair}"/>`);
  if (s.style === 'bob') push(`<path d="M${CX - rx - 8} ${HEAD_Y - 10} C ${CX - rx - 16} 140, ${CX - rx - 8} 160, ${CX - rx - 2} 168 L ${CX + rx + 2} 168 C ${CX + rx + 8} 160, ${CX + rx + 16} 140, ${CX + rx + 8} ${HEAD_Y - 10} Z" fill="${s.hair}"/>`);
  if (s.style === 'curly') {
    for (const [x, y, r] of [[CX - 56, 82, 26], [CX + 56, 82, 26], [CX - 46, 52, 28], [CX + 46, 52, 28], [CX, 38, 32], [CX - 62, 118, 20], [CX + 62, 118, 20]] as const) push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${s.hair}"/>`);
  }
  if (s.style === 'bun') push(`<circle cx="${CX}" cy="30" r="20" fill="${s.hair}"/>`);
  if (hijab) {
    push(`<path d="M${CX - 70} 256 C ${CX - 72} 190, ${CX - 74} 150, ${CX - 72} ${HEAD_Y} C ${CX - 74} 40, ${CX - 40} 26, ${CX} 26 C ${CX + 40} 26, ${CX + 74} 40, ${CX + 72} ${HEAD_Y} C ${CX + 74} 150, ${CX + 72} 190, ${CX + 70} 256 Z" fill="${s.color}"/>`);
  }

  // ── body ──
  const cloth = s.outfit === 'blazer' ? shade(s.color, -0.1) : s.color;
  push(`<path d="M22 256 C 24 206, 70 190, ${CX} 190 C 186 190, 232 206, 234 256 Z" fill="${cloth}"/>`);
  if (hijab) push(`<path d="M${CX - 62} 256 C ${CX - 62} 205, ${CX - 40} 176, ${CX} 172 C ${CX + 40} 176, ${CX + 62} 205, ${CX + 62} 256 Z" fill="${shade(s.color, 0.08)}"/>`);
  // neck
  const neckTop = HEAD_Y + 40;
  if (s.outfit === 'tee' || hijab) push(`<path d="M${CX - 21} ${neckTop} L${CX - 21} 190 Q${CX} 214 ${CX + 21} 190 L${CX + 21} ${neckTop} Z" fill="${skinShade}"/>`);
  else if (s.outfit === 'turtle') {
    push(`<path d="M${CX - 21} ${neckTop} L${CX - 21} 176 L${CX + 21} 176 L${CX + 21} ${neckTop} Z" fill="${skinShade}"/>`);
    push(`<rect x="${CX - 27}" y="170" width="54" height="30" rx="12" fill="${shade(s.color, 0.1)}"/>`);
  } else {
    push(`<path d="M${CX - 21} ${neckTop} L${CX - 21} 188 L${CX} 214 L${CX + 21} 188 L${CX + 21} ${neckTop} Z" fill="${skinShade}"/>`);
    if (s.outfit === 'blazer') {
      push(`<path d="M${CX - 22} 186 L${CX} 256 L${CX + 22} 186 L${CX} 214 Z" fill="#f7f7f7"/>`);
      push(`<path d="M${CX - 24} 184 L${CX - 4} 238 L${CX - 40} 256 L${CX - 70} 232 Z" fill="${shade(cloth, -0.12)}"/><path d="M${CX + 24} 184 L${CX + 4} 238 L${CX + 40} 256 L${CX + 70} 232 Z" fill="${shade(cloth, -0.12)}"/>`);
    } else {
      push(`<path d="M${CX - 24} 186 L${CX} 216 L${CX - 14} 196 Z" fill="#fafafa"/><path d="M${CX + 24} 186 L${CX} 216 L${CX + 14} 196 Z" fill="#fafafa"/>`);
    }
  }

  // ── ears ──
  if (!hijab) {
    push(`<ellipse cx="${CX - rx + 2}" cy="${HEAD_Y + 6}" rx="8" ry="12" fill="${s.skin}"/><ellipse cx="${CX + rx - 2}" cy="${HEAD_Y + 6}" rx="8" ry="12" fill="${s.skin}"/>`);
    if (s.earrings) push(`<circle cx="${CX - rx}" cy="${HEAD_Y + 22}" r="3.4" fill="#e0b347"/><circle cx="${CX + rx}" cy="${HEAD_Y + 22}" r="3.4" fill="#e0b347"/>`);
  }

  // ── face ──
  push(`<path d="M${CX - rx} ${HEAD_Y - 6} C ${CX - rx} ${HEAD_Y - ry}, ${CX + rx} ${HEAD_Y - ry}, ${CX + rx} ${HEAD_Y - 6} C ${CX + rx} ${HEAD_Y + 30}, ${CX + rx - 12} ${HEAD_Y + ry - 2}, ${CX} ${HEAD_Y + ry} C ${CX - rx + 12} ${HEAD_Y + ry - 2}, ${CX - rx} ${HEAD_Y + 30}, ${CX - rx} ${HEAD_Y - 6} Z" fill="${s.skin}"/>`);
  // chin shadow on the neck
  push(`<path d="M${CX - 24} ${HEAD_Y + ry - 6} Q${CX} ${HEAD_Y + ry + 10} ${CX + 24} ${HEAD_Y + ry - 6} Q${CX} ${HEAD_Y + ry + 24} ${CX - 24} ${HEAD_Y + ry - 6} Z" fill="${skinShade}" opacity=".35"/>`);
  // cheek light + blush
  push(`<ellipse cx="${CX - 26}" cy="${HEAD_Y + 26}" rx="11" ry="7" fill="${female ? '#e58a86' : skinShade}" opacity="${female ? '.28' : '.2'}"/><ellipse cx="${CX + 26}" cy="${HEAD_Y + 26}" rx="11" ry="7" fill="${female ? '#e58a86' : skinShade}" opacity="${female ? '.28' : '.2'}"/>`);
  push(`<ellipse cx="${CX}" cy="${HEAD_Y - 22}" rx="22" ry="9" fill="${skinLight}" opacity=".35"/>`);

  // ── eyes & brows ──
  const ex = 19;
  const ey = HEAD_Y + 2;
  const eyeRx = ea ? 8 : 7.6;
  const eyeRy = ea ? 3.6 : 5.2;
  const tilt = ea ? -5 : 0;
  for (const side of [-1, 1] as const) {
    const x = CX + side * ex;
    push(`<g transform="rotate(${tilt * side} ${x} ${ey})"><ellipse cx="${x}" cy="${ey}" rx="${eyeRx}" ry="${eyeRy}" fill="#fbfbfb"/>` +
      `<circle cx="${x}" cy="${ey}" r="${ea ? 3.4 : 4}" fill="${dark ? '#2a1a12' : '#3b2a1e'}"/><circle cx="${x + 1.1}" cy="${ey - 1.2}" r="1.2" fill="#fff"/>` +
      `<path d="M${x - eyeRx} ${ey - 0.6} Q${x} ${ey - eyeRy - 2.4} ${x + eyeRx} ${ey - 0.6}" fill="none" stroke="${shade(s.skin, -0.45)}" stroke-width="1.6" stroke-linecap="round"/>${female ? `<path d="M${x + side * eyeRx} ${ey - 1} l${side * 2.6} -2" stroke="#2a1a12" stroke-width="1.4" stroke-linecap="round"/>` : ''}</g>`);
    const browY = ey - (ea ? 12 : 13) - (female ? 0 : -1);
    const browColor = old && s.hair !== '#1d1816' ? shade(s.hair, -0.15) : s.style === 'bald' || female ? shade(s.hair, -0.1) : s.hair;
    push(`<path d="M${x - 10 * side * -1 * -1} ${browY + 2} Q${x} ${browY - 3} ${x + 10 * side} ${browY + (female ? 1 : 0)}" transform="translate(0 0)" fill="none" stroke="${browColor}" stroke-width="${female ? 2.6 : 3.8}" stroke-linecap="round"/>`);
  }
  if (old) push(`<path d="M${CX - 30} ${ey - 6} q4 -2 8 0 M${CX + 22} ${ey - 6} q4 -2 8 0" stroke="${skinShade}" stroke-width="1.2" fill="none" opacity=".7" stroke-linecap="round"/>`);

  // ── nose & mouth ──
  const wide = dark || s.region === 'southeast_asian' || s.region === 'latin' ? 1.15 : 1;
  push(`<path d="M${CX} ${HEAD_Y + 4} q-${3 * wide} 14 -${6 * wide} 20 q${6 * wide} 4 ${12 * wide} 0 q-${3 * wide} -4 -${6 * wide} -20" fill="${skinShade}" opacity=".5"/>`);
  push(`<path d="M${CX - 8 * wide} ${HEAD_Y + 24} q${8 * wide} 4 ${16 * wide} 0" fill="none" stroke="${shade(s.skin, -0.4)}" stroke-width="1.6" stroke-linecap="round"/>`);
  const my = HEAD_Y + 42;
  if (s.beard === 'full') {
    push(`<path d="M${CX - rx + 2} ${HEAD_Y + 8} C ${CX - rx} ${HEAD_Y + 50}, ${CX - 30} ${HEAD_Y + ry + 6}, ${CX} ${HEAD_Y + ry + 6} C ${CX + 30} ${HEAD_Y + ry + 6}, ${CX + rx} ${HEAD_Y + 50}, ${CX + rx - 2} ${HEAD_Y + 8} C ${CX + rx - 10} ${HEAD_Y + 30}, ${CX + 26} ${my - 10}, ${CX} ${my - 8} C ${CX - 26} ${my - 10}, ${CX - rx + 10} ${HEAD_Y + 30}, ${CX - rx + 2} ${HEAD_Y + 8} Z" fill="${old ? shade(s.hair, 0.05) : s.hair}"/>`);
    push(`<path d="M${CX - 13} ${my + 2} Q${CX} ${my + 11} ${CX + 13} ${my + 2} Q${CX} ${my + 6} ${CX - 13} ${my + 2} Z" fill="#7a2f33"/><path d="M${CX - 13} ${my + 2} Q${CX} ${my + 6} ${CX + 13} ${my + 2}" stroke="#f4f0ee" stroke-width="2" fill="none"/>`);
  } else {
    if (s.beard === 'stubble') push(`<path d="M${CX - rx + 3} ${HEAD_Y + 12} C ${CX - rx} ${HEAD_Y + 50}, ${CX - 30} ${HEAD_Y + ry}, ${CX} ${HEAD_Y + ry} C ${CX + 30} ${HEAD_Y + ry}, ${CX + rx} ${HEAD_Y + 50}, ${CX + rx - 3} ${HEAD_Y + 12} C ${CX + rx - 8} ${HEAD_Y + 38}, ${CX + 20} ${my + 14}, ${CX} ${my + 14} C ${CX - 20} ${my + 14}, ${CX - rx + 8} ${HEAD_Y + 38}, ${CX - rx + 3} ${HEAD_Y + 12} Z" fill="${s.hair}" opacity=".35"/>`);
    push(`<path d="M${CX - 13} ${my} Q${CX} ${my + 11} ${CX + 13} ${my}" fill="${female ? lip : '#7a3a38'}" stroke="${female ? lip : shade(s.skin, -0.4)}" stroke-width="2" stroke-linejoin="round"/><path d="M${CX - 10} ${my + 1} Q${CX} ${my + 5} ${CX + 10} ${my + 1}" stroke="#fff" stroke-width="2.2" fill="none" opacity=".85" stroke-linecap="round"/>`);
    if (s.beard === 'mustache') push(`<path d="M${CX - 16} ${my - 4} Q${CX - 8} ${my - 12} ${CX} ${my - 7} Q${CX + 8} ${my - 12} ${CX + 16} ${my - 4} Q${CX + 8} ${my - 5} ${CX} ${my - 2} Q${CX - 8} ${my - 5} ${CX - 16} ${my - 4} Z" fill="${s.hair}"/>`);
  }
  if (old) push(`<path d="M${CX - 24} ${HEAD_Y + 22} q-4 12 0 22 M${CX + 24} ${HEAD_Y + 22} q4 12 0 22" stroke="${skinShade}" stroke-width="1.4" fill="none" opacity=".55" stroke-linecap="round"/>`);

  // ── hair, front layer ──
  const top = HEAD_Y - ry;
  const cap = (extra: number, fringe: string) => `<path d="M${CX - rx - 3} ${HEAD_Y - 4} C ${CX - rx - 8} ${top + 6 - extra}, ${CX - 28} ${top - 10 - extra}, ${CX} ${top - 10 - extra} C ${CX + 28} ${top - 10 - extra}, ${CX + rx + 8} ${top + 6 - extra}, ${CX + rx + 3} ${HEAD_Y - 4} ${fringe} Z" fill="${s.hair}"/>`;
  switch (s.style) {
    case 'long':
    case 'wavy':
      push(cap(2, `C ${CX + rx - 2} ${top + 22}, ${CX + 20} ${top + 8}, ${CX - 8} ${top + 10} C ${CX - 30} ${top + 12}, ${CX - rx + 4} ${top + 28}, ${CX - rx - 3} ${HEAD_Y - 4}`));
      break;
    case 'bob':
    case 'bun':
      push(cap(2, `C ${CX + rx - 4} ${top + 24}, ${CX + 14} ${top + 10}, ${CX - 14} ${top + 14} C ${CX - 34} ${top + 18}, ${CX - rx + 2} ${top + 30}, ${CX - rx - 3} ${HEAD_Y - 4}`));
      break;
    case 'pixie':
      push(cap(0, `C ${CX + rx - 2} ${top + 18}, ${CX + 8} ${top + 12}, ${CX - 20} ${top + 22} C ${CX - 36} ${top + 24}, ${CX - rx + 4} ${top + 30}, ${CX - rx - 3} ${HEAD_Y - 4}`));
      break;
    case 'curly':
      push(`<path d="M${CX - rx + 4} ${top + 28} C ${CX - 20} ${top + 4}, ${CX + 20} ${top + 4}, ${CX + rx - 4} ${top + 28} C ${CX + 24} ${top + 18}, ${CX - 24} ${top + 18}, ${CX - rx + 4} ${top + 28} Z" fill="${s.hair}"/>`);
      break;
    case 'curlyshort':
      push(cap(6, `C ${CX + rx - 4} ${top + 16}, ${CX + 20} ${top + 8}, ${CX} ${top + 8} C ${CX - 20} ${top + 8}, ${CX - rx + 4} ${top + 16}, ${CX - rx - 3} ${HEAD_Y - 4}`));
      for (let i = -3; i <= 3; i++) push(`<circle cx="${CX + i * 14}" cy="${top - 4 - (3 - Math.abs(i)) * 1.5}" r="9" fill="${s.hair}"/>`);
      break;
    case 'short':
      push(cap(0, `C ${CX + rx - 3} ${top + 20}, ${CX + 22} ${top + 14}, ${CX} ${top + 16} C ${CX - 22} ${top + 14}, ${CX - rx + 3} ${top + 20}, ${CX - rx - 3} ${HEAD_Y - 4}`));
      break;
    case 'side':
      push(cap(2, `C ${CX + rx - 2} ${top + 24}, ${CX + 24} ${top + 10}, ${CX - 12} ${top + 20} C ${CX - 30} ${top + 12}, ${CX - rx + 4} ${top + 26}, ${CX - rx - 3} ${HEAD_Y - 4}`));
      break;
    case 'buzz':
      push(`<path d="M${CX - rx - 1} ${HEAD_Y - 8} C ${CX - rx - 4} ${top + 8}, ${CX - 26} ${top - 4}, ${CX} ${top - 4} C ${CX + 26} ${top - 4}, ${CX + rx + 4} ${top + 8}, ${CX + rx + 1} ${HEAD_Y - 8} C ${CX + rx - 6} ${top + 14}, ${CX + 20} ${top + 10}, ${CX} ${top + 10} C ${CX - 20} ${top + 10}, ${CX - rx + 6} ${top + 14}, ${CX - rx - 1} ${HEAD_Y - 8} Z" fill="${s.hair}" opacity=".85"/>`);
      break;
    case 'bald':
      push(`<path d="M${CX - rx - 2} ${HEAD_Y + 4} C ${CX - rx - 4} ${HEAD_Y - 14}, ${CX - rx + 2} ${HEAD_Y - 20}, ${CX - rx + 4} ${HEAD_Y - 22} L${CX - rx + 4} ${HEAD_Y + 8} Z M${CX + rx + 2} ${HEAD_Y + 4} C ${CX + rx + 4} ${HEAD_Y - 14}, ${CX + rx - 2} ${HEAD_Y - 20}, ${CX + rx - 4} ${HEAD_Y - 22} L${CX + rx - 4} ${HEAD_Y + 8} Z" fill="${s.hair}"/>`);
      push(`<ellipse cx="${CX - 12}" cy="${top + 10}" rx="14" ry="6" fill="#fff" opacity=".18"/>`);
      break;
    case 'hijab':
      push(`<path fill-rule="evenodd" d="M${CX - 74} ${HEAD_Y + 6} C ${CX - 76} 30, ${CX - 40} 18, ${CX} 18 C ${CX + 40} 18, ${CX + 76} 30, ${CX + 74} ${HEAD_Y + 6} L${CX + 74} ${HEAD_Y + 70} L${CX - 74} ${HEAD_Y + 70} Z M${CX - 44} ${HEAD_Y - 10} C ${CX - 44} ${HEAD_Y - 52}, ${CX + 44} ${HEAD_Y - 52}, ${CX + 44} ${HEAD_Y - 10} C ${CX + 44} ${HEAD_Y + 26}, ${CX + 34} ${HEAD_Y + 58}, ${CX} ${HEAD_Y + 60} C ${CX - 34} ${HEAD_Y + 58}, ${CX - 44} ${HEAD_Y + 26}, ${CX - 44} ${HEAD_Y - 10} Z" fill="${s.color}"/>`);
      push(`<path d="M${CX - 44} ${HEAD_Y - 10} C ${CX - 44} ${HEAD_Y - 52}, ${CX + 44} ${HEAD_Y - 52}, ${CX + 44} ${HEAD_Y - 10}" fill="none" stroke="${shade(s.color, 0.18)}" stroke-width="3"/>`);
      break;
  }
  if (old && (s.style === 'short' || s.style === 'side' || s.style === 'pixie' || s.style === 'bob')) push(`<path d="M${CX - rx - 2} ${HEAD_Y - 6} C ${CX - rx - 4} ${top + 10}, ${CX - 30} ${top - 6}, ${CX} ${top - 8}" stroke="${hairDark}" stroke-width="1.5" fill="none" opacity=".25"/>`);

  // ── glasses ──
  if (s.glasses) {
    const fr = shade(s.hair === '#e4e4e8' || s.hair === '#c4c4ca' ? '#555555' : s.hair, -0.1);
    push(`<g fill="none" stroke="${fr}" stroke-width="2.6"><rect x="${CX - ex - 14}" y="${ey - 9}" width="28" height="19" rx="7"/><rect x="${CX + ex - 14}" y="${ey - 9}" width="28" height="19" rx="7"/><path d="M${CX - ex + 14} ${ey - 1} Q${CX} ${ey - 5} ${CX + ex - 14} ${ey - 1}"/><path d="M${CX - ex - 14} ${ey - 3} L${CX - rx - 2} ${ey - 5} M${CX + ex + 14} ${ey - 3} L${CX + rx + 2} ${ey - 5}"/></g>`);
    push(`<path d="M${CX - ex - 9} ${ey - 5} l8 -2 M${CX + ex - 9} ${ey - 5} l8 -2" stroke="#fff" stroke-width="1.6" opacity=".6"/>`);
  }

  push(`</g></svg>`);
  return out.join('');
}
