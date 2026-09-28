import {
  ConversationEntrySchema,
  ConversationSchema,
  ProfileResponseSchema,
  ProviderSchema,
  ScheduleSchema,
  type Conversation,
  type ConversationEntry,
  type ProactiveCard,
  type Provider,
  type Slot,
} from './index.js';

// Fictional values only. This is UI/profile data, never a model context payload.
// Names, numbers, clauses and prices are invented for the demo and labelled as such in the UI.

export const demoProfile = ProfileResponseSchema.parse({
  member: {
    id: 'demo-lin',
    product: 'OSHC',
    productName: 'Bupa Overseas Student Health Cover · Single',
    memberSince: '2026-09-07',
    demo: true,
    fields: {
      // Existing membership data: reasonable expectation for member service, on by default.
      name: { value: 'Lin Zhao', permission: 'always', sessionId: null },
      dateOfBirth: { value: '2002-05-18', permission: 'off', sessionId: null },
      memberNumber: { value: 'DEMO-4D-000123', permission: 'always', sessionId: null },
      phone: { value: '04xx xxx 123', permission: 'always', sessionId: null },
      email: { value: 'lin@example.invalid', permission: 'off', sessionId: null },
      address: { value: '12 Demo St, Carlton VIC', permission: 'off', sessionId: null },
      emergencyContact: { value: 'Mum · +86 1xx xxxx', permission: 'off', sessionId: null },
      // Voluntary data: off until Lin grants it for a purpose.
      postcode: { value: '3053', permission: 'off', sessionId: null },
      preferredLanguage: { value: 'zh-CN', permission: 'off', sessionId: null },
      interpreter: { value: 'no', permission: 'off', sessionId: null },
      consultPreference: { value: 'either', permission: 'off', sessionId: null },
      reminderChannel: { value: 'push', permission: 'always', sessionId: null },
      needCategory: { value: '', permission: 'off', sessionId: null },
    },
  },
  covers: [
    {
      service: 'gp',
      status: 'included',
      outOfPocket: { min: 0, max: 45, currency: 'AUD' },
      summary: {
        en: '100% of the MBS fee for standard GP consultations. If the clinic charges above the MBS fee, you pay the difference.',
        zh: '标准 GP 门诊按 MBS 费用的 100% 报销。诊所收费高于 MBS 的部分需要自付。',
      },
      sourceLabel: 'OSHC Cover Summary · §2.1 Out-of-hospital medical (demo)',
      sourceUrl: null,
      disclaimer: 'Estimate only. Actual benefit depends on the claim.',
      waitingPeriod: null,
      limit: null,
      demo: true,
    },
    {
      service: 'telehealth',
      status: 'included',
      outOfPocket: { min: 0, max: 0, currency: 'AUD' },
      summary: {
        en: 'Blua video GP consultations are included with no out-of-pocket cost.',
        zh: 'Blua 视频 GP 问诊包含在保障内，无自付费用。',
      },
      sourceLabel: 'OSHC Cover Summary · §2.4 Digital health (demo)',
      sourceUrl: null,
      disclaimer: 'Estimate only. Actual benefit depends on the claim.',
      waitingPeriod: null,
      limit: null,
      demo: true,
    },
    {
      service: 'mental_health',
      status: 'partial',
      outOfPocket: { min: 0, max: 90, currency: 'AUD' },
      summary: {
        en: 'Psychology sessions up to an annual limit. Blua mental-health support is included at no cost.',
        zh: '心理咨询在年度额度内报销；Blua 远程心理支持免费包含。',
      },
      sourceLabel: 'OSHC Cover Summary · §3.2 Psychology (demo)',
      sourceUrl: null,
      disclaimer: 'Estimate only. Actual benefit depends on the claim.',
      waitingPeriod: { endsAt: '2026-11-06', served: false },
      limit: { used: 0, total: 500, currency: 'AUD', resetsAt: '2027-01-01' },
      demo: true,
    },
    {
      service: 'dental',
      status: 'excluded',
      outOfPocket: null,
      summary: {
        en: 'General dental is not included in this OSHC product. Bupa Dental clinics offer a member rate.',
        zh: '此 OSHC 产品不包含普通牙科。Bupa 牙科诊所提供会员价。',
      },
      sourceLabel: 'OSHC Cover Summary · §4 Exclusions (demo)',
      sourceUrl: null,
      disclaimer: 'Estimate only. Actual benefit depends on the claim.',
      waitingPeriod: null,
      limit: null,
      demo: true,
    },
    {
      service: 'emergency',
      status: 'included',
      outOfPocket: { min: 0, max: 0, currency: 'AUD' },
      summary: {
        en: 'Emergency department and ambulance are covered. In an emergency call 000.',
        zh: '急诊与救护车在保障内。紧急情况请拨打 000。',
      },
      sourceLabel: 'OSHC Cover Summary · §1.3 Emergency & ambulance (demo)',
      sourceUrl: null,
      disclaimer: 'Estimate only. Actual benefit depends on the claim.',
      waitingPeriod: null,
      limit: null,
      demo: true,
    },
    {
      service: 'hospital',
      status: 'partial',
      outOfPocket: null,
      summary: {
        en: 'Shared room in a public hospital. Pre-existing conditions have a 12-month waiting period.',
        zh: '公立医院多人病房。既往病症有 12 个月等待期。',
      },
      sourceLabel: 'OSHC Cover Summary · §1.1 Hospital (demo)',
      sourceUrl: null,
      disclaimer: 'Estimate only. Actual benefit depends on the claim.',
      waitingPeriod: { endsAt: '2027-09-07', served: false },
      limit: null,
      demo: true,
    },
  ],
});

export const emptySchedule = ScheduleSchema.parse({
  bookings: [],
  reminders: [],
  notes: [],
  drafts: [],
  cards: [],
});

export const demoCards: ProactiveCard[] = [
  {
    id: 'card-waiting-mental',
    kind: 'waiting_period',
    title: { en: 'Psychology waiting period ends soon', zh: '心理咨询等待期即将结束' },
    body: {
      en: 'From 6 Nov you can claim psychology sessions. Blua mental-health support is available now at no cost.',
      zh: '11 月 6 日起可以报销心理咨询。Blua 远程心理支持现在就可以免费使用。',
    },
    dueAt: '2026-11-06',
    prompt: {
      en: 'What mental health support can I use right now?',
      zh: '我现在能用哪些心理支持服务？',
    },
    dismissed: false,
  },
  {
    id: 'card-checkup',
    kind: 'checkup',
    title: { en: 'New member: find a regular GP', zh: '新会员：找一位固定 GP' },
    body: {
      en: 'Members who choose a regular GP in their first 90 days get faster follow-ups and fewer surprise costs.',
      zh: '在前 90 天内选定固定 GP 的会员，后续就诊更快、意外自付更少。',
    },
    dueAt: '2026-12-06',
    prompt: { en: 'Help me find a regular GP near me', zh: '帮我找一位附近的固定 GP' },
    dismissed: false,
  },
];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** ISO 8601 with the local UTC offset, e.g. 2026-09-30T14:30:00+10:00. */
export function toOffsetIso(date: Date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function slot(providerId: string, base: Date, dayOffset: number, hour: number, minute = 0): Slot {
  const start = new Date(base);
  start.setDate(start.getDate() + dayOffset);
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 20);
  return {
    id: `${providerId}-${dayOffset}-${hour}${pad(minute)}`,
    startsAt: toOffsetIso(start),
    endsAt: toOffsetIso(end),
  };
}

/** Demo providers with slots generated relative to `now`, so the demo always shows upcoming times. */
export function demoProviders(now = new Date()): Provider[] {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  return [
    ProviderSchema.parse({
      id: 'p-carlton-family',
      name: 'Carlton Family Medical (demo)',
      service: 'gp',
      address: '5 Demo Lane, Carlton VIC 3053',
      suburb: 'Carlton',
      distanceKm: 0.6,
      languages: ['en', 'zh-CN'],
      relationship: 'partner',
      telehealth: false,
      bulkBilling: false,
      rating: 4.6,
      reason: {
        en: 'Closest to you, Mandarin-speaking GP on Tuesday and Thursday, earliest slot tomorrow.',
        zh: '离你最近，周二和周四有说中文的 GP，最早明天就能约。',
      },
      slots: [
        slot('p-carlton-family', base, 1, 9, 40),
        slot('p-carlton-family', base, 1, 14, 20),
        slot('p-carlton-family', base, 1, 16, 0),
        slot('p-carlton-family', base, 2, 10, 20),
        slot('p-carlton-family', base, 2, 15, 0),
      ],
      outOfPocket: { min: 20, max: 45, currency: 'AUD' },
      demo: true,
    }),
    ProviderSchema.parse({
      id: 'p-bupa-health-cbd',
      name: 'Bupa Health Centre · Melbourne CBD (demo)',
      service: 'gp',
      address: '33 Demo St, Melbourne VIC 3000',
      suburb: 'Melbourne',
      distanceKm: 1.8,
      languages: ['en', 'zh-CN', 'vi'],
      relationship: 'bupa_owned',
      telehealth: false,
      bulkBilling: true,
      rating: 4.7,
      reason: {
        en: 'Bupa-owned clinic: no out-of-pocket for OSHC members and the claim is lodged for you.',
        zh: 'Bupa 自有诊所：OSHC 会员无自付，理赔由诊所直接提交。',
      },
      slots: [
        slot('p-bupa-health-cbd', base, 1, 11, 0),
        slot('p-bupa-health-cbd', base, 2, 9, 20),
        slot('p-bupa-health-cbd', base, 2, 13, 40),
        slot('p-bupa-health-cbd', base, 3, 10, 0),
      ],
      outOfPocket: { min: 0, max: 0, currency: 'AUD' },
      demo: true,
    }),
    ProviderSchema.parse({
      id: 'p-blua-video',
      name: 'Blua video GP (demo)',
      service: 'telehealth',
      address: 'Video consult · no travel',
      suburb: 'Online',
      distanceKm: null,
      languages: ['en', 'zh-CN'],
      relationship: 'bupa_owned',
      telehealth: true,
      bulkBilling: true,
      rating: 4.5,
      reason: {
        en: 'Soonest option: a Mandarin-speaking GP by video in about 40 minutes, no address needed.',
        zh: '最快的选择：约 40 分钟后就能视频见到说中文的 GP，不需要地址。',
      },
      slots: [
        slot('p-blua-video', new Date(now), 0, now.getHours() + 1, 0),
        slot('p-blua-video', new Date(now), 0, now.getHours() + 2, 20),
        slot('p-blua-video', base, 1, 8, 20),
        slot('p-blua-video', base, 1, 19, 0),
      ],
      outOfPocket: { min: 0, max: 0, currency: 'AUD' },
      demo: true,
    }),
    ProviderSchema.parse({
      id: 'p-blua-mind',
      name: 'Blua mental health support (demo)',
      service: 'mental_health',
      address: 'Video or phone · confidential',
      suburb: 'Online',
      distanceKm: null,
      languages: ['en', 'zh-CN'],
      relationship: 'bupa_owned',
      telehealth: true,
      bulkBilling: true,
      rating: 4.8,
      reason: {
        en: 'Available now at no cost, before your psychology waiting period ends.',
        zh: '现在就可以免费使用，不用等心理咨询的等待期结束。',
      },
      slots: [
        slot('p-blua-mind', base, 1, 12, 0),
        slot('p-blua-mind', base, 1, 18, 0),
        slot('p-blua-mind', base, 2, 17, 0),
      ],
      outOfPocket: { min: 0, max: 0, currency: 'AUD' },
      demo: true,
    }),
  ];
}

/* ------------------------------------------------------------ conversations */

/** Ids of the planted sample conversation, so tests and source links can refer to it. */
export const DEMO_CONVERSATION_ID = 'conv-demo-arm';
export const DEMO_ARM_USER_MESSAGE_ID = 'entry-demo-arm-user';
export const DEMO_ARM_ASSISTANT_MESSAGE_ID = 'entry-demo-arm-assistant';
/** How many local days before `demoNow` the sample message was sent. */
export const DEMO_ARM_DAYS_AGO = 14;

const demoArmText = {
  title: { en: 'Arm injury', zh: '手臂受伤咨询' },
  user: { en: 'I injured my arm and it feels serious.', zh: '我的胳膊受伤了，我觉得伤得很严重。' },
  assistant: {
    en: 'I am sorry to hear that. I cannot assess an injury, but here is how to choose where to go:\n\n• If the arm is badly deformed, you cannot move it, it is numb, or the pain is severe—go to an emergency department now or call 000. Emergency care is covered by your OSHC.\n• Otherwise a GP can examine it and refer you for an X-ray if needed. Standard GP visits are covered at 100% of the MBS fee (OSHC Cover Summary §2.1, demo data).\n\nIf you would like, I can prepare a GP booking for you to confirm.',
    zh: '听到这个消息很抱歉。我不能判断伤情，但可以帮你选对入口：\n\n• 如果手臂明显变形、无法活动、发麻，或疼痛剧烈——请立刻去急诊或拨打 000。急诊在你的 OSHC 保障范围内。\n• 其他情况可以先看 GP，由医生检查并在需要时转介拍 X 光。标准 GP 门诊按 MBS 费用的 100% 报销（OSHC 保障摘要 §2.1，演示数据）。\n\n如果需要，我可以帮你准备一次 GP 预约，由你确认。',
  },
};

/**
 * The fictional sample conversation planted on first initialisation: Lin mentioned an arm
 * injury `DEMO_ARM_DAYS_AGO` local days before `demoNow` and never followed up. Nothing else is
 * known—not which arm, not whether she saw a doctor, not how she is now. `demoNow` is saved by
 * the caller so later reloads keep the original timestamps instead of re-anchoring to "today".
 */
export function demoConversationSeed(
  demoNow: Date,
  locale: 'en' | 'zh',
): { conversation: Conversation; entries: ConversationEntry[] } {
  const reported = new Date(demoNow);
  reported.setDate(reported.getDate() - DEMO_ARM_DAYS_AGO);
  reported.setHours(20, 14, 0, 0);
  const replied = new Date(reported.getTime() + 60_000);
  const turnId = 'turn-demo-arm';
  const conversation = ConversationSchema.parse({
    id: DEMO_CONVERSATION_ID,
    title: demoArmText.title[locale],
    createdAt: toOffsetIso(reported),
    updatedAt: toOffsetIso(replied),
    activeDraftId: null,
    originSuggestionId: null,
    latestTurn: { id: turnId, status: 'completed' },
    seeded: true,
  });
  const entries = [
    ConversationEntrySchema.parse({
      kind: 'user',
      id: DEMO_ARM_USER_MESSAGE_ID,
      conversationId: DEMO_CONVERSATION_ID,
      turnId,
      order: 0,
      createdAt: toOffsetIso(reported),
      text: demoArmText.user[locale],
      clientMessageId: 'client-demo-arm-user',
      origin: 'user_input',
      sourceRefs: [],
    }),
    ConversationEntrySchema.parse({
      kind: 'assistant',
      id: DEMO_ARM_ASSISTANT_MESSAGE_ID,
      conversationId: DEMO_CONVERSATION_ID,
      turnId,
      order: 1,
      createdAt: toOffsetIso(replied),
      text: demoArmText.assistant[locale],
      translation: demoArmText.assistant[locale === 'zh' ? 'en' : 'zh'],
      suggestions: [],
      sourceRefs: [],
    }),
  ];
  return { conversation, entries };
}
