import { useMutation, useQuery } from '@tanstack/react-query';
import { BookMarked, ImageOff, SendHorizontal, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { AssistantReplyDTO } from '@zayush/shared';
import { Page } from '../components/Layout';
import { cx, Pill, ScreenHeader } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useSay } from '../lib/hooks';

interface Msg {
  role: 'user' | 'bot';
  text: string;
  reply?: AssistantReplyDTO;
}

const SUGGESTIONS = [
  'Почему на трассе 110, а не 130?',
  'Что значит знак 5.16?',
  'Как перевозить ребёнка 6 лет?',
  'Где нельзя обгонять?',
  'Что делать, если ослепили фары?',
];

const STORAGE_KEY = 'zayush:assistant';

export function Assistant() {
  const say = useSay();
  const info = useQuery({ queryKey: ['assistant-info'], queryFn: () => api<{ mode: 'knowledge-base' | 'ai' }>('/assistant/info') });
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-30)));
    } catch {
      /* noop */
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const ask = useMutation({
    mutationFn: (message: string) => api<AssistantReplyDTO>('/assistant', { body: { message } }),
    onSuccess: (reply) => setMsgs((m) => [...m, { role: 'bot', text: reply.answer, reply }]),
    onError: (e) => setMsgs((m) => [...m, { role: 'bot', text: (e as ApiError).message }]),
  });

  const send = (t: string) => {
    const v = t.trim();
    if (v.length < 2 || ask.isPending) return;
    setMsgs((m) => [...m, { role: 'user', text: v }]);
    setText('');
    ask.mutate(v);
  };

  return (
    <Page className="flex flex-col min-h-dvh">
      <ScreenHeader
        title={
          <span className="flex items-center gap-2">
            <img src="/brand/sticker-joy.webp" alt="" className="size-9 object-contain" /> Спроси Заюша
          </span>
        }
        subtitle={info.data?.mode === 'ai' ? 'Онлайн · отвечает по проверенной базе' : 'Отвечаю по проверенной базе объяснений'}
        back={null}
      />

      <div className="flex-1 space-y-3 pb-3">
        <BotBubble text={say('assistant.welcome', { seed: 0 })} />
        {!msgs.length ? (
          <div className="flex flex-wrap gap-2 pl-11">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full bg-white border border-pink-200 px-3 py-1.5 text-[13px] font-bold text-pink active:scale-95">
                {s}
              </button>
            ))}
          </div>
        ) : null}
        {msgs.map((m, i) => (m.role === 'user' ? <UserBubble key={i} text={m.text} /> : <BotBubble key={i} text={m.text} reply={m.reply} />))}
        {ask.isPending ? <BotBubble text="Заюш думает…" typing /> : null}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-[calc(var(--nav-h)+var(--safe-bottom))] -mx-4 px-4 py-3 bg-pink-50/95 backdrop-blur-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="flex items-center gap-2 h-12 pl-4 pr-1.5 rounded-full bg-white border-2 border-pink-100 focus-within:border-pink"
        >
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={800} placeholder="Напиши свой вопрос…" className="flex-1 bg-transparent outline-none font-bold placeholder:font-semibold placeholder:text-muted" />
          <button type="submit" disabled={text.trim().length < 2 || ask.isPending} aria-label="Отправить" className="size-9 rounded-full bg-pink text-white grid place-items-center disabled:opacity-40">
            <SendHorizontal className="size-4" />
          </button>
        </form>
        <div className="mt-1.5 flex items-center justify-center gap-1 text-[11px] font-semibold text-muted">
          <ImageOff className="size-3" /> Фото знаков пока не распознаю. Ответы — учебные, не юридическая консультация.
        </div>
      </div>
    </Page>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-[20px] rounded-br-md bg-gradient-to-b from-[#ff5aa8] to-pink text-white px-4 py-2.5 font-bold text-[14.5px] shadow-[var(--shadow-button)]">{text}</div>
    </div>
  );
}

function BotBubble({ text, reply, typing }: { text: string; reply?: AssistantReplyDTO; typing?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <img src="/brand/sticker-joy.webp" alt="" className="size-10 object-contain shrink-0" />
      <div className={cx('max-w-[85%] rounded-[20px] rounded-tl-md bg-white border border-pink-100 shadow-[var(--shadow-card)] px-4 py-3', typing && 'animate-pulse')}>
        <p className="font-semibold text-[14.5px] leading-relaxed whitespace-pre-line">{text}</p>
        {reply && (reply.clauseRefs.length || reply.signRefs.length) ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {reply.clauseRefs.map((c) => (
              <Pill key={c} tone="sky">
                <BookMarked className="size-3.5" /> п. {c} ПДД
              </Pill>
            ))}
            {reply.signRefs.map((s) => (
              <Link key={s} to={`/signs/${s}`}>
                <Pill tone="sky">знак {s}</Pill>
              </Link>
            ))}
          </div>
        ) : null}
        {reply?.related.filter((r) => r.kind === 'question').length ? (
          <div className="mt-2 text-[12px] font-bold text-muted">
            Потренироваться:{' '}
            {reply.related
              .filter((r) => r.kind === 'question')
              .map((r) => (
                <span key={r.id} className="block text-pink">• {r.title}</span>
              ))}
          </div>
        ) : null}
        {reply?.needsVerification ? (
          <div className="mt-2 flex items-center gap-1 text-[12px] font-bold text-[#a87400]">
            <TriangleAlert className="size-3.5" /> Требует проверки по тексту ПДД
          </div>
        ) : null}
      </div>
    </div>
  );
}
