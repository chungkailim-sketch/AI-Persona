// Generate the photographic headshots from a shell with DATABASE_URL and HF_TOKEN set:
//   npx tsx scripts/generateHeadshots.ts [--force]
import { generatePhotoHeadshots } from '../src/headshots/photos';

generatePhotoHeadshots({ force: process.argv.includes('--force'), onProgress: (d, t) => console.log(`${d}/${t}`) })
  .then((r) => {
    console.log(`generated ${r.generated} of ${r.attempted}`, r.failed.length ? r.failed : '');
    process.exit(r.failed.length ? 1 : 0);
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
