import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5_000,
});

export async function waitForDatabase(attempts = 30) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
