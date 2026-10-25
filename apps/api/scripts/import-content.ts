/**
 * Импорт контента из JSON.
 *   npm run db:seed                      — билеты A, B, M, знаки, разметка (content/abm/content.json) + ранги/достижения
 *   npm run content:import -- path.json  — импорт своего файла (upsert по externalId)
 *   npm run content:import -- path.json --dry-run — только проверка файла
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../src/db.js';
import { importContent, seedDefaults, validateContent, type ContentFile } from '../src/services/content-import.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const demo = args.includes('--demo');
const fileArg = args.find((a) => !a.startsWith('--'));
const file = demo || !fileArg ? resolve(root, 'content/abm/content.json') : resolve(process.cwd(), fileArg);

const content = JSON.parse(readFileSync(file, 'utf8')) as ContentFile;
const errs = validateContent(content);
if (errs.length) {
  console.error('Файл содержит ошибки:\n- ' + errs.join('\n- '));
  process.exit(1);
}
if (dryRun) {
  console.log(`OK: ${content.questions.length} вопросов, ${content.signs?.length ?? 0} знаков, ${content.knowledge?.length ?? 0} объяснений`);
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL);
await seedDefaults(db);
const report = await importContent(db, content);
console.log('Импорт завершён:', report);
await db.$disconnect();
