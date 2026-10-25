import { type AssistantReplyDTO, say, type VoiceOverrides } from '@zayush/shared';
import type { Db } from '../db.js';

/**
 * Помощник «Спроси Заюша».
 * По умолчанию работает ТОЛЬКО на проверенной базе объяснений (KnowledgeEntry + карточки знаков).
 * AI-провайдер подключается отдельно (AI_PROVIDER=anthropic + AI_API_KEY + AI_MODEL) и получает
 * найденные проверенные фрагменты как единственный источник фактов.
 */
export interface AiProvider {
  name: string;
  answer(question: string, groundedFacts: string[]): Promise<string>;
}

export function normalize(s: string): string {
  return s.toLowerCase().replaceAll('ё', 'е').replace(/[«»"“”„]/g, ' ').replace(/\s+/g, ' ').trim();
}

export class AssistantService {
  constructor(
    private db: Db,
    private ai: AiProvider | null = null,
  ) {}

  get mode(): 'knowledge-base' | 'ai' {
    return this.ai ? 'ai' : 'knowledge-base';
  }

  async ask(message: string, texts: VoiceOverrides = {}): Promise<AssistantReplyDTO> {
    const q = normalize(message).slice(0, 600);
    const related: AssistantReplyDTO['related'] = [];

    // 1. Номер знака в вопросе («что значит 5.16?»)
    const signCodes = [...q.matchAll(/(?<![\d.])(\d\.\d{1,2}(?:\.\d)?)(?![\d.])/g)].map((m) => m[1]);
    const clauseCodes = [...q.matchAll(/(?:п\.?|пункт)\s*(\d{1,2}\.\d{1,2}(?:\.\d)?)/g)].map((m) => m[1]);
    let signAnswer: string | null = null;
    const signRefs: string[] = [];
    for (const code of signCodes) {
      if (clauseCodes.includes(code)) continue;
      const sign = await this.db.roadSign.findFirst({ where: { code: { in: [code, `${code}`] }, isPublished: true } });
      if (sign) {
        signAnswer = `Знак ${sign.code} «${sign.title}». ${sign.description}`;
        signRefs.push(sign.code);
        related.push({ kind: 'sign', id: sign.code, title: `${sign.code} ${sign.title}` });
        break;
      }
    }

    // 2. Поиск по проверенной базе объяснений
    const entries = await this.db.knowledgeEntry.findMany({ where: { isPublished: true } });
    const scored = entries
      .map((e) => {
        let score = 0;
        for (const kw of e.keywords) if (kw && q.includes(normalize(kw))) score += Math.min(6, kw.length);
        if (normalize(e.title).split(' ').some((w) => w.length > 3 && q.includes(w))) score += 2;
        for (const c of clauseCodes) if (e.clauseRefs.includes(c)) score += 10;
        return { e, score };
      })
      .filter((x) => x.score >= 5)
      .sort((a, b) => b.score - a.score);

    const best = scored[0]?.e;
    const facts: string[] = [];
    if (signAnswer) facts.push(signAnswer);
    if (best) facts.push(best.answer);
    if (scored[1] && scored[1].score >= scored[0].score * 0.8) facts.push(scored[1].e.answer);

    // Связанные учебные вопросы
    if (best) {
      const qs = await this.db.question.findMany({
        where: { isPublished: true, OR: [{ clauseRefs: { hasSome: best.clauseRefs } }, { signRefs: { hasSome: [...best.signRefs, ...signRefs] } }] },
        select: { id: true, text: true },
        take: 2,
      });
      for (const x of qs) related.push({ kind: 'question', id: x.id, title: x.text });
    }

    if (!facts.length) {
      return {
        answer: say('assistant.notfound', { overrides: texts }),
        source: 'knowledge-base',
        matched: false,
        clauseRefs: [],
        signRefs: [],
        related,
        needsVerification: true,
      };
    }

    const clauseRefs = [...new Set([...(best?.clauseRefs ?? []), ...clauseCodes.filter((c) => best?.clauseRefs.includes(c))])];
    const allSignRefs = [...new Set([...signRefs, ...(best?.signRefs ?? [])])];

    if (this.ai) {
      try {
        const text = await this.ai.answer(message, facts);
        return { answer: text, source: 'ai', matched: true, clauseRefs, signRefs: allSignRefs, related, needsVerification: false };
      } catch {
        // При сбое AI честно отвечаем из базы
      }
    }
    const intro = ['Смотри, кисуль:', 'Объясняю по-простому:', 'Заюш, всё просто:'][message.length % 3];
    return {
      answer: `${intro} ${facts.join('\n\n')}`,
      source: 'knowledge-base',
      matched: true,
      clauseRefs,
      signRefs: allSignRefs,
      related,
      needsVerification: false,
    };
  }
}

/**
 * Адаптер Anthropic Messages API. Не активен, пока не заданы AI_PROVIDER=anthropic, AI_API_KEY и AI_MODEL.
 * Модель получает только проверенные факты и инструкцию не придумывать номера пунктов.
 */
export class AnthropicProvider implements AiProvider {
  name = 'anthropic';
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async answer(question: string, facts: string[]): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 600,
        system:
          'Ты — Заюш, дружелюбная подружка, объясняющая ПДД РФ простыми словами на русском. ' +
          'Используй ТОЛЬКО факты из блока ПРОВЕРЕННЫЕ ФАКТЫ. Не придумывай номера пунктов и знаков. ' +
          'Если фактов недостаточно, честно скажи, что ответ нужно проверить по тексту ПДД. Не давай юридических консультаций.',
        messages: [{ role: 'user', content: `ПРОВЕРЕННЫЕ ФАКТЫ:\n${facts.join('\n---\n')}\n\nВОПРОС: ${question}` }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) throw new Error('AI empty');
    return text;
  }
}
