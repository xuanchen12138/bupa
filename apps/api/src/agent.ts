import { randomUUID } from 'node:crypto';
import type {
  ChatEvent,
  ChatRequest,
  ConsentDecision,
  ConsentRequest,
  Cover,
  ProviderSearch,
  ProviderSearchResult,
  Receipt,
  ServiceType,
  WizardDraft,
  WizardFieldValue,
} from '@bupa/contracts';
import { detectSafety } from './safety.js';

/** Deliberately excludes bookings, submission, navigation, raw Profile and persistence APIs. */
export interface AgentTools {
  sessionId: string;
  isAllowed(field: string): boolean;
  wasDenied?(field: string): boolean;
  getPreferences(): {
    postcode: string | null;
    language: string | null;
    interpreter: boolean | null;
  };
  getCover(service: ServiceType): Cover;
  requestConsent(
    fields: string[],
    options?: { sensitive?: boolean; wizardFieldId?: string },
  ): ConsentRequest;
  waitConsent(id: string, signal: AbortSignal): Promise<ConsentDecision>;
  createDraft(prefill: Record<string, WizardFieldValue>): WizardDraft;
  getDraft(id: string): WizardDraft;
  prefillDraft(
    id: string,
    fields: Record<string, WizardFieldValue>,
  ): { draft: WizardDraft; changed: string[] };
  findProviders(search: ProviderSearch): ProviderSearchResult;
  receiptEvents(consentId: string): Receipt[];
  setActiveDraft(id: string): void;
  getActiveDraft(): string | null;
}

export type AgentIntent =
  | 'information'
  | 'booking'
  | 'mental'
  | 'afternoon'
  | 'video'
  | 'bring'
  | 'thanks'
  | 'handoff'
  | 'manualAction'
  | 'fallback';
export interface AgentPlan {
  intent: AgentIntent;
  service: ServiceType;
}

/** A future model adapter may classify the message; execution and all authorization stay below. */
export interface AgentModel {
  readonly mode: 'demo' | 'openai';
  plan(message: string): AgentPlan | Promise<AgentPlan>;
}

function serviceFor(text: string): ServiceType {
  if (
    /心理|mental|psycholog|counsell|焦虑|抑郁|压力|stress|anxious|anxiety|depress|失眠|睡不着|can't sleep|overwhelmed|lonely/iu.test(
      text,
    )
  )
    return 'mental_health';
  if (/牙|dental|dentist/iu.test(text)) return 'dental';
  if (/住院|hospital/iu.test(text)) return 'hospital';
  if (/视频|远程|线上|video|telehealth|online|blua/iu.test(text)) return 'telehealth';
  if (/急诊|emergency/iu.test(text) && !/\bgp\b|全科|区别|difference/iu.test(text))
    return 'emergency';
  return 'gp';
}

/** Offline deterministic model. It only sees the user's message, never the member record. */
export class ScriptedLLM implements AgentModel {
  readonly mode = 'demo' as const;

  plan(message: string): AgentPlan {
    const service = serviceFor(message);
    if (
      /取消.*预约|提交.*预约|确认.*预约|(?:cancel|submit|confirm|pay for).*(?:booking|appointment)|skip.*(?:step|consent)|跳过.*(?:授权|步骤)/iu.test(
        message,
      )
    )
      return { intent: 'manualAction', service };
    if (/人工|客服|human|agent|customer service/iu.test(message))
      return { intent: 'handoff', service };
    if (/带什么|要带|what (?:should|do) i bring|bring/iu.test(message))
      return { intent: 'bring', service };
    // Questions about services or insurance never silently open a booking.
    if (
      /什么是|区别|等待期|报销|保障|费用|要多少钱|包不包|what (?:is|are)|difference|waiting period|\bmbs\b|\bgap\b|\bexcess\b|cover(?:ed|age)?|cost|how much/iu.test(
        message,
      ) &&
      !/帮我(?:约|预约|找)|预约|想看|想约|\bbook\b|\bschedule\b|\bfind\b/iu.test(message)
    )
      return { intent: 'information', service };
    if (service === 'mental_health') return { intent: 'mental', service };
    if (/下午|afternoon|later in the day/iu.test(message)) return { intent: 'afternoon', service };
    if (service === 'telehealth') return { intent: 'video', service };
    if (
      /预约|找.*(?:医生|诊所|gp)|看医生|看病|想看|想约|\bbook\b|\bappointment\b|\bfind\b|(?:want|need|like) to see|help me see/iu.test(
        message,
      )
    )
      return { intent: 'booking', service };
    if (/谢谢|多谢|thank|thx|cheers/iu.test(message)) return { intent: 'thanks', service };
    if (
      /\bgp\b|doctor|喉咙|嗓子|低烧|发烧|感冒|咳嗽|sore throat|fever|cold|cough|unwell/iu.test(
        message,
      )
    )
      return { intent: 'information', service };
    return { intent: 'fallback', service };
  }
}

const model: AgentModel = new ScriptedLLM();

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Request aborted', 'AbortError');
}

function serviceLabel(service: ServiceType, lang: 'en' | 'zh'): string {
  const labels: Record<ServiceType, [string, string]> = {
    gp: ['全科医生（GP）', 'general practitioner (GP)'],
    telehealth: ['视频问诊', 'video consultation'],
    mental_health: ['心理支持', 'mental health support'],
    dental: ['牙科', 'dental care'],
    emergency: ['急诊', 'emergency care'],
    hospital: ['住院', 'hospital care'],
  };
  return labels[service][lang === 'zh' ? 0 : 1];
}

function coverText(cover: Cover, lang: 'en' | 'zh'): string {
  const range = cover.outOfPocket
    ? `A$${cover.outOfPocket.min}–${cover.outOfPocket.max}`
    : lang === 'zh'
      ? '需要确认'
      : 'needs confirmation';
  const summary =
    cover.summary?.[lang] ?? (lang === 'zh' ? `状态：${cover.status}` : `Status: ${cover.status}`);
  const waiting =
    cover.waitingPeriod && !cover.waitingPeriod.served
      ? lang === 'zh'
        ? `\n演示等待期结束日：${cover.waitingPeriod.endsAt}。`
        : `\nDemo waiting period ends: ${cover.waitingPeriod.endsAt}.`
      : '';
  return lang === 'zh'
    ? `以下仅为虚构演示数据，不代表你的真实保障。\n\n${summary}\n模拟自付区间：${range}。${waiting}\n出处：${cover.sourceLabel}\n实际保障与费用需向保险公司和诊所确认。`
    : `Fictional demo data only; this does not establish your actual cover.\n\n${summary}\nIllustrative out-of-pocket range: ${range}.${waiting}\nSource: ${cover.sourceLabel}\nConfirm actual eligibility and costs with your insurer and provider.`;
}

function slotTime(iso: string, lang: 'en' | 'zh'): string {
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Emits only contract events; the HTTP layer owns done/error and connection teardown. */
export async function runDemoAgent(
  request: ChatRequest,
  tools: AgentTools,
  emit: (event: ChatEvent) => Promise<void>,
  signal: AbortSignal,
  planner: AgentModel = model,
): Promise<void> {
  const lang = /[㐀-鿿]/u.test(request.message)
    ? 'zh'
    : /[a-z]/iu.test(request.message)
      ? 'en'
      : request.uiLocale;
  const send = async (event: ChatEvent) => {
    throwIfAborted(signal);
    await emit(event);
    throwIfAborted(signal);
  };
  const say = (
    zh: string,
    en: string,
    suggestions: { zh: string[]; en: string[] } = { zh: [], en: [] },
  ) =>
    send({
      type: 'message',
      id: randomUUID(),
      text: lang === 'zh' ? zh : en,
      translation: lang === 'zh' ? en : zh,
      suggestions: suggestions[lang],
    });
  const status = async <T>(name: string, zh: string, en: string, action: () => T): Promise<T> => {
    const id = randomUUID();
    await send({
      type: 'tool_status',
      id,
      tool: name,
      status: 'running',
      label: lang === 'zh' ? zh : en,
    });
    throwIfAborted(signal);
    const result = action();
    await send({
      type: 'tool_status',
      id,
      tool: name,
      status: 'done',
      label: lang === 'zh' ? zh : en,
    });
    return result;
  };
  const consent = async (
    fields: string[],
    options?: { sensitive?: boolean; wizardFieldId?: string },
  ): Promise<boolean> => {
    const missing = fields.filter((field) => !tools.isAllowed(field));
    if (!missing.length) return true;
    // Respect a refusal throughout this session; Profile changes can explicitly grant it again.
    if (missing.some((field) => tools.wasDenied?.(field))) return false;
    throwIfAborted(signal);
    const pending = tools.requestConsent(missing, options);
    await send({ type: 'consent_request', request: pending });
    const decision = await tools.waitConsent(pending.id, signal);
    throwIfAborted(signal);
    await send({ type: 'consent_resolved', requestId: pending.id });
    for (const receipt of tools.receiptEvents(pending.id)) await send({ type: 'receipt', receipt });
    return decision !== 'deny' && fields.every((field) => tools.isAllowed(field));
  };
  const active = (): WizardDraft | null => {
    const id = request.openDraftId ?? tools.getActiveDraft();
    if (!id) return null;
    const draft = tools.getDraft(id);
    return draft.status === 'draft' ? draft : null;
  };
  const explainCover = async (service: ServiceType) => {
    const cover = await status('get_cover', '读取演示保障', 'Reading demo cover', () =>
      tools.getCover(service),
    );
    await say(coverText(cover, 'zh'), coverText(cover, 'en'));
  };

  throwIfAborted(signal);
  const alert = detectSafety(request.message, lang);
  if (alert) {
    await send(alert);
    return;
  }
  const plan = await planner.plan(request.message);
  throwIfAborted(signal);

  if (plan.intent === 'information') {
    if (/区别|difference|什么是.*(?:gp|急诊)|what is.*(?:gp|emergency)/iu.test(request.message)) {
      await say(
        'GP 是全科医生，可提供一般就诊和转介；急诊处理紧急情况。这里无法判断你的病情。如果现在有生命危险，请拨打 000。若你希望预约 GP，我可以帮你准备向导。',
        'A GP provides general medical care and referrals; an emergency department treats emergencies. I cannot assess your condition here. Call 000 for immediate danger. If you want a GP appointment, I can prepare the wizard.',
      );
    }
    await explainCover(plan.service);
    await say(
      '我可以继续解释，或按你的要求准备预约。',
      'I can explain more, or prepare an appointment if you ask.',
      {
        zh: ['帮我预约一个 GP', '我想要视频问诊'],
        en: ['Book me a GP', 'I would prefer a video consult'],
      },
    );
    return;
  }
  if (plan.intent === 'thanks') {
    await say(
      '不客气。准备好的草稿仍需你逐页确认并提交，提交后才会生成模拟预约。',
      'You are welcome. Review and submit each prepared draft yourself to create a demo booking.',
    );
    return;
  }
  if (plan.intent === 'manualAction') {
    await say(
      '预约提交、取消和逐页确认需要你亲自在向导或 Dashboard 中操作。我只能准备和更新草稿字段，不能跳过授权或代替你提交。',
      'Submit, cancel and page confirmations require your own action in the wizard or Dashboard. I can only prepare and update draft fields; I cannot skip consent or submit for you.',
    );
    return;
  }
  if (plan.intent === 'handoff') {
    await send({
      type: 'handoff',
      summary:
        'The member would like help understanding cover or preparing an appointment. No message has been sent; this offline demo cannot contact customer service.',
      ticket: null,
    });
    await say(
      '已准备不包含个人信息的英文摘要。本地演示不能发送消息或创建客服工单，请通过 Bupa 的官方客服渠道联系。',
      'A summary without personal details is prepared. This local demo cannot send it or create a support ticket; contact Bupa through its official support channel.',
    );
    return;
  }
  if (plan.intent === 'fallback') {
    await say(
      '我可以解释演示保障、查找模拟诊所、准备预约向导。请说明想了解什么或想预约哪类服务。',
      'I can explain demo cover, find fictional providers and prepare a booking wizard. Tell me what you want to understand or which service you want to book.',
      {
        zh: ['帮我预约一个 GP', '急诊和 GP 有什么区别？'],
        en: ['Book me a GP', 'What is the difference between emergency and a GP?'],
      },
    );
    return;
  }

  if (plan.intent === 'bring') {
    const zh =
      '请向诊所确认所需材料。通常可准备身份证明、会员卡、目前服用的药物清单和你想问的问题；如需付款，保留收据。';
    const en =
      'Confirm requirements with the provider. You can prepare identification, your member card, a list of current medicines and your questions; retain receipts if you pay.';
    const draft = active();
    if (draft) {
      const result = tools.prefillDraft(draft.id, { whatToBring: lang === 'zh' ? zh : en });
      await send({ type: 'wizard_prefill', ...result });
    }
    await say(zh, en);
    return;
  }

  if (plan.intent === 'afternoon') {
    const draft = active();
    if (!draft) {
      await say(
        '还没有可修改的预约草稿。请先告诉我想预约哪类服务。',
        'There is no active draft to edit. Tell me which service you want to book first.',
      );
      return;
    }
    const rawService = draft.fields.serviceType?.value;
    const service =
      typeof rawService === 'string' &&
      ['gp', 'telehealth', 'mental_health', 'dental', 'hospital', 'emergency'].includes(rawService)
        ? (rawService as ServiceType)
        : 'gp';
    const preferences = tools.getPreferences();
    const result = await status(
      'find_providers',
      '查询演示下午时段',
      'Checking demo afternoon slots',
      () =>
        tools.findProviders({
          service,
          postcode: preferences.postcode,
          language: preferences.language,
          telehealthOnly: preferences.postcode === null,
        }),
    );
    const provider = result.providers.find(
      (candidate) => candidate.id === draft.fields.providerId?.value,
    );
    const slot = provider?.slots.find((candidate) => {
      const hour = Number(
        new Intl.DateTimeFormat('en-AU', {
          timeZone: 'Australia/Melbourne',
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(candidate.startsAt)),
      );
      return hour >= 12 && hour < 18;
    });
    if (!provider || !slot) {
      await say(
        '当前诊所没有可用的模拟下午时段，原时间已保留。你可以在向导里选择其他诊所。',
        'There is no available demo afternoon slot for the selected provider. Your original time is unchanged; you can choose another provider in the wizard.',
      );
      return;
    }
    const updated = await status(
      'update_wizard_fields',
      '预填下午时段',
      'Prefilling an afternoon slot',
      () => tools.prefillDraft(draft.id, { slotId: slot.id }),
    );
    await send({ type: 'wizard_prefill', ...updated });
    await say(
      `已预填 ${slotTime(slot.startsAt, 'zh')}。请在当前向导中确认，尚未改动任何已提交预约。`,
      `Prefilled ${slotTime(slot.startsAt, 'en')}. Review it in the wizard; no submitted booking has changed.`,
    );
    return;
  }

  if (plan.service === 'emergency') {
    await say(
      '如果现在有生命危险，请拨打 000。此演示不能评估紧急程度，也不能预约急诊。',
      'Call 000 for immediate danger. This demo cannot assess urgency or book emergency care.',
    );
    return;
  }
  if (plan.service === 'hospital') {
    await explainCover('hospital');
    await say(
      '住院预约不在这个演示向导的支持范围内。请联系相关医院或 Bupa 的官方客服，确认入院安排和保障。',
      'Hospital admissions are outside this demo booking wizard. Contact the relevant hospital or Bupa through its official support channel to confirm admission arrangements and cover.',
    );
    return;
  }
  if (plan.intent === 'mental') {
    await say(
      '我可以帮你查找支持服务。心理支持属于敏感需求，继续前需要单独授权；只使用“心理支持”类别，不把你描述的细节写入草稿或档案。',
      'I can help find support services. Mental health is a sensitive need, so I ask for separate consent first. Only the category “mental health support” is used; your description will not be copied into the draft or profile.',
    );
    if (!(await consent(['mentalHealthNeed'], { sensitive: true }))) {
      await say(
        '已停止个性化处理，不会把这项需求写入预约草稿。你仍可直接联系 GP 或支持服务；Lifeline 的电话是 13 11 14，遇到生命危险请拨打 000。',
        'Personalised processing is stopped and this need will not be added to a booking draft. You can still contact a GP or support service directly; Lifeline is 13 11 14. Call 000 for immediate danger.',
      );
      return;
    }
  }

  await explainCover(plan.service);
  const telehealth = plan.intent === 'video' || plan.service === 'mental_health';
  // Interface language is not permission to use the stored preferredLanguage field.
  await consent(['preferredLanguage'], { wizardFieldId: 'language' });
  const locationAllowed =
    telehealth || (await consent(['postcode'], { wizardFieldId: 'postcode' }));
  const preferences = tools.getPreferences();
  const results = await status('find_providers', '查找模拟诊所', 'Finding demo providers', () =>
    tools.findProviders({
      service: plan.service,
      postcode: locationAllowed ? preferences.postcode : null,
      language: preferences.language,
      telehealthOnly: telehealth || !locationAllowed || preferences.postcode === null,
    }),
  );
  const first = results.providers[0];
  if (first && first.service !== plan.service) await explainCover(first.service);
  const fields: Record<string, WizardFieldValue> = {
    serviceType: first?.service ?? plan.service,
    // Persist only the category; no symptom transcripts or invented symptoms.
    need: serviceLabel(plan.service, lang),
    providerId: first?.id ?? null,
    slotId: first?.slots[0]?.id ?? null,
  };
  const existing = plan.intent === 'video' ? active() : null;
  if (existing) {
    const updated = await status(
      'update_wizard_fields',
      '预填视频问诊选项',
      'Prefilling video consultation options',
      () => tools.prefillDraft(existing.id, fields),
    );
    await send({ type: 'wizard_prefill', ...updated });
  } else {
    const draft = await status(
      'open_booking_wizard',
      '准备预约草稿',
      'Preparing a booking draft',
      () => tools.createDraft(fields),
    );
    tools.setActiveDraft(draft.id);
    await send({ type: 'wizard_open', draft });
  }
  if (!first) {
    await say(
      '当前筛选没有可用的模拟诊所。已打开草稿供你手动调整；没有创建预约。',
      'There are no demo providers for these filters. A draft is open for manual changes; no appointment was booked.',
    );
    return;
  }
  await say(
    `找到 ${results.providers.length} 个演示选项，已预填 ${first.name}${first.slots[0] ? `，${slotTime(first.slots[0].startsAt, 'zh')}` : ''}。当前准备的是${serviceLabel(first.service, 'zh')}草稿。${!locationAllowed ? '你拒绝了邮编使用，因此展示远程选项。' : ''}\n${results.rankingNote.zh}\n请逐页检查来源和字段，最后亲自提交；我不能翻页或提交预约。`,
    `Found ${results.providers.length} demo options and prefilled ${first.name}${first.slots[0] ? `, ${slotTime(first.slots[0].startsAt, 'en')}` : ''}. This draft is for ${serviceLabel(first.service, 'en')}.${!locationAllowed ? ' You declined postcode use, so these are remote options.' : ''}\n${results.rankingNote.en}\nReview each page and its field sources, then submit yourself. I cannot advance pages or submit a booking.`,
    {
      zh: ['改成下午', '我想要视频问诊', '要带什么？'],
      en: ['Change it to the afternoon', 'I would prefer a video consult', 'What should I bring?'],
    },
  );
}
