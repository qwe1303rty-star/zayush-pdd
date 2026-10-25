import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, FileText, Flag, Globe, Info, Languages, Palette, RotateCcw, Trash2 } from 'lucide-react';
import { AGE_RATING } from '@zayush/shared';
import { useNavigate } from 'react-router';
import { useState } from 'react';
import { Page } from '../components/Layout';
import { Card, Logo, Modal, Button, ScreenHeader, Toggle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/hooks';
import { haptic, showConfirm, tg } from '../lib/telegram';
import { MenuItem } from './Profile';
import { ReportModal } from './Quiz';

export function Settings() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [about, setAbout] = useState(false);
  const [report, setReport] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const navigate = useNavigate();

  const notif = useMutation({
    mutationFn: async (on: boolean) => {
      // Разрешение писать в личку запрашиваем у Telegram, если ещё не дано
      if (on && tg?.isVersionAtLeast('6.9')) {
        await new Promise<void>((resolve) => tg!.requestWriteAccess(() => resolve()));
      }
      return api<{ notificationsEnabled: boolean }>('/me/settings', { method: 'PATCH', body: { notificationsEnabled: on } });
    },
    onSuccess: (r) => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['me'] });
      setNote(r.notificationsEnabled ? 'Напоминания включены. Чтобы бот мог писать, запусти его командой /start.' : 'Напоминания выключены.');
    },
  });

  const reset = useMutation({
    mutationFn: () => api('/me/reset-progress', { body: { confirm: 'RESET' } }),
    onSuccess: () => {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith('zayush:quiz'))
        .forEach((k) => sessionStorage.removeItem(k));
      qc.invalidateQueries();
      setNote('Учебный прогресс сброшен. Баллы, ранги и награды остались с тобой 💗');
    },
  });

  const remove = useMutation({
    mutationFn: () => api('/me', { method: 'DELETE', body: { confirm: 'DELETE' } }),
    onSuccess: () => {
      try {
        Object.keys(sessionStorage)
          .filter((k) => k.startsWith('zayush:'))
          .forEach((k) => sessionStorage.removeItem(k));
        Object.keys(localStorage)
          .filter((k) => k.startsWith('zayush:'))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        /* noop */
      }
      haptic('success');
      qc.clear();
      navigate('/');
      qc.invalidateQueries();
    },
  });

  return (
    <Page>
      <ScreenHeader title="Настройки" back="/profile" />
      <div className="space-y-2">
        <MenuItem
          icon={<Bell className="size-5" />}
          title="Уведомления"
          text="Напоминания от бота о занятиях"
          right={<Toggle checked={!!me?.user.notificationsEnabled} disabled={notif.isPending} onChange={(v) => notif.mutate(v)} />}
        />
        <MenuItem icon={<Globe className="size-5" />} title="Выбор страны" text="Россия · ПДД РФ" right={<span />} />
        <MenuItem icon={<Palette className="size-5" />} title="Тема приложения" text="Розовая 💗" right={<span />} />
        <MenuItem icon={<Languages className="size-5" />} title="Язык" text="Русский" right={<span />} />
        <MenuItem
          icon={<RotateCcw className="size-5" />}
          title="Сброс прогресса"
          text="Ответы, ошибки и статистика"
          onClick={async () => {
            if (await showConfirm('Сбросить учебный прогресс? Баллы, ранги и награды сохранятся.')) reset.mutate();
          }}
        />
        <MenuItem icon={<Flag className="size-5" />} title="Сообщить об ошибке" text="В вопросе, знаке или приложении" onClick={() => setReport(true)} />
        <MenuItem icon={<Info className="size-5" />} title="О приложении" text="Источники и важные оговорки" onClick={() => setAbout(true)} />
        <MenuItem icon={<FileText className="size-5" />} title="Документы" text="Политика данных, согласие, соглашение, лицензии" onClick={() => navigate('/docs')} />
        <MenuItem
          icon={<Trash2 className="size-5" />}
          title="Удалить аккаунт и данные"
          text="Отзыв согласия: прогресс, награды и настройки удалятся"
          onClick={async () => {
            if (await showConfirm('Удалить аккаунт и все данные без возможности восстановления? Это также отзыв согласия на обработку персональных данных.'))
              remove.mutate();
          }}
        />
      </div>
      {note ? <Card className="mt-3 p-3.5 text-[13.5px] font-bold text-ink-soft">{note}</Card> : null}
      {notif.isError || reset.isError || remove.isError ? (
        <p className="mt-2 text-bad font-bold text-[13px]">{((notif.error ?? reset.error ?? remove.error) as ApiError).message}</p>
      ) : null}

      <Modal open={about} onClose={() => setAbout(false)}>
        <div className="space-y-3 text-[14px] font-semibold leading-relaxed">
          <Logo size={34} />
          <p>«Заюш ПДД» — игровой тренажёр по Правилам дорожного движения РФ: снаружи милота и юмор, внутри — настоящие правила.</p>
          <p>
            Объяснения опираются на текст ПДД РФ (постановление Совета Министров — Правительства РФ от 23.10.1993 № 1090) и
            Приложение 1 «Дорожные знаки». Номера пунктов и знаков сверены с текстом правил.
          </p>
          {me?.isDemoContent ? <p className="rounded-xl bg-[#fff6d6] p-2.5">Сейчас загружены демонстрационные вопросы — это не официальные билеты ГИБДД.</p> : null}
          <p>Приложение не является официальным сервисом ГИБДД, не даёт юридических консультаций и не гарантирует сдачу экзамена.</p>
          <p className="text-muted text-[12px]">Ранги и награды — игровые и не связаны с оценкой внешности. Изображения машинок — стилизованные рисунки, не товары конкретных производителей.</p>
          <p className="text-muted text-[12px]">Возрастная маркировка {AGE_RATING}.</p>
          <Button onClick={() => setAbout(false)}>Понятно 💗</Button>
        </div>
      </Modal>
      <ReportModal open={report} onClose={() => setReport(false)} />
    </Page>
  );
}
