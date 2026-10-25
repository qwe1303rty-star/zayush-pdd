import { BookMarked, Check, ChevronDown, Lightbulb, Scale, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { ExplanationDTO, QuestionDTO } from '@zayush/shared';
import { cx, Pill } from './ui';

export function QuestionImage({ url, alt }: { url: string | null; alt: string | null }) {
  if (!url) return null;
  const isSign = url.includes('/signs/') || url.includes('/markup/');
  return (
    <div className={cx('rounded-[var(--radius-card)] overflow-hidden border border-pink-100 shadow-[var(--shadow-card)] bg-white', isSign ? 'py-5' : 'p-2')}>
      <img
        src={url}
        alt={alt ?? 'Иллюстрация к вопросу'}
        className={cx(isSign ? 'mx-auto h-[150px] w-auto' : 'w-full max-h-[320px] object-contain')}
        loading="eager"
        decoding="async"
      />
    </div>
  );
}

type OptionState = 'idle' | 'selected' | 'correct' | 'wrong' | 'dim';

export function OptionButton({
  label,
  text,
  state,
  onClick,
  disabled,
}: {
  label: string;
  text: string;
  state: OptionState;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={state === 'selected'}
      className={cx(
        'w-full flex items-center gap-3 text-left rounded-[18px] border-2 px-3 py-3 min-h-[56px] transition',
        state === 'idle' && 'bg-white border-pink-100 active:scale-[0.985]',
        state === 'selected' && 'bg-pink-50 border-pink shadow-[0_0_0_4px_rgb(255_47_145_/_0.12)]',
        state === 'correct' && 'bg-ok-soft border-ok',
        state === 'wrong' && 'bg-bad-soft border-bad animate-shake',
        state === 'dim' && 'bg-white border-pink-100 opacity-60',
      )}
    >
      <span
        className={cx(
          'size-8 shrink-0 rounded-full grid place-items-center text-[14px] font-black',
          state === 'selected' && 'bg-pink text-white',
          state === 'correct' && 'bg-ok text-white',
          state === 'wrong' && 'bg-bad text-white',
          (state === 'idle' || state === 'dim') && 'bg-pink-100 text-pink',
        )}
      >
        {state === 'correct' ? <Check className="size-4" strokeWidth={3} /> : state === 'wrong' ? <X className="size-4" strokeWidth={3} /> : label}
      </span>
      <span className="flex-1 font-bold text-[15px] leading-snug">{text}</span>
    </button>
  );
}

/** Серьёзный разбор: правильный ответ, правило, пункты ПДД, почему другие варианты неверны */
export function Explanation({
  question,
  explanation,
  chosenOptionId,
  defaultOpen = true,
}: {
  question: Pick<QuestionDTO, 'options'>;
  explanation: ExplanationDTO;
  chosenOptionId: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const correct = question.options.find((o) => o.id === explanation.correctOptionId);
  const chosenWrong = chosenOptionId && chosenOptionId !== explanation.correctOptionId ? explanation.whyWrong.find((w) => w.optionId === chosenOptionId) : null;
  const others = explanation.whyWrong.filter((w) => w.optionId !== chosenOptionId);
  const optLabel = (id: string) => question.options.find((o) => o.id === id);

  return (
    <div className="rounded-[var(--radius-card)] bg-white border border-pink-100 shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left">
        <img src="/brand/sticker-joy.webp" alt="" className="size-9 object-contain" />
        <span className="flex-1 font-black text-pink">Заюш объясняет 💗</span>
        <ChevronDown className={cx('size-5 text-pink transition', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="px-4 pb-4 space-y-3">
          {correct ? (
            <div className="rounded-2xl bg-ok-soft border border-[#bfeccf] p-3">
              <div className="text-[12px] font-extrabold text-ok uppercase tracking-wide">Правильный ответ</div>
              <div className="mt-1 font-extrabold text-[15px]">
                {correct.label}. {correct.text}
              </div>
            </div>
          ) : null}

          <p className="text-[15px] font-semibold leading-relaxed text-ink">{explanation.explanation}</p>

          {chosenWrong ? (
            <div className="rounded-2xl bg-bad-soft border border-[#ffc6d1] p-3">
              <div className="text-[12px] font-extrabold text-bad uppercase tracking-wide">Почему не «{optLabel(chosenWrong.optionId)?.label}»</div>
              <p className="mt-1 text-[14px] font-semibold leading-snug">{chosenWrong.text}</p>
            </div>
          ) : null}

          {others.length ? (
            <details className="rounded-2xl bg-pink-50 border border-pink-100 p-3 group">
              <summary className="cursor-pointer text-[13px] font-extrabold text-pink list-none flex items-center justify-between">
                Почему другие варианты неверны <ChevronDown className="size-4 group-open:rotate-180 transition" />
              </summary>
              <ul className="mt-2 space-y-2">
                {others.map((w) => (
                  <li key={w.optionId} className="text-[13.5px] font-semibold leading-snug">
                    <b>{optLabel(w.optionId)?.label}.</b> {w.text}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {explanation.clauseRefs.length || explanation.signRefs.length ? (
            <div className="rounded-2xl bg-sky-soft border border-[#cfe0ff] p-3">
              <div className="flex items-center gap-1.5 text-[12px] font-extrabold text-sky uppercase tracking-wide">
                <Scale className="size-4" /> Основание
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {explanation.clauseRefs.map((c) => (
                  <Pill key={c} tone="sky">
                    <BookMarked className="size-3.5" /> п. {c} ПДД
                  </Pill>
                ))}
                {explanation.signRefs.map((s) => (
                  <Link key={s} to={`/signs/${s}`}>
                    <Pill tone="sky">знак {s}</Pill>
                  </Link>
                ))}
              </div>
              <div className="mt-2 text-[11.5px] font-semibold text-ink-soft">ПДД РФ — постановление Правительства от 23.10.1993 № 1090</div>
            </div>
          ) : null}

          {explanation.takeaway ? (
            <div className="rounded-2xl bg-[#fff6d6] border border-[#ffe69a] p-3 flex gap-2">
              <Lightbulb className="size-5 text-gold-deep shrink-0" />
              <div>
                <div className="text-[12px] font-extrabold text-[#a87400] uppercase tracking-wide">Запомни, заюш</div>
                <p className="text-[14px] font-bold leading-snug mt-0.5">{explanation.takeaway}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
