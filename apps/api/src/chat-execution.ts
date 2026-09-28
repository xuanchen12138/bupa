import type {
  ChatEvent,
  ChatRequest,
  ProviderSearch,
  SourceRef,
  WizardFieldValue,
} from '@bupa/contracts';
import { runDemoAgent, type AgentTools } from './agent.js';
import { canUse, fail, id, type BackendContext } from './domain.js';
import { requestConsent, resolveConsent, waitConsent } from './permissions.js';
import { createDraft, getDraft, prefillDraft, abandonDraft } from './booking.js';
import { findProviders, getCover } from './providers.js';
import { isSensitiveText, type LanguageModel } from './models.js';
import type { PersonalizationService } from './personalization.js';
import { detectSafety } from './safety.js';

export async function executeChat(
  ctx: BackendContext,
  request: ChatRequest,
  model: LanguageModel | null,
  health: PersonalizationService,
  conversationId: string | null,
  emit: (event: ChatEvent, refs: SourceRef[]) => Promise<void>,
  signal: AbortSignal,
  ensureActive: () => void = () => signal.throwIfAborted(),
) {
  const { store } = ctx;
  const consents = new Set<string>();
  let context = {
    context: { messages: [] } as { messages: { role: 'user' | 'assistant'; content: string }[] },
    refs: [] as SourceRef[],
  };
  let lastSearch: { filters: ProviderSearch; postcodeValue: string; languageValue: string } | null =
    null;
  const guard = () => {
    signal.throwIfAborted();
    ensureActive();
    if (ctx.session.status === 'closed' || ctx.session.expiresAt <= store.clock().getTime())
      fail(409, 'SESSION_EXPIRED', 'The authorization session expired.');
  };
  const send = async (event: ChatEvent) => {
    guard();
    await emit(event, context.refs);
    guard();
  };
  const checkSearch = (fields: Record<string, WizardFieldValue>) => {
    guard();
    if (!fields.providerId && !fields.slotId) return;
    if (!lastSearch)
      fail(409, 'SEARCH_REQUIRED', 'Refresh provider options before prefilling a selection.');
    const { filters, postcodeValue, languageValue } = lastSearch;
    if (
      (filters.postcode &&
        (!canUse(ctx, 'postcode') ||
          store.profile.member.fields.postcode.value !== postcodeValue)) ||
      (filters.language &&
        (!canUse(ctx, 'preferredLanguage') ||
          store.profile.member.fields.preferredLanguage.value !== languageValue))
    )
      fail(
        409,
        'STALE_RECOMMENDATION',
        'Permission or profile changed. Request fresh recommendations.',
      );
  };
  const ownDraft = (draftId: string) => {
    guard();
    const draft = getDraft(ctx, draftId);
    if ((draft.conversationId ?? null) !== conversationId)
      fail(404, 'DRAFT_NOT_FOUND', 'Draft does not belong to this conversation.');
    return draft;
  };
  const tools: AgentTools = {
    sessionId: ctx.session.id,
    isAllowed: (field) => canUse(ctx, field),
    wasDenied: (field) => ctx.session.denied.has(field),
    getPreferences: () => ({
      postcode: canUse(ctx, 'postcode') ? store.profile.member.fields.postcode.value : null,
      language: canUse(ctx, 'preferredLanguage')
        ? store.profile.member.fields.preferredLanguage.value
        : null,
      interpreter: canUse(ctx, 'interpreter')
        ? ['yes', 'true'].includes(store.profile.member.fields.interpreter.value)
        : null,
    }),
    getCover: (service) => {
      guard();
      return getCover(ctx, service);
    },
    requestConsent: (fields, options) => {
      guard();
      const request = requestConsent(ctx, fields, options);
      consents.add(request.id);
      return request;
    },
    waitConsent: async (consentId, abort) => {
      ctx.session.status = 'awaiting_consent';
      try {
        return await waitConsent(ctx, consentId, abort);
      } finally {
        if (!signal.aborted) ctx.session.status = 'running';
      }
    },
    createDraft: (prefill) => {
      checkSearch(prefill);
      if (conversationId && health.repo.settings(store.ownerId).enabled) {
        const origin = health.repo.conversation(store.ownerId, conversationId).originSuggestionId;
        const suggestion = health.repo.states(store.ownerId).find((item) => item.id === origin);
        const source = suggestion?.sourceRefs.at(-1);
        if (source && health.repo.sourcesExist(store.ownerId, [source])) {
          const entry = health.repo.entry(store.ownerId, source.conversationId, source.messageId);
          if (entry.kind === 'user')
            prefill = {
              ...prefill,
              need:
                'GP consultation / GP 咨询 — ' +
                entry.text.slice(0, 1000) +
                ' (reported / 报告于 ' +
                source.reportedAt.slice(0, 10) +
                ')',
            };
        }
      }
      const draft = createDraft(ctx, {});
      const stored = store.schedule.drafts.find((item) => item.id === draft.id)!;
      stored.conversationId = conversationId;
      store.draftSources.set(
        draft.id,
        context.refs.map((ref) => ref.messageId),
      );
      try {
        const result = prefillDraft(ctx, draft.id, prefill).draft;
        if (conversationId) {
          const conversation = health.repo.conversation(store.ownerId, conversationId);
          health.repo.updateConversation(store.ownerId, {
            ...conversation,
            activeDraftId: draft.id,
          });
        }
        return result;
      } catch (error) {
        abandonDraft(ctx, draft.id);
        throw error;
      }
    },
    getDraft: ownDraft,
    prefillDraft: (draftId, fields) => {
      ownDraft(draftId);
      checkSearch(fields);
      store.draftSources.set(
        draftId,
        context.refs.map((ref) => ref.messageId),
      );
      return prefillDraft(ctx, draftId, fields);
    },
    findProviders: (search) => {
      guard();
      const result = findProviders(ctx, search);
      lastSearch = {
        filters: search,
        postcodeValue: store.profile.member.fields.postcode.value,
        languageValue: store.profile.member.fields.preferredLanguage.value,
      };
      return result;
    },
    receiptEvents: (consentId) =>
      store.receipts.filter((receipt) =>
        (store.consentReceipts.get(consentId) ?? []).includes(receipt.id),
      ),
    setActiveDraft: (draftId) => {
      guard();
      ctx.session.activeDraftId = draftId;
    },
    getActiveDraft: () => {
      const active = conversationId
        ? health.repo.conversation(store.ownerId, conversationId).activeDraftId
        : ctx.session.activeDraftId;
      const draft = store.schedule.drafts.find((item) => item.id === active);
      return draft?.status === 'draft' &&
        store.draftSessions.get(draft.id) === ctx.session.id &&
        (draft.conversationId ?? null) === conversationId
        ? draft.id
        : null;
    },
  };
  try {
    guard();
    const safety = detectSafety(
      request.message,
      /[\u3400-\u9fff]/u.test(request.message) ? 'zh' : request.uiLocale,
    );
    if (safety) {
      await send(safety);
      return;
    }
    if (model && isSensitiveText(request.message) && !canUse(ctx, 'mentalHealthNeed')) {
      const pending = tools.requestConsent(['mentalHealthNeed'], { sensitive: true });
      pending.purpose =
        'Process this sensitive request using OpenAI and prepare requested support / 使用 OpenAI 处理本次敏感请求并准备你请求的支持';
      if (conversationId)
        pending.retention =
          'Permission lasts for this session; saved conversation remains until you delete it / 授权仅本次，保存的对话保留至你删除';
      await send({ type: 'consent_request', request: pending });
      const decision = await tools.waitConsent(pending.id, signal);
      await send({ type: 'consent_resolved', requestId: pending.id });
      for (const receipt of tools.receiptEvents(pending.id))
        await send({ type: 'receipt', receipt });
      if (decision === 'deny' || !canUse(ctx, 'mentalHealthNeed')) {
        await send({
          type: 'message',
          id: id('message'),
          text:
            request.uiLocale === 'zh'
              ? '已停止这项敏感需求的模型处理。你仍可通过官方渠道寻求支持。'
              : 'Model processing of this sensitive request has stopped. You can still contact official support directly.',
          translation: null,
          suggestions: [],
        });
        return;
      }
    }
    context = health.context(ctx, conversationId);
    if (!model) {
      await runDemoAgent(request, tools, send, signal);
      return;
    }
    const results: string[] = [];
    const thinkingId = id('tool');
    await send({
      type: 'tool_status',
      id: thinkingId,
      tool: 'openai',
      status: 'running',
      label: request.uiLocale === 'zh' ? '正在理解你的请求' : 'Understanding your request',
    });
    const plan = await model.plan(request.message, context.context, signal);
    guard();
    // Narrow executor has no submit/cancel/navigation tool, irrespective of model output.
    await runDemoAgent(
      request,
      tools,
      async (event) => {
        if (event.type === 'message') results.push(event.text);
        else await send(event);
      },
      signal,
      { mode: 'openai', plan: () => plan },
    );
    guard();
    const reply = await model.reply(request.message, context.context, results, signal);
    guard();
    await send({
      type: 'tool_status',
      id: thinkingId,
      tool: 'openai',
      status: 'done',
      label: request.uiLocale === 'zh' ? '回复已准备好' : 'Reply ready',
    });
    const lang = /[\u3400-\u9fff]/u.test(request.message) ? 'zh' : request.uiLocale;
    await send({
      type: 'message',
      id: id('message'),
      text: reply[lang],
      translation: reply[lang === 'zh' ? 'en' : 'zh'],
      suggestions: [],
    });
  } finally {
    for (const consentId of consents)
      if (store.consents.get(consentId)?.status === 'pending')
        resolveConsent(ctx, consentId, 'deny');
    health.repo.saveBusiness(store);
  }
}
