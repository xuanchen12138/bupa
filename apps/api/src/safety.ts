import type { ChatEvent } from '@bupa/contracts';

export type SafetyAlert = Extract<ChatEvent, { type: 'safety_alert' }>;

// This is a conservative demo stop rule, not a clinical triage or diagnosis model.
const redFlags =
  /胸痛|胸口(?:很)?痛|呼吸困难|喘不上气?|喘不过气|大出血|流血不止|昏迷|失去意识|晕倒|中风|自杀|自伤|不想活|结束生命|chest pain|can(?:not|'t) breathe|difficulty breathing|trouble breathing|breathing difficult(?:y|ies)?|shortness of breath|heavy bleeding|bleeding (?:won't|will not) stop|unconscious|passed out|stroke|suicid\w*|self[- ]harm|(?:kill|hurt) myself|end my life|(?:don't|do not) want to live/giu;

function isNegated(prefix: string): boolean {
  // Limit negation to the same clause and the immediately adjacent symptom.
  const clause = prefix.split(/[.!?;,，。！？；]|\bbut\b|但是|但|不过/iu).at(-1) ?? '';
  return (
    /(?:没有|并无|未出现|无)(?:任何|明显的?|持续的?)?\s*$/u.test(clause) ||
    /\b(?:no|without|deny|denies|denied|not (?:having|experiencing))(?:\s+(?:any|current|ongoing|severe|signs? of))?\s*$/iu.test(
      clause,
    )
  );
}

/** Return an urgent stop before tools run. Null never establishes that a person is safe. */
export function detectSafety(message: string, locale: 'en' | 'zh' = 'en'): SafetyAlert | null {
  const text = message.replace(/[’‘]/gu, "'").trim();
  const educational =
    /^(?:what (?:is|are|does)|define\b|explain\b|can you explain\b|什么是|解释|请解释)/iu.test(
      text,
    ) || /(?:是什么意思|的定义|有什么区别|有何区别|difference between)/iu.test(text);
  const reportsSymptoms =
    /\b(?:i|we|he|she|my (?:friend|partner|child|mother|father))\s+(?:am|is|are|have|has|feel|feels|can(?:not|'t))\b|我(?:现在|正在|有|感觉|想|不想)|(?:朋友|孩子|妈妈|爸爸)(?:现在|有|正在)/iu.test(
      text,
    );
  if (educational && !reportsSymptoms) return null;

  const matched = [...text.matchAll(redFlags)].some(
    (match) => !isNegated(text.slice(0, match.index)),
  );
  if (!matched) return null;

  const zh = locale === 'zh';
  return {
    type: 'safety_alert',
    message: zh
      ? '你提到的情况可能需要紧急帮助，我已暂停预约流程。若你或他人现在有生命危险，请立即拨打 000 或前往急诊。这个演示不能判断病情，也不能确认急诊或救护车的保障与费用。'
      : 'What you mention may need urgent help, so I have paused the booking flow. If you or someone else is in immediate danger, call 000 now or go to an emergency department. This demo cannot assess your condition or confirm emergency or ambulance cover and costs.',
    resources: [
      { label: zh ? '澳洲紧急电话' : 'Australian emergency services', value: '000' },
      { label: 'Lifeline', value: '13 11 14' },
    ],
  };
}
