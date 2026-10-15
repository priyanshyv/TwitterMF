import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

// Runs once before the e2e suite: makes sure the separate test database
// exists and has the latest schema. Tests never touch the dev database.
export default async function setup(project: TestProject) {
  // Global setup runs before `test.env` is applied, so read it from config.
  const url = new URL(project.config.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);

  const admin = new Client({ connectionString: withDb(url, 'postgres') });
  await admin.connect();
  const { rowCount } = await admin.query(
    'select 1 from pg_database where datname = $1',
    [dbName],
  );
  if (!rowCount) await admin.query(`create database "${dbName}"`);
  await admin.end();

  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  await migrate(drizzle({ client }), { migrationsFolder: './drizzle' });
  await client.end();
}

function withDb(url: URL, db: string) {
  const copy = new URL(url);
  copy.pathname = `/${db}`;
  return copy.toString();
}
