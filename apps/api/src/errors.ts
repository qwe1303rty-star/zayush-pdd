/** Ошибка с безопасным для пользователя текстом. Внутренние детали в ответ не попадают. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errors = {
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', 'Открой приложение через Telegram-бота, кисуль 💗'),
  forbidden: () => new AppError(403, 'FORBIDDEN', 'Недостаточно прав'),
  notFound: (what = 'Не найдено') => new AppError(404, 'NOT_FOUND', what),
  badRequest: (msg = 'Некорректный запрос') => new AppError(400, 'BAD_REQUEST', msg),
  conflict: (code: string, msg: string) => new AppError(409, code, msg),
  consentRequired: () =>
    new AppError(403, 'CONSENT_REQUIRED', 'Кисуль, сначала нужно твоё согласие на обработку данных 💗'),
  phoneRequired: () => new AppError(403, 'PHONE_REQUIRED', 'Подтверди номер телефона, чтобы продолжить 💗'),
  subscriptionRequired: () =>
    new AppError(403, 'SUBSCRIPTION_REQUIRED', 'Сначала загляни в наше сообщество — и сразу продолжим 💗'),
  subscriptionUnavailable: () =>
    new AppError(
      503,
      'SUBSCRIPTION_CHECK_UNAVAILABLE',
      'Telegram сейчас не отвечает, поэтому не получается проверить подписку. Попробуй ещё раз через минутку.',
    ),
};
