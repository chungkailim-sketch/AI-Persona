// Renders a contact sheet of the headshots to PNG for a visual check: tsx scripts/headshotSheet.ts out.png
import sharp from 'sharp';
import { HEADSHOTS } from '../src/headshots/catalog';
import { drawHeadshot } from '../src/headshots/draw';

async function main() {
  const out = process.argv[2] ?? 'headshots.png';
  const size = 160;
  const cols = 10;
  const rows = Math.ceil(HEADSHOTS.length / cols);
  const tiles = await Promise.all(
    HEADSHOTS.map(async (h, i) => {
      const png = await sharp(Buffer.from(drawHeadshot(h))).resize(size, size).png().toBuffer();
      const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}"/></svg>`);
      const round = await sharp(png).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
      return { input: round, left: (i % cols) * (size + 8) + 4, top: Math.floor(i / cols) * (size + 8) + 4 };
    }),
  );
  await sharp({ create: { width: cols * (size + 8), height: rows * (size + 8), channels: 4, background: '#ffffff' } }).composite(tiles).png().toFile(out);
  console.log('wrote', out);
}
void main();
