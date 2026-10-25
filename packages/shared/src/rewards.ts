export type RewardKind = 'car' | 'accessory' | 'sticker';

export interface RewardDef {
  code: string;
  kind: RewardKind;
  title: string;
  image: string;
}

/** Каталог косметических наград (гараж). Картинки — фирменные ассеты в apps/web/public/brand */
export const REWARDS: RewardDef[] = [
  { code: 'car-pink', kind: 'car', title: 'Розовый внедорожник', image: '/brand/car-pink.webp' },
  { code: 'car-lilac', kind: 'car', title: 'Лавандовый внедорожник', image: '/brand/car-lilac.webp' },
  { code: 'car-sky', kind: 'car', title: 'Небесный внедорожник', image: '/brand/car-sky.webp' },
  { code: 'car-mint', kind: 'car', title: 'Мятный внедорожник', image: '/brand/car-mint.webp' },
  { code: 'car-white', kind: 'car', title: 'Жемчужный внедорожник', image: '/brand/car-white.webp' },
  { code: 'car-black', kind: 'car', title: 'Чёрный внедорожник', image: '/brand/car-black.webp' },
  { code: 'car-gold', kind: 'car', title: 'Золотой внедорожник', image: '/brand/car-gold.webp' },
  { code: 'item-crown', kind: 'accessory', title: 'Корона', image: '/brand/item-crown.webp' },
  { code: 'item-glasses', kind: 'accessory', title: 'Очки-сердечки', image: '/brand/item-glasses.webp' },
  { code: 'item-plate', kind: 'accessory', title: 'Номер «ЗАЮШ»', image: '/brand/item-plate.webp' },
  { code: 'item-bag', kind: 'accessory', title: 'Сумочка', image: '/brand/item-bag.webp' },
  { code: 'item-spoiler', kind: 'accessory', title: 'Спойлер', image: '/brand/item-spoiler.webp' },
  { code: 'item-wheel', kind: 'accessory', title: 'Диски', image: '/brand/item-wheel.webp' },
  { code: 'sticker-joy', kind: 'sticker', title: 'Радость', image: '/brand/sticker-joy.webp' },
  { code: 'sticker-hello', kind: 'sticker', title: 'Привет', image: '/brand/sticker-hello.webp' },
  { code: 'sticker-wink', kind: 'sticker', title: 'Подмигивание', image: '/brand/sticker-wink.webp' },
  { code: 'sticker-tender', kind: 'sticker', title: 'Нежность', image: '/brand/sticker-tender.webp' },
  { code: 'sticker-smile', kind: 'sticker', title: 'Улыбка', image: '/brand/sticker-smile.webp' },
  { code: 'sticker-laugh', kind: 'sticker', title: 'Смех', image: '/brand/sticker-laugh.webp' },
  { code: 'sticker-magic', kind: 'sticker', title: 'Волшебство', image: '/brand/sticker-magic.webp' },
  { code: 'sticker-wow', kind: 'sticker', title: 'Восторг', image: '/brand/sticker-wow.webp' },
];

export function rewardByCode(code: string): RewardDef | undefined {
  return REWARDS.find((r) => r.code === code);
}

export interface AchievementDef {
  code: string;
  title: string;
  description: string;
  /** Имя иконки lucide-react */
  icon: string;
  xpReward: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { code: 'first-steps', title: 'Первые шаги', description: 'Первый правильный ответ', icon: 'Footprints', xpReward: 5 },
  { code: 'ten-correct', title: 'Умничка', description: '10 разных вопросов решено верно', icon: 'Sparkles', xpReward: 15 },
  { code: 'ticket-clean', title: 'Без ошибок', description: 'Билет пройден без единой ошибки', icon: 'Gem', xpReward: 25 },
  { code: 'mistake-fixer', title: 'Работа над ошибками', description: 'Исправлено 5 ошибок', icon: 'RotateCcw', xpReward: 20 },
  { code: 'streak-3', title: 'Серия дней', description: '3 дня занятий подряд', icon: 'Flame', xpReward: 20 },
  { code: 'exam-passed', title: 'Экзамен мечты', description: 'Сдан экзамен в приложении', icon: 'Crown', xpReward: 30 },
  { code: 'signs-fan', title: 'Знаток знаков', description: '5 знаков в избранном', icon: 'TriangleAlert', xpReward: 10 },
];
