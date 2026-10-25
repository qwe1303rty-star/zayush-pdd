import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AGE_RATING, CONSENT_VERSION, type ConsentStatusDTO, LEGAL_DOCS, type LegalDocDTO, type LegalDocSlug } from '@zayush/shared';
import { Check, FileText, Phone, ShieldCheck } from 'lucide-react';
import { type MouseEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Page } from '../components/Layout';
import { Button, Card, ErrorState, Logo, Modal, ScreenHeader, Skeleton, cx } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { haptic } from '../lib/telegram';

export function useLegalDoc(slug: LegalDocSlug | null) {
  return useQuery({
    queryKey: ['legal', slug],
    queryFn: () => api<LegalDocDTO>(`/legal/${slug}`),
    enabled: !!slug,
    staleTime: 10 * 60_000,
  });
}

/** Текст документа. Ссылки на другие документы открываются внутри приложения. */
export function DocBody({ slug, onOpen }: { slug: LegalDocSlug; onOpen: (s: LegalDocSlug) => void }) {
  const doc = useLegalDoc(slug);
  if (doc.isPending) return <Skeleton className="h-64" />;
  if (doc.isError) return <ErrorState message={(doc.error as ApiError).message} onRetry={() => doc.refetch()} />;
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') ?? '';
    const m = href.match(/^\/legal\/([a-z]+)$/);
    if (m && LEGAL_DOCS.some((d) => d.slug === m[1])) {
      e.preventDefault();
      onOpen(m[1] as LegalDocSlug);
    } else if (a && /^https?:/.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  };
  return (
    <div>
      <p className="text-[12px] font-bold text-muted mb-2">Редакция от {doc.data.updatedAt}</p>
      {/* HTML формируется сервером из шаблона, пользовательского ввода в нём нет */}
      <div className="legal-doc" onClick={onClick} dangerouslySetInnerHTML={{ __html: doc.data.html }} />
    </div>
  );
}

/** Экран документа внутри приложения: /docs/:slug */
export function DocPage() {
  const { slug = 'privacy' } = useParams();
  const navigate = useNavigate();
  const s = (LEGAL_DOCS.find((d) => d.slug === slug)?.slug ?? 'privacy') as LegalDocSlug;
  const title = LEGAL_DOCS.find((d) => d.slug === s)!.title;
  return (
    <Page>
      <ScreenHeader title={title} back="/docs" />
      <Card className="p-4">
        <DocBody slug={s} onOpen={(x) => navigate(`/docs/${x}`)} />
      </Card>
    </Page>
  );
}

/** Список документов: /docs */
export function DocsList() {
  const navigate = useNavigate();
  return (
    <Page>
      <ScreenHeader title="Документы" back="/settings" />
      <div className="space-y-2">
        {LEGAL_DOCS.map((d) => (
          <Card key={d.slug} className="p-3.5 flex items-center gap-3" onClick={() => navigate(`/docs/${d.slug}`)}>
            <FileText className="size-5 text-pink shrink-0" />
            <span className="font-extrabold text-[14.5px]">{d.title}</span>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-center text-[12px] font-bold text-muted">Возрастная маркировка {AGE_RATING}</p>
    </Page>
  );
}

function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic('select');
        onChange(!checked);
      }}
      className="flex w-full items-start gap-3 text-left"
      aria-pressed={checked}
    >
      <span
        className={cx(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border-2 transition',
          checked ? 'border-pink bg-pink text-white' : 'border-pink-200 bg-white',
        )}
      >
        {checked ? <Check className="size-4" strokeWidth={3} /> : null}
      </span>
      <span className="text-[13.5px] font-semibold leading-snug text-ink-soft">{children}</span>
    </button>
  );
}

/**
 * Экран согласия на обработку персональных данных (152-ФЗ).
 * Показывается до создания учётной записи и при выходе новой версии документов.
 */
export function Consent() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['consent'], queryFn: () => api<ConsentStatusDTO>('/consent') });
  const [policy, setPolicy] = useState(false);
  const [age, setAge] = useState(false);
  const [open, setOpen] = useState<LegalDocSlug | null>(null);

  const accept = useMutation({
    mutationFn: () => api<{ ok: true }>('/consent', { body: { version: CONSENT_VERSION, acceptPolicy: true, ageConfirmed: true } }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries();
    },
  });

  const link = (slug: LegalDocSlug, text: string) => (
    <a
      href={`/legal/${slug}`}
      className="text-pink underline underline-offset-2"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(slug);
      }}
    >
      {text}
    </a>
  );

  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#ffe2f0] via-pink-50 to-white px-4 pb-8 pt-6">
      <div className="mx-auto max-w-[460px]">
        <div className="flex items-center justify-between">
          <Logo size={34} />
          <span className="rounded-full bg-white px-2.5 py-1 text-[12px] font-black text-ink-soft shadow-sm">{AGE_RATING}</span>
        </div>
        <img src="/brand/sticker-hello.webp" alt="" className="mx-auto mt-3 w-36" />
        <h1 className="mt-2 text-center text-[21px] font-black leading-tight">Привет! Прежде чем начнём 💗</h1>
        <Card className="mt-4 p-4 space-y-3">
          <div className="flex gap-2.5">
            <ShieldCheck className="size-5 text-pink shrink-0 mt-0.5" />
            <p className="text-[13.5px] font-semibold leading-relaxed">
              Чтобы сохранять твой прогресс, ошибки и награды, мне нужно хранить твой Telegram ID, имя и учебные результаты. Больше ничего —
              ни телефона из Telegram, ни контактов, ни переписки. Удалить всё можно в любой момент в настройках.
            </p>
          </div>
          <CheckRow checked={policy} onChange={setPolicy}>
            Я прочитал(а) {link('privacy', 'Политику обработки персональных данных')} и {link('terms', 'Пользовательское соглашение')} и даю{' '}
            {link('consent', 'согласие на обработку персональных данных')}
            {status.data ? <> оператору {status.data.operatorName}</> : null}.
          </CheckRow>
          <CheckRow checked={age} onChange={setAge}>
            Мне исполнилось 14 лет, или мой родитель (законный представитель) даёт согласие за меня.
          </CheckRow>
        </Card>
        {accept.isError ? <p className="mt-2 text-center text-[13px] font-bold text-bad">{(accept.error as ApiError).message}</p> : null}
        <Button className="mt-4" disabled={!policy || !age || accept.isPending} onClick={() => accept.mutate()}>
          {accept.isPending ? 'Секундочку…' : 'Принимаю, погнали! 💅'}
        </Button>
        <p className="mt-3 text-center text-[11.5px] font-semibold text-muted">
          Без согласия приложение не сохраняет никаких данных. Версия документов {CONSENT_VERSION}.
        </p>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)}>
        <div className="max-h-[70dvh] overflow-y-auto pr-1">
          {open ? (
            <>
              <h2 className="text-[17px] font-black mb-2">{LEGAL_DOCS.find((d) => d.slug === open)!.title}</h2>
              <DocBody slug={open} onOpen={setOpen} />
            </>
          ) : null}
        </div>
        <Button className="mt-3" onClick={() => setOpen(null)}>
          Закрыть
        </Button>
      </Modal>
    </div>
  );
}

/** Подтверждение российского номера телефона (если включено AUTH_RU_PHONE_REQUIRED) */
export function PhoneVerify() {
  const qc = useQueryClient();
  const [phone, setPhone] = useState('+7 ');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const start = useMutation({
    mutationFn: () => api('/phone/start', { body: { phone } }),
    onSuccess: () => {
      setSent(true);
      haptic('success');
    },
  });
  const verify = useMutation({
    mutationFn: () => api('/phone/verify', { body: { code } }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries();
    },
  });
  const err = (start.error ?? verify.error) as ApiError | null;
  const input = 'w-full rounded-2xl border-2 border-pink-100 bg-white px-4 py-3 text-[17px] font-extrabold outline-none focus:border-pink';
  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#ffe2f0] via-pink-50 to-white px-4 pt-8">
      <div className="mx-auto max-w-[420px]">
        <Logo size={34} />
        <Card className="mt-5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Phone className="size-5 text-pink" />
            <h1 className="text-[18px] font-black">Подтверди номер</h1>
          </div>
          <p className="text-[13.5px] font-semibold text-ink-soft leading-relaxed">
            По закону вход в российские сервисы подтверждается российским номером телефона. Пришлю SMS с кодом. Сам номер не сохраняется — только
            его зашифрованный отпечаток.
          </p>
          {!sent ? (
            <>
              <input className={input} inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 900 000-00-00" />
              <Button disabled={start.isPending || phone.replace(/\D/g, '').length < 11} onClick={() => start.mutate()}>
                {start.isPending ? 'Отправляю…' : 'Получить код'}
              </Button>
            </>
          ) : (
            <>
              <input
                className={cx(input, 'tracking-[0.4em] text-center')}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
              />
              <Button disabled={verify.isPending || code.length !== 6} onClick={() => verify.mutate()}>
                {verify.isPending ? 'Проверяю…' : 'Подтвердить'}
              </Button>
              <button className="w-full text-center text-[13px] font-bold text-pink" onClick={() => setSent(false)}>
                Изменить номер или отправить ещё раз
              </button>
            </>
          )}
          {err ? <p className="text-[13px] font-bold text-bad">{err.message}</p> : null}
        </Card>
      </div>
    </div>
  );
}
