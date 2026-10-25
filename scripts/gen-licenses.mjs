#!/usr/bin/env node
/**
 * Формирует content/licenses/third-party.json — список сторонних npm-пакетов, которые попадают
 * в production-сборку (API, бот, Mini App), с их лицензиями. Показывается на странице /legal/licenses.
 * Запуск: npm run licenses
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));

const found = new Map();
const walk = (deps) => {
  for (const [name, info] of Object.entries(deps ?? {})) {
    if (name.startsWith('@zayush/')) {
      walk(info.dependencies);
      continue;
    }
    if (!info.version) continue; // необязательная зависимость, не установлена
    const key = `${name}@${info.version}`;
    if (found.has(key)) continue;
    found.set(key, { name, version: info.version });
    walk(info.dependencies);
  }
};
walk(tree.dependencies);

const COPYLEFT = /\b(GPL|AGPL|LGPL|SSPL|EUPL|CC-BY-SA|CC-BY-NC)\b/i;
const packages = [];
const problems = [];
for (const p of found.values()) {
  const pj = join(root, 'node_modules', p.name, 'package.json');
  let license = 'UNKNOWN';
  let url;
  if (existsSync(pj)) {
    const j = JSON.parse(readFileSync(pj, 'utf8'));
    license = typeof j.license === 'string' ? j.license : (j.license?.type ?? (Array.isArray(j.licenses) ? j.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN'));
    url = typeof j.homepage === 'string' ? j.homepage : undefined;
  }
  if (license === 'UNKNOWN' || COPYLEFT.test(license)) problems.push(`${p.name}@${p.version}: ${license}`);
  packages.push({ name: p.name, version: p.version, license, ...(url ? { url } : {}) });
}
packages.sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(join(root, 'content/licenses'), { recursive: true });
writeFileSync(join(root, 'content/licenses/third-party.json'), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), packages }, null, 1) + '\n');
console.log(`Пакетов: ${packages.length}`);
const counts = packages.reduce((m, p) => ((m[p.license] = (m[p.license] ?? 0) + 1), m), {});
console.log(counts);
if (problems.length) console.warn('Проверьте вручную (копилефт или лицензия не указана):\n  ' + problems.join('\n  '));
