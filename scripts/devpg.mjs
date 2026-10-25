import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, '.devdata', 'pg');
const PORT = 5432;
const USER = 'zayush';
const PASSWORD = 'zayush';
const DB_NAME = 'zayush';

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-collate=C', '--lc-ctype=C'],
});

async function main() {
  if (!existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(DB_NAME);
  } catch (e) {
    // already exists
  }
  console.log(`[devpg] PostgreSQL ready: 127.0.0.1:${PORT}, db=${DB_NAME}, user=${USER}`);
  const shutdown = async () => {
    try { await pg.stop(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
