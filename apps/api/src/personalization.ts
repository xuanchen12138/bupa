import { createHash } from 'node:crypto';
import {
  HealthFactSchema,
  ReceiptSchema,
  type HealthFact,
  type HealthSuggestion,
  type SourceRef,
  type ConversationTurnRequest,
  type StartSuggestionRequest,
  type StartSuggestionResponse,
} from '@bupa/contracts';
import { Repository, emptyOverview } from './repository.js';
import {
  ExtractionSchema,
  isSensitiveText,
  ModelError,
  type EvidenceMessage,
  type LanguageModel,
  type ModelContext,
} from './models.js';
import { canUse, fail, id, DomainError, type BackendContext } from './domain.js';
import type { DemoStore } from './store.js';
import { detectSafety } from './safety.js';

const refOf = (message: EvidenceMessage): SourceRef => ({
  conversationId: message.conversationId,
  messageId: message.id,
  reportedAt: message.reportedAt,
});
const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
export class PersonalizationService {
  private jobs = new Map<
    string,
    { revision: number; controller: AbortController; promise: Promise<void> }
  >();
  constructor(
    readonly repo: Repository,
    readonly model: LanguageModel | null,
    readonly maxInputChars = 60000,
  ) {}
  stop(owner: string) {
    this.jobs.get(owner)?.controller.abort();
    this.jobs.delete(owner);
  }
  async idle(owner: string) {
    await this.jobs.get(owner)?.promise;
  }
  private sources(owner: string): EvidenceMessage[] {
    return this.repo.allEntries(owner).flatMap((entry) =>
      entry.kind === 'user' &&
      entry.origin === 'user_input' &&
      entry.text &&
      !isSensitiveText(entry.text)
        ? [
            {
              id: entry.id,
              conversationId: entry.conversationId,
              text: entry.text,
              reportedAt: entry.createdAt,
            },
          ]
        : [],
    );
  }
  context(
    ctx: BackendContext,
    conversationId: string | null,
  ): { context: ModelContext; refs: SourceRef[] } {
    if (!conversationId) return { context: { messages: [] }, refs: [] };
    const owner = ctx.store.ownerId;
    const settings = this.repo.settings(owner);
    const messages: ModelContext['messages'] = [];
    const refs = new Map<string, SourceRef>();
    for (const entry of this.repo.allEntries(owner, conversationId)) {
      if (entry.kind !== 'user' && entry.kind !== 'assistant') continue;
      if (!entry.text || (isSensitiveText(entry.text) && !canUse(ctx, 'mentalHealthNeed')))
        continue;
      if (!this.repo.sourcesExist(owner, entry.sourceRefs)) continue;
      if (
        !canUse(ctx, 'mentalHealthNeed') &&
        entry.sourceRefs.some((ref) => {
          const source = this.repo.entry(owner, ref.conversationId, ref.messageId);
          return source.kind === 'user' && isSensitiveText(source.text);
        })
      )
        continue;
      if (
        !settings.enabled &&
        entry.sourceRefs.some((ref) => ref.conversationId !== conversationId)
      )
        continue;
      messages.push({ role: entry.kind, content: `[Reported ${entry.createdAt}] ${entry.text}` });
      if (entry.kind === 'user' && entry.origin === 'user_input')
        refs.set(entry.id, { conversationId, messageId: entry.id, reportedAt: entry.createdAt });
      for (const ref of entry.sourceRefs) refs.set(ref.messageId, ref);
    }
    if (settings.enabled) {
      // Reports are invalidated before a new turn. Retrieve authorized source conversations
      // independently, including their later corrections, rather than reusing a stale summary.
      const currentText = this.repo
        .allEntries(owner, conversationId)
        .filter((entry) => entry.kind === 'user')
        .at(-1);
      const query = currentText?.kind === 'user' ? currentText.text.toLowerCase() : '';
      const terms = query.match(/[a-z]{3,}|[\u3400-\u9fff]{2}/gu) ?? [];
      const candidates = this.sources(owner).filter(
        (message) => message.conversationId !== conversationId,
      );
      const groups = new Map<string, { score: number; at: string }>();
      for (const message of candidates) {
        const score = terms.filter((term) => message.text.toLowerCase().includes(term)).length;
        const prior = groups.get(message.conversationId);
        groups.set(message.conversationId, {
          score: Math.max(prior?.score ?? 0, score),
          at: prior && prior.at > message.reportedAt ? prior.at : message.reportedAt,
        });
      }
      const chosen = new Set(
        [...groups]
          .sort((a, b) => b[1].score - a[1].score || b[1].at.localeCompare(a[1].at))
          .slice(0, 3)
          .map(([conversation]) => conversation),
      );
      for (const ref of candidates
        .filter((message) => chosen.has(message.conversationId))
        .map(refOf)) {
        if (
          ref.conversationId === conversationId ||
          refs.has(ref.messageId) ||
          !this.repo.sourcesExist(owner, [ref])
        )
          continue;
        const entry = this.repo.entry(owner, ref.conversationId, ref.messageId);
        if (entry.kind === 'user' && !isSensitiveText(entry.text)) {
          refs.set(entry.id, ref);
          messages.push({
            role: 'user',
            content: `[Authorized historical report ${entry.createdAt}] ${entry.text}`,
          });
        }
      }
      const conversation = this.repo.conversation(owner, conversationId);
      const suggestion = this.repo
        .states(owner)
        .find((item) => item.id === conversation.originSuggestionId);
      for (const ref of suggestion?.sourceRefs ?? []) {
        if (refs.has(ref.messageId) || !this.repo.sourcesExist(owner, [ref])) continue;
        const entry = this.repo.entry(owner, ref.conversationId, ref.messageId);
        if (entry.kind === 'user' && !isSensitiveText(entry.text)) {
          refs.set(entry.id, ref);
          messages.push({
            role: 'user',
            content: `[User-selected historical source ${entry.createdAt}] ${entry.text}`,
          });
        }
      }
    }
    if (JSON.stringify(messages).length > this.maxInputChars)
      fail(
        413,
        'CONTEXT_LIMIT',
        'This conversation exceeds the configured context limit. Start a new conversation.',
      );
    return { context: { messages }, refs: [...refs.values()] };
  }
  setEnabled(ctx: BackendContext, enabled: boolean) {
    const { store } = ctx;
    const owner = store.ownerId;
    return this.repo.atomic(store, () => {
      const settings = this.repo.settings(owner);
      if (settings.enabled === enabled) return settings;
      this.stop(owner);
      this.repo.interruptOwner(owner);
      for (const session of store.sessions.values()) session.activeChat?.abort();
      const at = store.clock().toISOString();
      if (settings.receiptId) {
        const old = store.receipts.find((receipt) => receipt.id === settings.receiptId);
        if (old) old.status = 'revoked';
      }
      const receiptId = enabled ? id('receipt') : null;
      if (receiptId)
        store.receipts.push(
          ReceiptSchema.parse({
            id: receiptId,
            kind: 'data',
            createdAt: at,
            summary: 'Conversation personalization enabled / 已开启对话个性化',
            dataLabel: 'Conversation personalization / 对话个性化',
            purpose: 'Use saved conversations to organize user-reported concerns and suggestions',
            benefit: 'Source-linked health overview',
            excludedUses: [
              'No diagnosis, pricing, marketing or automated booking',
              'Mental-health history excluded from persistent personalization',
            ],
            retention: 'Until disabled, source deletion, or demo reset',
            scope: 'always',
            status: 'active',
            fields: ['personalization'],
            bookingId: null,
            sensitive: true,
          }),
        );
      this.repo.writeSettings(owner, {
        ...settings,
        enabled,
        updatedAt: at,
        receiptId,
        presetByDemo: false,
      });
      if (!enabled) {
        this.repo.clearPersonalization(owner);
        for (const entry of this.repo.allEntries(owner)) {
          if (entry.kind !== 'user' && entry.kind !== 'assistant') continue;
          if (!entry.sourceRefs.some((ref) => ref.conversationId !== entry.conversationId))
            continue;
          this.repo.writeEntry(
            owner,
            entry.kind === 'assistant'
              ? { ...entry, text: '', translation: null, suggestions: [], sourceRefs: [] }
              : { ...entry, text: '', sourceRefs: [] },
          );
        }
        for (const draft of store.schedule.drafts) {
          if (
            draft.status !== 'draft' ||
            !(store.draftSources.get(draft.id) ?? []).some((sourceId) =>
              this.repo
                .allEntries(owner)
                .some(
                  (entry) => entry.id === sourceId && entry.conversationId !== draft.conversationId,
                ),
            )
          )
            continue;
          for (const [field, value] of Object.entries(draft.fields))
            if (value.source === 'conversation') delete draft.fields[field];
          store.draftProgress.set(draft.id, 1);
          store.draftSources.delete(draft.id);
        }
      }
      this.repo.invalidate(owner);
      return this.repo.settings(owner);
    });
  }
  refresh(store: DemoStore) {
    const owner = store.ownerId;
    const settings = this.repo.settings(owner);
    if (!settings.enabled)
      return { status: 'disabled' as const, sourceRevision: settings.sourceRevision };
    const report = this.repo.overview(owner);
    if (
      ['ready', 'empty'].includes(report.status) &&
      report.sourceRevision === settings.sourceRevision
    )
      return { status: 'up_to_date' as const, sourceRevision: settings.sourceRevision };
    if (this.jobs.get(owner)?.revision === settings.sourceRevision)
      return { status: 'queued' as const, sourceRevision: settings.sourceRevision };
    this.stop(owner);
    const controller = new AbortController();
    const revision = settings.sourceRevision;
    this.repo.writeOverview(owner, { ...report, status: 'pending', error: null });
    this.repo.db
      .prepare(
        "INSERT INTO generation_jobs VALUES(?,?,'running') ON CONFLICT(owner_id) DO UPDATE SET source_revision=excluded.source_revision,status='running'",
      )
      .run(owner, revision);
    const promise = Promise.resolve().then(async () => {
      try {
        const messages = this.sources(owner);
        if (JSON.stringify(messages).length > this.maxInputChars)
          throw new ModelError('CONTEXT_LIMIT');
        let facts: HealthFact[] = [];
        if (messages.length) {
          if (!this.model) throw new ModelError('MODEL_DISABLED');
          const extracted = ExtractionSchema.parse(
            await this.model.extract(messages, controller.signal),
          );
          const byId = new Map(messages.map((message) => [message.id, message]));
          const validateEvidence = (evidence: { messageId: string; quote: string }) => {
            const source = byId.get(evidence.messageId);
            if (!source || !normalize(source.text).includes(normalize(evidence.quote)))
              throw new ModelError('INVALID_EVIDENCE');
            return source;
          };
          const usedAnchors = new Set<string>();
          for (const candidate of extracted.facts) {
            if (!candidate.asserted || candidate.subject !== 'self') continue;
            const evidence = candidate.evidence
              .map(validateEvidence)
              .sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
            const anchor = byId.get(candidate.anchorMessageId);
            const anchorKey = candidate.anchorMessageId + ':' + normalize(candidate.anchorQuote);
            if (
              !anchor?.text.includes(candidate.anchorQuote) ||
              !evidence.some((source) => source.id === candidate.anchorMessageId) ||
              usedAnchors.has(anchorKey)
            )
              throw new ModelError('INVALID_EVIDENCE');
            usedAnchors.add(anchorKey);
            const occurredAt = candidate.occurredAt;
            if (occurredAt.precision !== 'unknown') {
              if (
                !candidate.occurrenceEvidence ||
                !occurredAt.value ||
                !Number.isFinite(Date.parse(occurredAt.value))
              )
                throw new ModelError('INVALID_EVIDENCE');
              const occurrenceSource = validateEvidence(candidate.occurrenceEvidence);
              if (!evidence.some((source) => source.id === occurrenceSource.id))
                evidence.push(occurrenceSource);
            } else if (occurredAt.value !== null || candidate.occurrenceEvidence !== null)
              throw new ModelError('INVALID_EVIDENCE');
            const excerpts = candidate.evidence.map((item) => `“${item.quote}”`).join(' / ');
            const topic = createHash('sha256').update(anchorKey).digest('hex').slice(0, 24);
            facts.push(
              HealthFactSchema.parse({
                id: `fact-${topic}`,
                topicKey: topic,
                title: { en: 'Self-reported concern', zh: '你自述的健康事项' },
                summary: { en: `You reported: ${excerpts}`, zh: `你曾报告：${excerpts}` },
                evidenceType: 'user_reported',
                state: candidate.state,
                firstReportedAt: evidence[0]!.reportedAt,
                lastReportedAt: evidence.at(-1)!.reportedAt,
                occurredAt,
                sources: [
                  ...new Map(evidence.map((source) => [source.id, refOf(source)])).values(),
                ],
              }),
            );
          }
        }
        controller.signal.throwIfAborted();
        this.repo.transaction(() => {
          if (
            !this.repo.settings(owner).enabled ||
            this.repo.settings(owner).sourceRevision !== revision ||
            !this.repo.sourcesExist(
              owner,
              facts.flatMap((fact) => fact.sources),
            )
          )
            return;
          const current = this.repo.overview(owner);
          const states = new Map(
            this.repo.states(owner).map((suggestion) => [suggestion.dedupeKey, suggestion]),
          );
          facts = facts
            .sort(
              (a, b) =>
                Number(a.state === 'reported_resolved') - Number(b.state === 'reported_resolved') ||
                b.lastReportedAt.localeCompare(a.lastReportedAt),
            )
            .slice(0, 3);
          const latestInput = this.repo
            .allEntries(owner)
            .filter((entry) => entry.kind === 'user' && entry.origin === 'user_input')
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.order - a.order)[0];
          const urgent = latestInput?.kind === 'user' && !!detectSafety(latestInput.text);
          const suggestions: HealthSuggestion[] = [];
          for (const fact of facts) {
            if (fact.state === 'reported_resolved' || urgent) continue;
            for (const action of ['update_status', 'prepare_gp_booking'] as const) {
              const key = `${fact.topicKey}:${action}`;
              const prior = states.get(key);
              const suggestion: HealthSuggestion = {
                id: `suggestion-${key}`,
                dedupeKey: key,
                factIds: [fact.id],
                sourceRefs: fact.sources,
                title:
                  action === 'update_status'
                    ? { en: 'Update how you are feeling', zh: '更新最近的情况' }
                    : { en: 'Prepare a GP consultation', zh: '准备 GP 咨询' },
                body:
                  action === 'update_status'
                    ? {
                        en: 'Tell us your current status in the original conversation.',
                        zh: '在原对话中补充你目前的情况。',
                      }
                    : {
                        en: 'Would you like help preparing a GP appointment for you to review?',
                        zh: '是否希望准备一次 GP 预约，由你检查并提交？',
                      },
                reason: {
                  en: `Based on your report from ${fact.lastReportedAt.slice(0, 10)}; recovery has not been confirmed by you.`,
                  zh: `基于你在 ${fact.lastReportedAt.slice(0, 10)} 的自述；目前没有你已恢复的明确更新。`,
                },
                action,
                state: prior?.state ?? 'available',
                followUpConversationId: prior?.followUpConversationId ?? null,
                bookingId: prior?.bookingId ?? null,
              };
              this.repo.saveSuggestion(owner, suggestion);
              suggestions.push(suggestion);
            }
          }
          this.repo.writeOverview(owner, {
            ...emptyOverview(this.model?.mode ?? 'scripted'),
            status: facts.length ? 'ready' : 'empty',
            sourceRevision: revision,
            snapshotRevision: current.snapshotRevision + 1,
            generatedAt: store.clock().toISOString(),
            summary: facts.length
              ? {
                  en: 'Your self-reported concerns, with their original sources.',
                  zh: '根据你自己的描述整理，保留原始来源；不代表医学判断。',
                }
              : null,
            facts,
            suggestions: suggestions.slice(0, 3),
          });
          this.repo.db
            .prepare(
              "UPDATE generation_jobs SET status='completed' WHERE owner_id=? AND source_revision=?",
            )
            .run(owner, revision);
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          this.repo.settings(owner).sourceRevision !== revision ||
          !this.repo.settings(owner).enabled
        )
          return;
        const current = this.repo.overview(owner);
        this.repo.writeOverview(owner, {
          ...emptyOverview(this.model?.mode ?? 'scripted'),
          status: 'error',
          sourceRevision: revision,
          snapshotRevision: current.snapshotRevision + 1,
          error: {
            code: error instanceof ModelError ? error.code : 'GENERATION_FAILED',
            message:
              'The overview could not be generated. Your history and manual booking remain available.',
          },
        });
        this.repo.db
          .prepare(
            "UPDATE generation_jobs SET status='failed' WHERE owner_id=? AND source_revision=?",
          )
          .run(owner, revision);
      } finally {
        if (this.jobs.get(owner)?.controller === controller) this.jobs.delete(owner);
      }
    });
    this.jobs.set(owner, { controller, revision, promise });
    return { status: 'queued' as const, sourceRevision: revision };
  }
  private suggestion(owner: string, suggestionId: string, expected?: number) {
    const settings = this.repo.settings(owner);
    if (!settings.enabled)
      fail(409, 'PERSONALIZATION_DISABLED', 'Enable personalization to use this suggestion.');
    const report = this.repo.overview(owner);
    if (expected !== undefined && report.snapshotRevision !== expected)
      fail(409, 'STALE_SUGGESTION', 'Refresh the overview before using this suggestion.');
    const suggestion = this.repo.states(owner).find((item) => item.id === suggestionId);
    if (!suggestion || !report.suggestions.some((item) => item.id === suggestionId))
      fail(404, 'SUGGESTION_NOT_FOUND', 'Suggestion is no longer available.');
    if (!this.repo.sourcesExist(owner, suggestion.sourceRefs))
      fail(409, 'SOURCE_REMOVED', 'The source is no longer available.');
    return suggestion;
  }
  private publishState(owner: string, suggestion: HealthSuggestion) {
    this.repo.saveSuggestion(owner, suggestion);
    const report = this.repo.overview(owner);
    const updated = {
      ...report,
      snapshotRevision: report.snapshotRevision + 1,
      suggestions: report.suggestions.map((item) =>
        item.id === suggestion.id ? suggestion : item,
      ),
    };
    this.repo.writeOverview(owner, updated);
    return updated;
  }
  dismiss(owner: string, suggestionId: string, expected: number) {
    return this.repo.transaction(() => {
      const suggestion = this.suggestion(owner, suggestionId, expected);
      return this.publishState(owner, { ...suggestion, state: 'dismissed' });
    });
  }
  start(
    store: DemoStore,
    suggestionId: string,
    request: StartSuggestionRequest,
  ): StartSuggestionResponse {
    const owner = store.ownerId;
    return this.repo.transaction(() => {
      const cached = this.repo.command<StartSuggestionResponse>(
        owner,
        `suggestion:${suggestionId}`,
        request.requestId,
      );
      if (cached) {
        this.suggestion(owner, suggestionId);
        this.repo.conversation(owner, cached.conversationId);
        return cached;
      }
      const suggestion = this.suggestion(owner, suggestionId, request.expectedSnapshotRevision);
      if (
        suggestion.action !== 'prepare_gp_booking' ||
        ['dismissed', 'booked'].includes(suggestion.state)
      )
        fail(409, 'STALE_SUGGESTION', 'This action is no longer available.');
      let conversationId = suggestion.followUpConversationId;
      if (conversationId) {
        try {
          this.repo.conversation(owner, conversationId);
        } catch {
          conversationId = null;
        }
      }
      if (!conversationId)
        conversationId = this.repo.createConversation(
          owner,
          `suggestion:${suggestionId}:${request.requestId}`,
          store.clock().toISOString(),
          suggestion.id,
        ).id;
      const existing = this.repo.db
        .prepare(
          'SELECT result FROM commands WHERE owner_id=? AND kind=? ORDER BY rowid DESC LIMIT 1',
        )
        .get(owner, `suggestion:${suggestionId}`);
      const previous = existing
        ? (JSON.parse(String(existing.result)) as StartSuggestionResponse)
        : null;
      const result = {
        conversationId,
        initialMessage: this.repo.initialSuggestionMessage(),
        clientMessageId:
          suggestion.state === 'in_progress' && previous?.conversationId === conversationId
            ? previous.clientMessageId
            : id('client-message'),
        originSuggestionId: suggestionId,
      };
      this.repo.saveCommand(owner, `suggestion:${suggestionId}`, request.requestId, result);
      this.publishState(owner, {
        ...suggestion,
        state: 'in_progress',
        followUpConversationId: conversationId,
        bookingId: null,
      });
      return result;
    });
  }
  requestSources(
    owner: string,
    conversationId: string,
    request: ConversationTurnRequest,
  ): SourceRef[] {
    if (!request.originSuggestionId) return [];
    const suggestion = this.suggestion(owner, request.originSuggestionId);
    const found = this.repo.db
      .prepare('SELECT result FROM commands WHERE owner_id=? AND kind=?')
      .all(owner, `suggestion:${suggestion.id}`)
      .some((row) => {
        const value = JSON.parse(String(row.result)) as StartSuggestionResponse;
        return (
          value.conversationId === conversationId &&
          value.clientMessageId === request.clientMessageId &&
          Object.values(value.initialMessage).includes(request.message)
        );
      });
    if (!found || suggestion.followUpConversationId !== conversationId)
      fail(409, 'STALE_SUGGESTION', 'Start the suggestion before sending its message.');
    return suggestion.sourceRefs;
  }
  bookingChanged(store: DemoStore, bookingId: string) {
    const owner = store.ownerId;
    const booking = store.schedule.bookings.find((item) => item.id === bookingId);
    if (!booking) return;
    const submission = store.submissions.get(booking.draftId);
    const replacedBooking = store.schedule.drafts.find(
      (draft) => draft.id === booking.draftId,
    )?.rescheduleOf;
    if (submission?.conversationId) {
      try {
        const conversation = this.repo.conversation(owner, submission.conversationId);
        if (
          !this.repo
            .allEntries(owner, conversation.id)
            .some((entry) => entry.kind === 'booking' && entry.bookingId === bookingId)
        ) {
          this.repo.writeEntry(owner, {
            id: id('entry'),
            conversationId: conversation.id,
            turnId: null,
            order: this.repo.nextOrder(owner, conversation.id),
            createdAt: store.clock().toISOString(),
            kind: 'booking',
            bookingId,
          });
          this.repo.updateConversation(owner, { ...conversation, activeDraftId: null });
        }
      } catch (error) {
        if (!(error instanceof DomainError && error.code === 'CONVERSATION_NOT_FOUND')) throw error;
      }
    }
    for (const suggestion of this.repo.states(owner)) {
      if (suggestion.action !== 'prepare_gp_booking') continue;
      if (
        suggestion.bookingId === bookingId ||
        (booking.status === 'confirmed' &&
          replacedBooking &&
          suggestion.bookingId === replacedBooking) ||
        (booking.status === 'confirmed' &&
          suggestion.followUpConversationId &&
          suggestion.followUpConversationId === submission?.conversationId &&
          suggestion.state === 'in_progress')
      ) {
        this.publishState(owner, {
          ...suggestion,
          state: booking.status === 'confirmed' ? 'booked' : 'cancelled',
          bookingId,
        });
      }
    }
  }
}
