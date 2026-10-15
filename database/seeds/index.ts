/**
 * Seeds deterministic demo data.
 *   npm run db:seed                 # empty dev database only
 *   npm run db:seed -- --reset      # wipe dev data first
 *   npm run db:seed -- --test       # target DATABASE_URL_TEST
 */
import { todayIn } from '@transaxis/shared';
import { createDb } from '../src/client.js';
import { loadEnv, requireEnv } from '../scripts/env.js';
import { seedDatabase, wipeData } from './seed.js';

loadEnv();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data when NODE_ENV=production');
  }
  const useTest = process.argv.includes('--test');
  const handle = createDb(requireEnv(useTest ? 'DATABASE_URL_TEST' : 'DATABASE_URL'), 2);
  try {
    if (process.argv.includes('--reset')) {
      await wipeData(handle.db);
      console.log('Existing data wiped');
    }
    const anchorDate = process.env.SEED_ANCHOR_DATE || todayIn('Asia/Kolkata');
    const summary = await seedDatabase(handle.db, { anchorDate });
    console.log(`Seeded (anchor ${anchorDate}):`, summary);
    console.log('Demo password for every demo account: Demo@12345 (demo data only)');
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
