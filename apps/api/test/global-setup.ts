import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Тестовая БД: TEST_DATABASE_URL или локальная zayush_test. Миграции применяются перед тестами. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://zayush:zayush_dev@localhost:5432/zayush_test';
  process.env.TEST_DATABASE_URL = url;
  execSync('npx prisma migrate deploy', { cwd: resolve(__dirname, '../../..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
