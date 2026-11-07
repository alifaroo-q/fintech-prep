import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { DATABASE_URL } from './db.ts';

// Fresh schema every run. Needs `pnpm db:up` (docker compose) first.
export default async function setup() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
    await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}
