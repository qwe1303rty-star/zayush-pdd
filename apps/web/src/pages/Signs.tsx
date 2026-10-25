import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dumbbell, Heart, Info, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { signNumber, type SignDTO } from '@zayush/shared';
import { Page } from '../components/Layout';
import { BunnyBubble, Button, Card, Chips, cx, EmptyState, ErrorState, Pill, ScreenHeader, Skeleton } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { haptic } from '../lib/telegram';

interface SignsResponse {
  categories: { code: string; title: string }[];
  signs: SignDTO[];
}

function useSigns() {
  return useQuery({ queryKey: ['signs'], queryFn: () => api<SignsResponse>('/signs'), staleTime: 5 * 60_000 });
}

export function Signs() {
  const navigate = useNavigate();
  const q = useSigns();
  const [cat, setCat] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase().replaceAll('ё', 'е');
    return (q.data?.signs ?? []).filter(
      (x) =>
        (cat === 'all' || (cat === 'fav' ? x.isFavorite : x.category === cat)) &&
        (!s || signNumber(x.code).startsWith(s) || x.title.toLowerCase().replaceAll('ё', 'е').includes(s)),
    );
  }, [q.data, cat, search]);

  const cats = useMemo(() => {
    const present = new Set(q.data?.signs.map((s) => s.category));
    return [
      { value: 'all', label: 'Все' },
      ...(q.data?.categories.filter((c) => present.has(c.code)).map((c) => ({ value: c.code, label: c.title })) ?? []),
      { value: 'fav', label: '♡ Избранные' },
    ];
  }, [q.data]);

  return (
    <Page>
      <ScreenHeader title="Дорожные знаки" back={null} />
      <label className="flex items-center gap-2 h-12 px-4 rounded-full bg-white border-2 border-pink-100 focus-within:border-pink">
        <Search className="size-5 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Название или номер, например 5.16"
          className="flex-1 bg-transparent outline-none font-bold text-[15px] placeholder:text-muted placeholder:font-semibold"
          inputMode="search"
        />
      </label>
      <Chips className="mt-3" items={cats} value={cat} onChange={setCat} />

      <Card className="mt-3 p-3.5 flex items-center gap-3" onClick={() => navigate('/quiz/topic/signs')}>
        <div className="size-11 rounded-2xl bg-pink text-white grid place-items-center">
          <Dumbbell className="size-5" />
        </div>
        <div className="flex-1">
          <div className="font-black">Тренировка по знакам</div>
          <div className="text-[12.5px] font-bold text-muted">Вопросы с настоящими знаками ПДД</div>
        </div>
      </Card>

      <div className="mt-3">
        {q.isPending ? (
          <div className="grid grid-cols-3 gap-2.5">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState message={(q.error as ApiError).message} onRetry={() => q.refetch()} />
        ) : !filtered.length ? (
          <EmptyState title="Ничего не нашлось" text="Попробуй другое название или номер знака." image="/brand/sticker-wow.webp" />
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/signs/${s.code}`)}
                className="relative rounded-[var(--radius-tile)] bg-white border border-pink-100 shadow-[var(--shadow-card)] p-2.5 pt-3 flex flex-col items-center active:scale-[0.97] transition"
              >
                {s.isFavorite ? <Heart className="absolute top-2 right-2 size-3.5 fill-pink text-pink" /> : null}
                <img src={s.imageUrl} alt={s.title} loading="lazy" className="h-[68px] w-auto" />
                <div className="mt-2 text-[11px] font-extrabold text-pink">{signNumber(s.code)}</div>
                <div className="text-[12px] font-bold leading-tight text-center line-clamp-2">{s.title}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-5 text-[11.5px] font-semibold text-muted text-center">
        Все знаки из Приложения 1 и разметка из Приложения 2 к ПДД РФ. Изображения и описания — по открытому набору pdd_russia; эталон изображений — ГОСТ Р 52290.
      </p>
    </Page>
  );
}

export function SignDetail() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useSigns();
  const sign = q.data?.signs.find((s) => s.code === code);
  const [fav, setFav] = useState<boolean | null>(null);
  const isFav = fav ?? sign?.isFavorite ?? false;
  const catTitle = q.data?.categories.find((c) => c.code === sign?.category)?.title;

  const toggle = async () => {
    if (!sign) return;
    setFav(!isFav);
    haptic('select');
    try {
      await api(`/signs/${sign.id}/favorite`, { method: 'PUT', body: { favorite: !isFav } });
      qc.invalidateQueries({ queryKey: ['signs'] });
    } catch {
      setFav(isFav);
    }
  };

  return (
    <Page>
      <ScreenHeader title={sign ? (sign.category === 'markup' ? `Разметка ${signNumber(sign.code)}` : `Знак ${sign.code}`) : 'Знак'} back="/signs" />
      {q.isPending ? <Skeleton className="h-72" /> : null}
      {q.data && !sign ? <EmptyState title="Знак не найден" text="Возможно, его ещё нет в каталоге." /> : null}
      {sign ? (
        <>
          <Card className="p-6 text-center">
            <img src={sign.imageUrl} alt={sign.title} className="h-44 mx-auto" />
            <div className="mt-4 flex justify-center gap-2">
              <Pill>{signNumber(sign.code)}</Pill>
              {catTitle ? <Pill tone="sky">{catTitle}</Pill> : null}
            </div>
            <h2 className="mt-2 text-[22px] font-black leading-tight">{sign.category === 'markup' ? sign.title : `«${sign.title}»`}</h2>
          </Card>
          <Card className="mt-3 p-4">
            <div className="text-[12px] font-extrabold text-pink uppercase tracking-wide">Что означает</div>
            <p className="mt-1 font-semibold leading-relaxed">{sign.description}</p>
          </Card>
          {sign.example ? (
            <BunnyBubble className="mt-3" image="/brand/sticker-joy.webp">
              {sign.example}
            </BunnyBubble>
          ) : null}
          {sign.penalty ? (
            <Card className="mt-3 p-4">
              <div className="text-[12px] font-extrabold text-bad uppercase tracking-wide">Если нарушить</div>
              <p className="mt-1 text-[14px] font-semibold leading-relaxed text-ink-soft">{sign.penalty}</p>
              <div className="mt-2 flex gap-1.5 text-[11.5px] font-semibold text-muted">
                <Info className="size-3.5 shrink-0 mt-0.5" /> Штрафы указаны на дату обновления справочника — проверяйте актуальную редакцию КоАП РФ.
              </div>
            </Card>
          ) : null}
          <div className="mt-4 flex gap-3">
            <button
              onClick={toggle}
              className={cx('h-[52px] px-4 rounded-full border-2 font-extrabold flex items-center gap-1.5 bg-white', isFav ? 'border-pink text-pink' : 'border-pink-200 text-ink-soft')}
            >
              <Heart className={cx('size-5', isFav && 'fill-pink')} /> {isFav ? 'В избранном' : 'В избранное'}
            </button>
            <Button className="flex-1 w-auto" onClick={() => navigate('/quiz/topic/signs')}>
              Тренироваться
            </Button>
          </div>
        </>
      ) : null}
    </Page>
  );
}
