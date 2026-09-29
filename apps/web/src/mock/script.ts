import type {
  BookingPrefill,
  ChatEvent,
  ConsentDecision,
  ConsentRequest,
  FieldSource,
  ProfileFieldName,
  Provider,
  SourceRef,
  WizardDraft,
  WizardFieldValue,
} from '@bupa/contracts';
import { classifyStatusUpdate, isOwnArmInjuryReport, mentionsArm } from './health-overview.ts';

// Lin's scripted conversation. This mirrors what the backend's ScriptedLLM will do:
// the same events, the same pauses for consent, the same tool names. Text is bilingual so the
// demo audience can read along; the reply language follows the user's input.

export type Lang = 'zh' | 'en';

export interface ScriptContext {
  lang: Lang;
  now: Date;
  emit: (event: ChatEvent) => void;
  wait: (ms: number) => Promise<void>;
  /** Pauses the script until the user answers the consent card. */
  requestConsent: (
    input: Omit<ConsentRequest, 'id' | 'sessionId' | 'status'>,
  ) => Promise<ConsentDecision>;
  hasPermission: (field: ProfileFieldName) => boolean;
  /** Profile value the script may use (membership data, or a preference once permitted). */
  profileValue: (field: ProfileFieldName) => string | null;
  /** Preference fields that one consent card covers together. */
  preferenceFields: ProfileFieldName[];
  /** Health messages this turn was started from (a Dashboard suggestion), else empty. */
  sourceRefs: SourceRef[];
  /** True when this conversation currently supports a health-overview item. */
  isHealthSource: boolean;
  openDraft: () => WizardDraft | null;
  createDraft: (
    prefill: Record<string, WizardFieldValue>,
    sources?: Record<string, FieldSource>,
  ) => WizardDraft;
  prefillDraft: (
    id: string,
    fields: Record<string, WizardFieldValue>,
  ) => { draft: WizardDraft; changed: string[] };
  findProviders: (
    service: string,
    postcode: string | null,
    language: string | null,
  ) => { providers: Provider[]; personalisedBy: ProfileFieldName[] };
  /** Shows recommendation cards; the member's pick creates the draft, not the script. */
  offerProviders: (
    providers: Provider[],
    personalisedBy: ProfileFieldName[],
    prefill: BookingPrefill,
  ) => void;
}

export type Intent =
  | 'safety'
  | 'armUpdate'
  | 'gp'
  | 'afternoon'
  | 'video'
  | 'bring'
  | 'mental'
  | 'coverQuestion'
  | 'thanks'
  | 'fallback';

export function detectLang(text: string): Lang {
  return /[㐀-鿿]/.test(text) ? 'zh' : 'en';
}

export type Topic = 'throat' | 'arm' | 'generic';

export function detectTopic(text: string): Topic {
  if (mentionsArm(text)) return 'arm';
  if (/喉咙|嗓子|发烧|低烧|感冒|咳嗽|sore throat|fever|cold|flu|cough/i.test(text)) return 'throat';
  return 'generic';
}

export function detectIntent(text: string, isHealthSource = false): Intent {
  const s = text.toLowerCase();
  if (
    /胸痛|呼吸困难|喘不上|大出血|流血不止|昏迷|晕倒|中风|自杀|自伤|不想活|chest pain|can'?t breathe|breath(ing)? difficult|heavy bleeding|unconscious|stroke|suicid|self[- ]harm|end my life/.test(
      s,
    )
  )
    return 'safety';
  // A follow-up about a known injury ("it's better now") is an update, not a new request.
  // It counts as one when the conversation already reports the item, or the message itself
  // refers back to an earlier mention; a brand-new report keeps the booking flow.
  const refersBack = /之前|上次|先前|earlier|mentioned|previously|before|last time/i.test(text);
  if (
    (mentionsArm(text) || isHealthSource) &&
    (isHealthSource || refersBack || !isOwnArmInjuryReport(text)) &&
    classifyStatusUpdate(text) !== null &&
    !/预约|book|appointment/i.test(text)
  )
    return 'armUpdate';
  if (mentionsArm(text) && /受伤|伤|疼|痛|injur|hurt|broke|sprain|pain|sore/i.test(text))
    return 'gp';
  if (
    /压力|焦虑|抑郁|睡不着|失眠|难过|情绪|stress|anxious|anxiety|depress|can'?t sleep|overwhelmed|lonely/.test(
      s,
    )
  )
    return 'mental';
  if (/下午|afternoon|later in the day/.test(s)) return 'afternoon';
  if (/视频|远程|线上|video|telehealth|online|blua/.test(s)) return 'video';
  if (/带什么|要带|带上|what (should|do) i bring|bring/.test(s)) return 'bring';
  if (
    /急诊|区别|什么是|等待期|emergency|difference|what is|waiting period|mbs|gap|excess|covered\?/.test(
      s,
    )
  )
    return 'coverQuestion';
  if (
    /喉咙|嗓子|发烧|低烧|感冒|咳嗽|看医生|看病|gp|doctor|sore throat|fever|cold|flu|cough|sick|unwell|appointment|book/.test(
      s,
    )
  )
    return 'gp';
  if (/谢谢|多谢|thank|thx|cheers/.test(s)) return 'thanks';
  return 'fallback';
}

const ids = { count: 0, next: (prefix: string) => `${prefix}-${Date.now()}-${++ids.count}` };

function pick<T>(lang: Lang, zh: T, en: T) {
  return lang === 'zh' ? zh : en;
}

function message(
  ctx: ScriptContext,
  zh: string,
  en: string,
  suggestions: { zh: string[]; en: string[] } = { zh: [], en: [] },
) {
  const primary = ctx.lang === 'zh' ? zh : en;
  const translation = ctx.lang === 'zh' ? en : zh;
  ctx.emit({
    type: 'message',
    id: ids.next('m'),
    text: primary,
    translation,
    suggestions: suggestions[ctx.lang],
  });
}

async function tool(ctx: ScriptContext, name: string, labelZh: string, labelEn: string, ms = 900) {
  const id = ids.next('t');
  ctx.emit({
    type: 'tool_status',
    id,
    tool: name,
    status: 'running',
    label: pick(ctx.lang, labelZh, labelEn),
  });
  await ctx.wait(ms);
  ctx.emit({
    type: 'tool_status',
    id,
    tool: name,
    status: 'done',
    label: pick(ctx.lang, labelZh, labelEn),
  });
}

function timeLabel(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-AU', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function sourceDateLabel(ctx: ScriptContext) {
  const first = ctx.sourceRefs[0];
  if (!first) return null;
  return new Intl.DateTimeFormat(ctx.lang === 'zh' ? 'zh-CN' : 'en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(first.reportedAt));
}

export async function runScript(ctx: ScriptContext, userText: string) {
  const intent = detectIntent(userText, ctx.isHealthSource);
  const topic = detectTopic(userText);
  const lang = ctx.lang;
  await ctx.wait(350);

  switch (intent) {
    case 'safety': {
      ctx.emit({
        type: 'safety_alert',
        message: pick(
          lang,
          '你描述的情况可能需要紧急处理。请立即拨打 000 或前往最近的急诊科。急诊和救护车都在你的 OSHC 保障范围内。我已经暂停了其他流程。',
          'What you describe may need urgent care. Please call 000 now or go to the nearest emergency department. Emergency care and ambulance are covered by your OSHC. I have paused everything else.',
        ),
        resources: [
          { label: pick(lang, '紧急电话', 'Emergency'), value: '000' },
          { label: 'Lifeline', value: '13 11 14' },
          { label: pick(lang, '中文心理支持', 'Mandarin support'), value: '1300 22 4636' },
        ],
      });
      return;
    }

    case 'armUpdate': {
      await tool(ctx, 'safety_check', '安全检查', 'Safety check', 400);
      const update = classifyStatusUpdate(userText);
      await tool(
        ctx,
        'update_health_overview',
        '正在更新健康概览（仅记录你的自述）',
        'Updating your health overview (your words only)',
        700,
      );
      if (update === 'reported_resolved') {
        message(
          ctx,
          '很高兴听到你的手臂已经恢复。我在健康概览里记录为“你表示已恢复”——这是你的自述，不是医学确认。相关的 GP 建议已经收起；如果之后又有不舒服，随时告诉我。',
          'Glad to hear your arm has recovered. I have noted it in your health overview as "you said it had recovered"—your words, not a medical confirmation. The related GP suggestion is put away; if it troubles you again, just tell me.',
        );
      } else if (update === 'reported_improving') {
        message(
          ctx,
          '谢谢更新。我记录为“有所好转，但仍有不适”，概览会保留这个事项。如果你想进一步确认，我可以帮你准备一次 GP 预约，由你决定是否提交。',
          'Thanks for the update. I have noted "better, but still uncomfortable" and kept the item open. If you would like it checked, I can prepare a GP booking for you to decide on.',
          { zh: ['帮我准备一个 GP 预约', '暂时不用'], en: ['Prepare a GP booking', 'Not for now'] },
        );
      } else if (update === 'reported_ongoing') {
        message(
          ctx,
          '谢谢告诉我。我记录为“仍有不适或仍在担心”。持续的疼痛、肿胀或活动受限值得让医生看看——我可以帮你准备一次 GP 预约，由你确认；如果出现剧痛、变形或麻木，请直接去急诊或拨打 000。',
          'Thank you for telling me. I have noted "still bothers you or still worried". Ongoing pain, swelling or limited movement is worth having examined—I can prepare a GP booking for you to confirm. If there is severe pain, deformity or numbness, go to an emergency department or call 000.',
          { zh: ['帮我准备一个 GP 预约'], en: ['Prepare a GP booking'] },
        );
      } else {
        message(
          ctx,
          '明白，我已经把这次更正记下来，并从健康概览中撤下了相关事项。',
          'Understood—I have recorded the correction and removed the item from your health overview.',
        );
      }
      return;
    }

    case 'gp': {
      await tool(ctx, 'safety_check', '安全检查', 'Safety check', 400);

      // 1. Which door: recommend the GP (never a diagnosis).
      const sourceDate = sourceDateLabel(ctx);
      const need =
        topic === 'arm'
          ? sourceDate
            ? pick(
                lang,
                `手臂受伤后的恢复情况检查（${sourceDate} 的对话中提到）`,
                `Check-up for an arm injury (mentioned in your conversation on ${sourceDate})`,
              )
            : pick(lang, '手臂受伤，需要医生检查', 'Arm injury, needs to be examined')
          : topic === 'throat'
            ? pick(lang, '喉咙痛、低烧两天', 'Sore throat and low fever for two days')
            : userText.trim().slice(0, 80);
      message(
        ctx,
        topic === 'arm'
          ? `${sourceDate ? `关于你在 ${sourceDate} 提到的手臂受伤：` : ''}建议看 GP（全科医生）。GP 可以检查手臂的恢复情况，并在需要时转介拍 X 光或物理治疗；如果出现剧痛、变形或麻木，请直接去急诊或拨打 000。`
          : topic === 'throat'
            ? '喉咙痛和低烧通常先看 GP（全科医生）就可以，不需要去急诊。GP 会检查并在需要时开药或转介。'
            : '这类情况建议先看 GP（全科医生），不需要去急诊。GP 会检查并在需要时开药或转介；如果出现胸痛、呼吸困难等紧急情况，请拨打 000。',
        topic === 'arm'
          ? `${sourceDate ? `About the arm injury you mentioned on ${sourceDate}: ` : ''}I recommend a GP (general practitioner). They can examine how the arm is recovering and refer you for an X-ray or physio if needed; severe pain, deformity or numbness means the emergency department or 000 instead.`
          : topic === 'throat'
            ? 'A sore throat and low fever are usually a GP (general practitioner) visit, not the emergency department. The GP will examine you and prescribe or refer if needed.'
            : 'For this I recommend a GP (general practitioner) rather than the emergency department. The GP will examine you and prescribe or refer if needed; chest pain or trouble breathing means 000.',
      );
      await ctx.wait(600);

      // 2. What it costs, from data Bupa already holds (the policy).
      await tool(
        ctx,
        'get_cover',
        '正在用你的保单估算费用',
        'Estimating your cost from your cover',
        1100,
      );
      message(
        ctx,
        '根据 Bupa 已有的保单信息估算：\n\n• 你的 OSHC 包含 GP 门诊，按 MBS（Medicare Benefits Schedule，政府医疗费用基准）的 100% 报销\n• 如果诊所收费高于 MBS，差额需要自付，通常在 A$0–45 之间；Bupa 自有诊所和 Blua 视频问诊没有自付\n• 没有等待期（waiting period）\n\n出处：OSHC 保障摘要 §2.1 门诊医疗（演示数据）。费用为估算，以实际理赔为准。',
        'Estimated from the policy Bupa already holds for you:\n\n• Your OSHC includes GP visits, paid at 100% of the MBS fee (Medicare Benefits Schedule, the government benchmark)\n• If a clinic charges above the MBS fee you pay the gap, usually A$0–45; Bupa clinics and Blua video GPs have no gap\n• No waiting period applies\n\nSource: OSHC Cover Summary §2.1 Out-of-hospital medical (demo data). Estimate only—the actual benefit depends on the claim.',
      );
      await ctx.wait(700);

      // 3. Bupa has the address; the preferences are the member's to share.
      const postcode = ctx.profileValue('postcode');
      const prefsAlreadyShared = ctx.preferenceFields.some((field) => ctx.hasPermission(field));
      let usePreferences = prefsAlreadyShared;
      if (prefsAlreadyShared) {
        message(
          ctx,
          `Bupa 已有你的邮编（${postcode ?? '—'}），我可以直接查附近的诊所。你之前已允许我使用 Profile 里的偏好，我会按你的偏好来排序。`,
          `Bupa already has your postcode (${postcode ?? '—'}), so I can search nearby right away. You have already let me use the preferences in your profile, so I will rank by them.`,
        );
      } else {
        message(
          ctx,
          `Bupa 已有你的邮编（${postcode ?? '—'}），我可以直接查附近的诊所。要不要也用你在 Profile 里预设的偏好——就诊时间、语言、可接受的路程——来排序推荐？`,
          `Bupa already has your postcode (${postcode ?? '—'}), so I can search nearby right away. Would you also like me to use the preferences you set in your profile—preferred time, language and how far you are happy to travel—to rank the options?`,
        );
        const decision = await ctx.requestConsent({
          fields: [...ctx.preferenceFields],
          sensitive: false,
          dataLabel: pick(
            lang,
            'Profile 中的偏好：就诊时间、语言、路程、就诊方式、口译',
            'Your profile preferences: preferred time, language, travel time, visit type, interpreter',
          ),
          purpose: pick(
            lang,
            '按你的偏好排序诊所和时段',
            'Rank clinics and appointment times to match how you like to see a doctor',
          ),
          benefit: pick(
            lang,
            '更合适的时间、更近的诊所，用你的语言',
            'Times that suit you, a shorter trip, in your language',
          ),
          excludedUses: pick(
            lang,
            ['定价或续保', '理赔审核', '营销'],
            ['Pricing or renewal', 'Claims assessment', 'Marketing'],
          ),
          retention: pick(
            lang,
            '仅本次：会话结束后失效 · 90 天：到期自动失效 · 始终：直到你撤回',
            'Once: ends with this session · 90 days: expires by itself · Always: until you withdraw it',
          ),
          allowedScopes: ['session', 'days90', 'always'],
          wizardFieldId: null,
        });
        usePreferences = decision !== 'deny';
      }

      // 4. Rank—with or without the preferences—and prepare the booking.
      await tool(
        ctx,
        'find_providers',
        usePreferences ? '正在按你的偏好查找诊所' : '正在按距离查找附近诊所',
        usePreferences
          ? 'Finding clinics that match your preferences'
          : 'Finding clinics near you by distance',
        1300,
      );
      const { providers, personalisedBy } = ctx.findProviders('gp', postcode, null);
      const languageFromProfile = usePreferences && ctx.hasPermission('preferredLanguage');
      const languageValue = languageFromProfile
        ? ctx.profileValue('preferredLanguage')
        : lang === 'zh'
          ? 'zh-CN'
          : null;
      ctx.offerProviders(providers, personalisedBy, {
        fields: {
          serviceType: 'gp',
          need,
          acceptTelehealth: true,
          postcode,
          language: languageValue,
          reminder: true,
          reminderLead: '2h',
        },
        sources: {
          postcode: 'profile',
          language: languageFromProfile ? 'profile' : 'conversation',
        },
      });
      await ctx.wait(400);
      message(
        ctx,
        usePreferences && personalisedBy.length
          ? `这是按你的偏好排序的 ${providers.length} 个选项，每张卡片写明了它如何匹配你的偏好。选一家，我就把预约向导准备好——需求来自我们的对话，姓名和会员号来自 Bupa 会员资料，保障信息来自保单；每一步仍由你确认。`
          : `这是按距离排序的 ${providers.length} 个选项（没有使用你的偏好，你随时可以在 Profile 中开启）。选一家，我就把预约向导准备好，每一步仍由你确认。`,
        usePreferences && personalisedBy.length
          ? `Here are ${providers.length} options ranked by your preferences; each card shows how it matches them. Pick one and I will prepare the booking—your need from this chat, your name and member number from your Bupa membership, the cover details from your policy. You still confirm every step.`
          : `Here are ${providers.length} options ranked by distance (your preferences were not used—you can turn them on in Profile any time). Pick one and I will prepare the booking; you still confirm every step.`,
        {
          zh: ['我想要视频问诊', '要带什么？'],
          en: ['I would prefer a video consult', 'What should I bring?'],
        },
      );
      return;
    }

    case 'afternoon': {
      const draft = ctx.openDraft();
      if (!draft) {
        message(
          ctx,
          '你想把哪个预约改到下午？先告诉我你要看什么，我来准备。',
          'Which booking should I move to the afternoon? Tell me what you need first and I will prepare it.',
        );
        return;
      }
      await tool(ctx, 'update_wizard_fields', '正在更新时段', 'Updating the time', 700);
      const providerId =
        typeof draft.fields.providerId?.value === 'string' ? draft.fields.providerId.value : null;
      const draftPostcode =
        typeof draft.fields.postcode?.value === 'string' ? draft.fields.postcode.value : null;
      const { providers } = ctx.findProviders(
        typeof draft.fields.serviceType?.value === 'string' ? draft.fields.serviceType.value : 'gp',
        draftPostcode,
        null,
      );
      const provider = providers.find((p) => p.id === providerId) ?? providers[0];
      const afternoon = provider?.slots.find((s) => new Date(s.startsAt).getHours() >= 13);
      const { draft: updated, changed } = ctx.prefillDraft(draft.id, {
        slotId: afternoon?.id ?? null,
        providerId: provider?.id ?? null,
      });
      ctx.emit({ type: 'wizard_prefill', draft: updated, changed });
      message(
        ctx,
        afternoon
          ? `已改成${timeLabel(afternoon.startsAt, lang)}（${provider?.name}）。向导里的时段已经高亮，确认一下就好。`
          : '这家诊所最近没有下午的时段，我保留了原来的时间。你可以在向导里换一家看看。',
        afternoon
          ? `Changed to ${timeLabel(afternoon.startsAt, lang)} at ${provider?.name}. The time is highlighted in the wizard—just confirm it.`
          : 'This clinic has no afternoon times soon, so I kept the original. You can switch clinics in the wizard.',
        { zh: ['要带什么？'], en: ['What should I bring?'] },
      );
      return;
    }

    case 'video': {
      const draft = ctx.openDraft();
      const { providers } = ctx.findProviders('telehealth', null, null);
      const blua = providers.find((p) => p.telehealth) ?? providers[0];
      if (draft) {
        await tool(
          ctx,
          'update_wizard_fields',
          '正在切换为视频问诊',
          'Switching to a video consult',
          700,
        );
        const { draft: updated, changed } = ctx.prefillDraft(draft.id, {
          serviceType: 'telehealth',
          acceptTelehealth: true,
          providerId: blua?.id ?? null,
          slotId: blua?.slots[0]?.id ?? null,
        });
        ctx.emit({ type: 'wizard_prefill', draft: updated, changed });
      } else {
        await tool(ctx, 'get_cover', '正在读取你的保单', 'Reading your cover', 800);
        const created = ctx.createDraft({
          serviceType: 'telehealth',
          acceptTelehealth: true,
          providerId: blua?.id ?? null,
          slotId: blua?.slots[0]?.id ?? null,
          language: 'zh-CN',
          reminder: true,
          reminderLead: '2h',
        });
        ctx.emit({ type: 'wizard_open', draft: created });
      }
      message(
        ctx,
        `好，已切换为 Blua 视频问诊：说中文的 GP，最早 ${blua?.slots[0] ? timeLabel(blua.slots[0].startsAt, lang) : '今天'}，在 OSHC 保障内、没有自付，不需要地址。医生如果认为需要面诊，会直接帮你转介。向导里已高亮变更。`,
        `Done—switched to a Blua video GP: Mandarin-speaking, earliest ${blua?.slots[0] ? timeLabel(blua.slots[0].startsAt, lang) : 'today'}, included in your OSHC with no gap and no address needed. If the doctor thinks you need to be seen in person, they will refer you. The changes are highlighted in the wizard.`,
        { zh: ['要带什么？'], en: ['What should I bring?'] },
      );
      return;
    }

    case 'bring': {
      const draft = ctx.openDraft();
      if (draft) {
        const { draft: updated, changed } = ctx.prefillDraft(draft.id, {
          whatToBring: pick(
            lang,
            '护照或学生证 · Bupa 会员卡（App 内）· 症状开始的时间 · 正在吃的药 · 如需先付款，请保留收据用于理赔',
            'Passport or student ID · Bupa member card (in the app) · When symptoms started · Any medication you take · Keep the receipt if you pay upfront',
          ),
        });
        ctx.emit({ type: 'wizard_prefill', draft: updated, changed });
      }
      message(
        ctx,
        '带这些就够了：\n\n• 护照或学生证\n• Bupa 会员卡（App 里就有）\n• 症状开始的时间、正在吃的药\n• 如果诊所要求先付款，保留收据——之后可以在 App 里理赔\n\n我已经把这份清单写进了预约的“要带的东西”，预约成功后会出现在日程的备注里。',
        'This is all you need:\n\n• Passport or student ID\n• Your Bupa member card (it is in the app)\n• When symptoms started and any medication you take\n• If the clinic asks you to pay upfront, keep the receipt—you can claim in the app afterwards\n\nI have added this to “What to bring” in the booking; it will appear in your Dashboard notes once confirmed.',
      );
      return;
    }

    case 'mental': {
      await tool(ctx, 'safety_check', '安全检查', 'Safety check', 500);
      message(
        ctx,
        '听起来这段时间不容易，谢谢你告诉我。我可以帮你看看现在就能用的支持。\n\n心理健康属于敏感信息，所以我需要单独问你一次——而且我只会记录“心理支持”这个类别，不记录你说的具体内容：',
        'That sounds like a hard stretch—thank you for telling me. I can show you support you can use right now.\n\nMental health is sensitive information, so I ask separately, and I would only record the category “mental health support”, never what you said:',
      );
      const decision = await ctx.requestConsent({
        fields: ['mentalHealthNeed'],
        sensitive: true,
        dataLabel: pick(
          lang,
          '需求类别：心理支持（仅类别，不记录内容）',
          'Need category: mental health support (category only, no content)',
        ),
        purpose: pick(
          lang,
          '推荐你现在就能用的心理支持服务，并说明保障和等待期',
          'Recommend mental-health support you can use now and explain cover and waiting periods',
        ),
        benefit: pick(
          lang,
          'Blua 远程心理支持（免费、可说中文）与心理咨询保障说明',
          'Blua mental-health support (free, Mandarin available) and what your cover pays for psychology',
        ),
        excludedUses: pick(
          lang,
          ['营销', '定价、续保或理赔审核', '不会记录你说的具体内容'],
          [
            'Marketing',
            'Pricing, renewal or claims assessment',
            'Never the content of what you said',
          ],
        ),
        retention: pick(
          lang,
          '仅本次：对话结束后删除',
          'This session only: deleted when the conversation ends',
        ),
        allowedScopes: ['session'],
        wizardFieldId: null,
      });
      if (decision === 'deny') {
        message(
          ctx,
          '好的，我不会记录任何内容。你随时可以直接使用这些支持：Blua 远程心理支持（Bupa 会员免费，有中文服务）、Lifeline 13 11 14（24 小时）。如果你想，我也可以只帮你解释保障，不做任何记录。',
          'Of course—nothing is recorded. These are available to you any time: Blua mental-health support (free for Bupa members, Mandarin available) and Lifeline 13 11 14 (24 hours). If you like, I can just explain your cover without recording anything.',
        );
        return;
      }
      await tool(ctx, 'get_cover', '正在读取心理健康保障', 'Reading your mental-health cover', 900);
      const { providers } = ctx.findProviders('mental_health', null, null);
      const blua = providers[0];
      const draft = ctx.createDraft({
        serviceType: 'mental_health',
        need: pick(lang, '压力大，想和人聊聊', 'Feeling stressed, would like to talk to someone'),
        acceptTelehealth: true,
        providerId: blua?.id ?? null,
        slotId: blua?.slots[0]?.id ?? null,
        language: 'zh-CN',
        reminder: true,
        reminderLead: '2h',
      });
      ctx.emit({ type: 'wizard_open', draft });
      message(
        ctx,
        '你现在就能用的：Blua 远程心理支持，Bupa 会员免费，有说中文的咨询师，最早明天中午。\n\n你的保单里，心理咨询（psychology）有 A$500 的年度额度，但等待期到 11 月 6 日才结束——在那之前 Blua 是不花钱的选择。出处：OSHC 保障摘要 §3.2（演示数据）。\n\n我把预约准备在了右侧，只记录了“心理支持”这个类别。',
        'Available right now: Blua mental-health support—free for Bupa members, Mandarin-speaking counsellors, earliest tomorrow midday.\n\nYour policy also has an A$500 annual limit for psychology, but the waiting period runs until 6 November; until then Blua is the no-cost option. Source: OSHC Cover Summary §3.2 (demo data).\n\nThe booking is prepared on the right. Only the category “mental health support” was recorded.',
      );
      return;
    }

    case 'coverQuestion': {
      await tool(ctx, 'get_cover', '正在读取你的保单', 'Reading your cover', 900);
      message(
        ctx,
        '简单说：\n\n• **GP（全科医生）**：感冒、发烧、喉咙痛、开药、转介。OSHC 报销 MBS 的 100%，差额自付通常 A$0–45。\n• **急诊（Emergency Department）**：胸痛、呼吸困难、大出血、意识不清等危及生命的情况。急诊和救护车都在保障内，无自付。\n• **Blua 视频问诊**：不需要出门，说中文的 GP，无自付，适合大多数小病。\n\n出处：OSHC 保障摘要 §1.3、§2.1、§2.4（演示数据）。',
        'In short:\n\n• **GP (general practitioner)**: colds, fever, sore throat, prescriptions, referrals. OSHC pays 100% of the MBS fee; the gap is usually A$0–45.\n• **Emergency department**: chest pain, trouble breathing, heavy bleeding, confusion—anything life-threatening. Emergency care and ambulance are covered with no gap.\n• **Blua video GP**: no travel, Mandarin-speaking doctors, no gap—good for most minor illnesses.\n\nSource: OSHC Cover Summary §1.3, §2.1, §2.4 (demo data).',
        {
          zh: ['帮我预约一个 GP', '我想要视频问诊'],
          en: ['Book me a GP', 'I would prefer a video consult'],
        },
      );
      return;
    }

    case 'thanks': {
      message(
        ctx,
        '不客气。预约确认后会出现在日程里，我也会提前提醒你。祝早日康复！',
        'You are welcome. Once you confirm, the booking appears in your Dashboard and I will remind you beforehand. Get well soon!',
      );
      return;
    }

    default: {
      message(
        ctx,
        '我可以帮你做三件事：解释你的保障、判断该去哪类服务、把预约准备好等你确认。可以直接告诉我你的情况，比如：',
        'I can do three things: explain your cover, work out which service you need, and prepare a booking for you to confirm. Just tell me what is going on, for example:',
        {
          zh: ['我喉咙痛、有点低烧，想看医生', '急诊和 GP 有什么区别？', '最近压力很大'],
          en: [
            'I have a sore throat and a low fever',
            'What is the difference between emergency and a GP?',
            'I have been really stressed lately',
          ],
        },
      );
    }
  }
}
