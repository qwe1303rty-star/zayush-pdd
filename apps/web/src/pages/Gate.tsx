import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, ExternalLink, Megaphone, MessagesSquare, RefreshCw, WifiOff } from 'lucide-react';
import type { GateStatusDTO } from '@zayush/shared';
import { api, ApiError } from '../lib/api';
import { useSay } from '../lib/hooks';
import { haptic, openTelegramLink } from '../lib/telegram';
import { BunnyBubble, Button, Card, cx, Logo } from '../components/ui';

/** Экран обязательной подписки. Показывается только если проверка включена владельцем. */
export function Gate() {
  const qc = useQueryClient();
  const say = useSay();
  const status = useQuery({ queryKey: ['gate'], queryFn: () => api<GateStatusDTO>('/gate') });
  const check = useMutation({
    mutationFn: () => api<GateStatusDTO>('/gate/check', { method: 'POST' }),
    onSuccess: (res) => {
      qc.setQueryData(['gate'], res);
      haptic(res.passed ? 'success' : 'warning');
    },
  });

  const data = check.data ?? status.data;
  const state = check.isError ? 'error' : (data?.state ?? 'not-checked');
  const passed = data?.passed === true;

  return (
    <div className="min-h-dvh mx-auto max-w-[520px] px-5 pt-[calc(var(--safe-top)+var(--content-top)+20px)] pb-[calc(var(--safe-bottom)+24px)] flex flex-col">
      <div className="flex flex-col items-center">
        <img src="/brand/sticker-wink.webp" alt="" className="h-36 object-contain animate-float" />
        <Logo size={44} className="-mt-3" />
      </div>

      <Card className="mt-5 p-5">
        <h1 className="text-[22px] font-black">{say('gate.title', { seed: 0 })}</h1>
        <p className="mt-2 font-semibold text-ink-soft leading-relaxed">{say('gate.text', { seed: 0 })}</p>

        <div className="mt-4 space-y-2.5">
          {(data?.sources ?? []).map((s) => (
            <div key={s.id} className={cx('flex items-center gap-3 rounded-2xl border p-3', s.ok === true ? 'border-[#bfeccf] bg-ok-soft' : s.ok === false ? 'border-[#ffc6d1] bg-bad-soft/60' : 'border-pink-100 bg-pink-50')}>
              <div className="size-10 rounded-full bg-white grid place-items-center text-pink shrink-0">
                {s.kind === 'CHANNEL' ? <Megaphone className="size-5" /> : <MessagesSquare className="size-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold leading-tight">{s.title}</div>
                <div className="text-[12px] font-bold text-muted">{s.kind === 'CHANNEL' ? 'Канал' : 'Чат'}</div>
              </div>
              {s.ok === true ? (
                <CheckCircle2 className="size-6 text-ok" />
              ) : (
                <Button size="sm" variant={s.ok === false ? 'primary' : 'ghost'} onClick={() => openTelegramLink(s.url)}>
                  {s.kind === 'CHANNEL' ? 'Подписаться' : 'Вступить'} <ExternalLink className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4">
        {state === 'missing' && !check.isPending ? (
          <BunnyBubble tone="bad">Кисунь, пока не вижу тебя в некоторых местах выше 🙈 Подпишись и нажми «Проверить» ещё раз.</BunnyBubble>
        ) : null}
        {state === 'unavailable' ? (
          <BunnyBubble tone="bad">
            <span className="inline-flex items-center gap-1.5"><WifiOff className="size-4" /> Telegram сейчас не отвечает.</span> Это не твоя вина — попробуй ещё раз через минутку.
          </BunnyBubble>
        ) : null}
        {state === 'error' ? (
          <BunnyBubble tone="bad">
            <span className="inline-flex items-center gap-1.5"><CircleAlert className="size-4" /> {(check.error as ApiError)?.message}</span>
          </BunnyBubble>
        ) : null}
        {passed ? <BunnyBubble tone="ok">Всё получилось! Добро пожаловать в Заюш ПДД 💗</BunnyBubble> : null}
      </div>

      <div className="mt-auto pt-6 space-y-3">
        {passed ? (
          <Button onClick={() => qc.invalidateQueries({ queryKey: ['me'] })}>Продолжить</Button>
        ) : (
          <Button onClick={() => check.mutate()} loading={check.isPending}>
            {!check.isPending ? <RefreshCw className="size-4" /> : null} Я всё сделала, проверить
          </Button>
        )}
        <p className="text-center text-[12px] text-muted font-semibold">Проверяем подписку через Telegram — нажатие кнопки «Подписаться» само по себе не считается.</p>
      </div>
    </div>
  );
}
