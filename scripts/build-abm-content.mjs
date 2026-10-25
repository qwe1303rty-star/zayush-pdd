#!/usr/bin/env node
/**
 * Собирает content/abm/content.json из открытого набора экзаменационных билетов
 * https://github.com/etspring/pdd_russia (категории A, B, M; знаки; разметка)
 * и наших материалов:
 *   content/abm/style/*.json  — формулировки вопросов в стиле «Заюш» (ключ «билет-вопрос»)
 *   content/sign-notes.json   — описания знаков, которых нет в наборе, и бытовые примеры
 *   content/knowledge.json    — проверенная база ответов помощника
 *
 * Картинки билетов, знаков и разметки копируются в apps/web/public/pdd/.
 *
 * Запуск:
 *   git clone --depth 1 https://github.com/etspring/pdd_russia ../pdd_russia
 *   node scripts/build-abm-content.mjs ../pdd_russia
 *   npm run db:seed
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(process.argv[2] ?? '../pdd_russia');
if (!existsSync(join(src, 'questions/A_B/tickets'))) {
  console.error(`Не найден набор pdd_russia в ${src}. Укажите путь: node scripts/build-abm-content.mjs <путь>`);
  process.exit(1);
}

const pub = join(root, 'apps/web/public/pdd');
for (const d of ['abm', 'signs', 'markup']) mkdirSync(join(pub, d), { recursive: true });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
/** Убирает служебные пометки набора вида «(Изменения вступили в силу: 1 марта 2023 года)» */
const dropChangeNotes = (s) => clean(clean(s).replace(/\s*\(Изменения вступили в силу:[^)]*\)\.?/gi, ''));

// ── Стиль «Заюш» ──
const style = {};
const styleDir = join(root, 'content/abm/style');
for (const f of readdirSync(styleDir).filter((x) => x.endsWith('.json')).sort()) Object.assign(style, readJson(join(styleDir, f)));

// ── Наши пояснения к ответам (собственный текст; заменяет комментарии из набора) ──
const explain = {};
const explainDir = join(root, 'content/abm/explain');
for (const f of readdirSync(explainDir).filter((x) => x.endsWith('.json')).sort()) Object.assign(explain, readJson(join(explainDir, f)));

const notes = readJson(join(root, 'content/sign-notes.json'));
const knowledge = readJson(join(root, 'content/knowledge.json')).knowledge;

// ── Темы ──
const TOPIC_SLUGS = {
  'Общие положения': 'general',
  'Общие обязанности водителей': 'driver-duties',
  'Применение специальных сигналов': 'special-signals',
  'Сигналы светофора и регулировщика': 'traffic-lights',
  'Применение аварийной сигнализации и знака аварийной остановки': 'hazard-warning',
  'Начало движения, маневрирование': 'maneuvering',
  'Расположение транспортных средств на проезжей части': 'lane-position',
  'Скорость движения': 'speed',
  'Обгон, опережение, встречный разъезд': 'overtaking',
  'Остановка и стоянка': 'stopping',
  'Проезд перекрестков': 'intersections',
  'Пешеходные переходы и места остановок маршрутных транспортных средств': 'pedestrian-crossings',
  'Движение через железнодорожные пути': 'railway',
  'Движение по автомагистралям': 'motorways',
  'Движение в жилых зонах': 'residential',
  'Приоритет маршрутных транспортных средств': 'route-vehicles',
  'Пользование внешними световыми приборами и звуковыми сигналами': 'lights-signals',
  'Буксировка механических транспортных средств': 'towing',
  'Учебная езда и дополнительные требования к движению велосипедистов': 'training-cyclists',
  'Перевозка людей и грузов': 'transport',
  'Неисправности и условия допуска транспортных средств к эксплуатации': 'malfunctions',
  'Дорожные знаки': 'signs',
  'Дорожная разметка': 'markings',
  'Безопасность движения и техника управления автомобилем': 'driving-safety',
  'Оказание доврачебной медицинской помощи': 'first-aid',
  'Ответственность водителя': 'liability',
};
const TOPIC_ORDER = Object.keys(TOPIC_SLUGS);

// ── Знаки и разметка ──
const CATEGORY = {
  'Предупреждающие знаки': 'warning',
  'Знаки приоритета': 'priority',
  'Запрещающие знаки': 'prohibitory',
  'Предписывающие знаки': 'mandatory',
  'Знаки особых предписаний': 'special',
  'Информационные знаки': 'info',
  'Знаки сервиса': 'service',
  'Знаки дополнительной информации (таблички)': 'plates',
};
const signs = [];
const noImage = [];
const placeholderSvg = (code) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="Изображение знака ${code} готовится"><rect x="4" y="4" width="112" height="112" rx="16" fill="#fff" stroke="#ffb3d6" stroke-width="3" stroke-dasharray="8 6"/><text x="60" y="62" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#24232b">${code}</text><text x="60" y="86" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#9a8f9e">изображение готовится</text></svg>\n`;
const signsJson = readJson(join(src, 'signs/signs.json'));
for (const [catName, items] of Object.entries(signsJson)) {
  for (const s of Object.values(items)) {
    const raw = clean(s.description);
    const [descPart, ...penaltyParts] = raw.split(/Наказание за нарушение требований (?:знака|таблички|разметки)\s*:?/i);
    const description =
      notes.descriptions[s.number] || dropChangeNotes(descPart) || clean(s.title);
    const title = notes.titles?.[s.number] || clean(s.title);
    const penalty = dropChangeNotes(penaltyParts.join(' ')) || null;
    const file = `${s.number}.svg`;
    const hasImage = existsSync(join(src, s.image));
    const override = join(root, 'content/sign-images', file);
    if (existsSync(override)) {
      // Изображение из content/sign-images (Wikimedia Commons или собственная отрисовка; авторство — в attribution.json)
      copyFileSync(override, join(pub, 'signs', file));
    } else if (hasImage) copyFileSync(join(src, s.image), join(pub, 'signs', file));
    else {
      // В наборе нет изображения: не рисуем знак «по памяти», а ставим нейтральную заглушку с номером.
      // Настоящее изображение загрузите в админке (Знаки → Изображение).
      writeFileSync(join(pub, 'signs', file), placeholderSvg(s.number));
      noImage.push(s.number);
    }
    signs.push({
      code: s.number,
      title,
      category: CATEGORY[catName],
      description,
      penalty,
      example: notes.examples[s.number] ?? null,
      imageUrl: `/pdd/signs/${file}`,
      imageVerified: false,
    });
  }
}
const markupJson = readJson(join(src, 'markup/markup.json'));
for (const [kind, items] of Object.entries(markupJson)) {
  for (const m of Object.values(items)) {
    const file = `${m.number}.svg`;
    copyFileSync(join(src, m.image), join(pub, 'markup', file));
    const [descPart, ...penaltyParts] = clean(m.description).split(/Наказание за нарушение требований (?:знака|таблички|разметки)\s*:?/i);
    signs.push({
      code: `m${m.number}`,
      title: `${kind === 'Горизонтальная разметка' ? 'Горизонтальная' : 'Вертикальная'} разметка ${m.number}`,
      category: 'markup',
      description: dropChangeNotes(descPart),
      penalty: clean(penaltyParts.join(' ')) || null,
      example: null,
      imageUrl: `/pdd/markup/${file}`,
      imageVerified: false,
    });
  }
}
const signCodes = new Set(signs.map((s) => s.code));

// ── Ссылки на пункты ПДД и знаки из пояснения ──
const NUM = /\d{1,2}\.\d{1,2}(?:\.\d{1,2})?/g;
function extractRefs(tip) {
  const clauses = new Set();
  const signRefs = new Set();
  for (const m of tip.matchAll(/(?:[Пп]ункт[а-я]*|п\.)\s*((?:\d{1,2}\.\d{1,2}(?:\.\d{1,2})?(?:\s*(?:,|и|-)\s*)?)+)(?![^()]*\bКоАП)/g)) {
    const after = tip.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (/^\s*(?:ст\.|статьи|КоАП|УК|Основных положений|Перечня|Приложения)/.test(after)) continue;
    for (const n of m[1].match(NUM) ?? []) if (Number(n.split('.')[0]) <= 26) clauses.add(n);
  }
  for (const m of tip.matchAll(/(?:знак[а-я]*|табличк[а-я]*)\s+((?:\d\.\d{1,2}(?:\.\d{1,2})?(?:\s*(?:,|и|-|–)\s*)?)+)/gi)) {
    for (const n of m[1].match(/\d\.\d{1,2}(?:\.\d{1,2})?/g) ?? []) if (signCodes.has(n)) signRefs.add(n);
  }
  return { clauseRefs: [...clauses], signRefs: [...signRefs] };
}

function hintFor(refs) {
  const parts = [];
  if (refs.clauseRefs.length) parts.push(`Подсказка от Заюша: ответ прячется в ${refs.clauseRefs.length > 1 ? 'пунктах' : 'пункте'} ${refs.clauseRefs.slice(0, 3).join(', ')} ПДД 💗`);
  if (refs.signRefs.length) parts.push(`Обрати внимание на знак ${refs.signRefs.slice(0, 2).join(', ')}.`);
  return parts.length ? parts.join(' ') : null;
}

// ── Билеты ──
const topics = new Map();
const tickets = [];
const questions = [];
const missingStyle = [];
const missingExplain = [];
const imageCache = new Set();
for (let t = 1; t <= 40; t++) {
  const data = readJson(join(src, `questions/A_B/tickets/Билет ${t}.json`));
  const ids = [];
  data.forEach((q, i) => {
    const pos = i + 1;
    const key = `${t}-${pos}`;
    const externalId = `abm-${String(t).padStart(2, '0')}-${String(pos).padStart(2, '0')}`;
    ids.push(externalId);
    const topicName = clean(q.topic?.[0]) || 'Общие положения';
    if (!TOPIC_SLUGS[topicName]) throw new Error(`Неизвестная тема «${topicName}»`);
    topics.set(topicName, TOPIC_SLUGS[topicName]);

    let imageUrl = null;
    if (q.image && !q.image.includes('no_image')) {
      const file = basename(q.image);
      if (!imageCache.has(file)) {
        copyFileSync(join(src, q.image), join(pub, 'abm', file));
        imageCache.add(file);
      }
      imageUrl = `/pdd/abm/${file}`;
    }
    const officialText = clean(q.question);
    const text = style[key] ? clean(style[key]) : officialText;
    if (!style[key]) missingStyle.push(key);
    // Пояснение — только наш текст. Комментарий набора не используется (лицензия на него не указана).
    if (!explain[key]) missingExplain.push(key);
    const tip = clean(explain[key] ?? '');
    const refs = extractRefs(tip);
    questions.push({
      externalId,
      topic: TOPIC_SLUGS[topicName],
      examBlock: Math.ceil(pos / 5),
      text,
      officialText,
      hint: hintFor(refs),
      imageUrl,
      imageAlt: imageUrl ? `Иллюстрация к вопросу ${pos} билета ${t}` : null,
      options: q.answers.map((a) => ({ text: clean(a.answer_text), ...(a.is_correct ? { correct: true } : {}) })),
      explanation: tip,
      takeaway: null,
      clauseRefs: refs.clauseRefs,
      signRefs: refs.signRefs,
    });
  });
  tickets.push({ number: t, title: `Билет ${t}`, questions: ids });
}

const out = {
  set: { code: 'abm', title: 'Экзаменационные билеты A, B, M', isDemo: false },
  sources: {
    pdd: 'https://www.consultant.ru/document/cons_doc_LAW_2709/',
    dataset: 'https://github.com/etspring/pdd_russia',
  },
  retire: { questionPrefixes: ['demo-'], ticketSets: ['demo'] },
  topics: TOPIC_ORDER.filter((n) => topics.has(n)).map((n, i) => ({ slug: TOPIC_SLUGS[n], title: n, examBlock: null, sortOrder: i + 1 })),
  tickets,
  questions,
  signs,
  knowledge,
};
mkdirSync(join(root, 'content/abm'), { recursive: true });
writeFileSync(join(root, 'content/abm/content.json'), JSON.stringify(out, null, 1) + '\n');
console.log(
  `Готово: ${questions.length} вопросов, ${tickets.length} билетов, ${out.topics.length} тем, ${signs.length} знаков и линий разметки, ${imageCache.size} картинок билетов.`,
);
if (noImage.length) console.warn(`Знаки без изображения в наборе (поставлена заглушка): ${noImage.join(', ')}`);
if (missingExplain.length) {
  console.error(`Нет пояснения: ${missingExplain.join(', ')}`);
  process.exit(1);
}
if (missingStyle.length) console.warn(`Без формулировки «Заюш» (показан официальный текст): ${missingStyle.join(', ')}`);
console.log(`С подсказкой: ${questions.filter((q) => q.hint).length}`);
