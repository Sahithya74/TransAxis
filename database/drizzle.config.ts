import { defineConfig } from 'drizzle-kit';

// Used only by `drizzle-kit generate` (offline diff of schema -> SQL). Migrations are applied by
// scripts/migrate.ts; we never use `drizzle-kit push`.
export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'mysql://unused:unused@127.0.0.1:3306/unused' },
});
