import assert from 'node:assert/strict';
import test from 'node:test';
import * as contracts from '@bupa/contracts';
import {
  DEMO_ARM_DAYS_AGO,
  DEMO_ARM_USER_MESSAGE_ID,
  DEMO_CONVERSATION_ID,
  demoConversationSeed,
} from '@bupa/contracts/fixtures';
import { z } from 'zod';

// A separate M0 readiness gate, not a claim that history HTTP routes exist.
// Consumes the FE exports observed on 2026-09-28 (CONTRACT_VERSION 0.3.0).
// Passing shapes does not freeze unresolved business protocols or enable routes.
// Samples are protocol test vectors, never a second DTO/schema or runtime seed.
const requiredExports = [
  'SourceRefSchema',
  'ConversationSchema',
  'ConversationTurnRequestSchema',
  'ConversationEntrySchema',
  'HealthFactSchema',
  'HealthSuggestionSchema',
  'HealthOverviewResponseSchema',
  'ConversationStreamEventSchema',
  'CreateConversationRequestSchema',
  'ConversationListResponseSchema',
  'ConversationMessagesResponseSchema',
  'DeleteConversationResponseSchema',
  'CancelTurnResponseSchema',
  'PersonalizationSettingsSchema',
  'PersonalizationPatchSchema',
  'HealthOverviewRefreshResponseSchema',
  'DismissSuggestionRequestSchema',
  'StartSuggestionRequestSchema',
  'StartSuggestionResponseSchema',
] as const;
const published: Record<string, unknown> = contracts;
const reportedAt = '2026-09-14T00:00:00.000Z';
const generatedAt = '2026-09-28T00:00:00.000Z';
const source = { conversationId: 'conversation-1', messageId: 'user-1', reportedAt };
const localized = { en: 'User-reported arm injury', zh: '用户自述手臂受伤' };
const conversation = {
  id: source.conversationId,
  title: 'Arm injury',
  createdAt: reportedAt,
  updatedAt: reportedAt,
  activeDraftId: null,
  originSuggestionId: null,
  latestTurn: { id: 'turn-1', status: 'completed' },
};
const turnRequest = {
  clientMessageId: 'client-1',
  message: 'I injured my arm and it feels serious.',
  uiLocale: 'en',
  openDraftId: null,
  originSuggestionId: null,
};
const baseEntry = {
  id: source.messageId,
  conversationId: source.conversationId,
  turnId: 'turn-1',
  order: 0,
  createdAt: reportedAt,
};
const fact = {
  id: 'fact-1',
  topicKey: 'reported-arm-event-1',
  title: localized,
  summary: localized,
  evidenceType: 'user_reported',
  state: 'unknown',
  firstReportedAt: reportedAt,
  lastReportedAt: reportedAt,
  occurredAt: { value: null, precision: 'unknown' },
  sources: [source],
};
const suggestion = {
  id: 'suggestion-1',
  dedupeKey: 'reported-arm-event-1:prepare_gp_booking',
  factIds: [fact.id],
  sourceRefs: [source],
  title: { en: 'Prepare a GP consultation', zh: '准备 GP 咨询' },
  body: { en: 'Would you like to arrange a consultation?', zh: '是否希望安排咨询？' },
  reason: { en: 'No more recent recovery update.', zh: '尚无较新的恢复情况更新。' },
  action: 'prepare_gp_booking',
  state: 'available',
  followUpConversationId: null,
  bookingId: null,
};
const overview = {
  status: 'ready',
  sourceRevision: 1,
  snapshotRevision: 1,
  generatedAt,
  generationMode: 'fixture',
  dataMode: 'fictional',
  summary: localized,
  facts: [fact],
  suggestions: [suggestion],
  error: null,
};

test('shared history schemas preserve the backend HTTP/SSE protocol', () => {
  const missing = requiredExports.filter((name) => !(published[name] instanceof z.ZodType));
  assert.deepEqual(
    missing,
    [],
    `M0 NOT READY (@bupa/contracts ${contracts.CONTRACT_VERSION}): missing shared Zod exports: ${missing.join(', ')}. FE owns contracts; see docs/backend-personalization-status.md.`,
  );

  function schema(name: (typeof requiredExports)[number]): z.ZodType {
    const value = published[name];
    assert.ok(value instanceof z.ZodType, name);
    return value;
  }

  // Round-trip checks catch schemas that accept an object but silently strip
  // ownership, source, revision or idempotency metadata from their output.
  function preserves(name: (typeof requiredExports)[number], sample: unknown) {
    const parsed = schema(name).safeParse(sample);
    assert.ok(parsed.success, `${name}: protocol sample rejected`);
    assert.partialDeepStrictEqual(
      parsed.data,
      sample,
      `${name}: required protocol fields were changed`,
    );
  }

  preserves('SourceRefSchema', source);
  preserves('ConversationSchema', conversation);
  preserves('ConversationSchema', { ...conversation, latestTurn: null });
  preserves('ConversationTurnRequestSchema', turnRequest);
  preserves('ConversationTurnRequestSchema', {
    ...turnRequest,
    uiLocale: 'zh',
    originSuggestionId: suggestion.id,
  });

  const kinds = [
    {
      kind: 'user',
      text: turnRequest.message,
      clientMessageId: turnRequest.clientMessageId,
      origin: 'user_input',
      sourceRefs: [],
    },
    {
      kind: 'user',
      text: 'Prepare a GP consultation',
      clientMessageId: 'suggestion-message-1',
      origin: 'suggestion_action',
      sourceRefs: [source],
    },
    { kind: 'assistant', text: 'Reply', translation: null, suggestions: [], sourceRefs: [source] },
    ...['running', 'done', 'blocked', 'interrupted'].map((status) => ({
      kind: 'tool',
      tool: 'get_cover',
      label: 'Read cover',
      status,
    })),
    ...['pending', 'granted', 'denied', 'expired'].map((status) => ({
      kind: 'consent',
      consentId: 'consent-1',
      dataLabel: 'Preferred language',
      purpose: 'Booking',
      benefit: 'Find a suitable consultation language',
      status,
    })),
    { kind: 'receipt', receiptId: 'receipt-1' },
    { kind: 'wizard', draftId: 'draft-1', mode: 'open', changed: [] },
    { kind: 'wizard', draftId: 'draft-1', mode: 'update', changed: ['language'] },
    { kind: 'booking', bookingId: 'booking-1' },
    {
      kind: 'safety',
      message: 'Historical safety message',
      resources: [{ label: 'Help', value: '000' }],
    },
    { kind: 'handoff', summary: 'Unsent demo handoff', ticket: null },
    { kind: 'error', message: 'Please retry', retryable: true },
  ];
  for (const [index, entry] of kinds.entries()) {
    preserves('ConversationEntrySchema', { ...baseEntry, id: `entry-${index}`, ...entry });
  }
  preserves('ConversationEntrySchema', {
    ...baseEntry,
    turnId: null,
    kind: 'booking',
    bookingId: 'booking-1',
  });
  for (const state of ['unknown', 'reported_ongoing', 'reported_improving', 'reported_resolved']) {
    preserves('HealthFactSchema', { ...fact, state });
  }
  for (const state of ['available', 'dismissed', 'in_progress', 'booked', 'cancelled']) {
    preserves('HealthSuggestionSchema', {
      ...suggestion,
      state,
      followUpConversationId: ['in_progress', 'booked', 'cancelled'].includes(state)
        ? 'followup-1'
        : null,
      bookingId: ['booked', 'cancelled'].includes(state) ? 'booking-1' : null,
    });
  }
  preserves('HealthSuggestionSchema', { ...suggestion, action: 'update_status' });
  preserves('HealthOverviewResponseSchema', overview);
  for (const status of ['disabled', 'empty', 'pending', 'error']) {
    preserves('HealthOverviewResponseSchema', {
      ...overview,
      status,
      generatedAt: null,
      summary: null,
      facts: [],
      suggestions: [],
      error: status === 'error' ? { code: 'GENERATION_FAILED', message: 'Please retry' } : null,
    });
  }
  preserves('HealthOverviewResponseSchema', { ...overview, generationMode: 'model' });

  preserves('CreateConversationRequestSchema', { requestId: 'create-1' });
  preserves('ConversationListResponseSchema', { items: [conversation], nextCursor: null });
  preserves('ConversationMessagesResponseSchema', {
    conversation,
    items: [{ ...baseEntry, ...kinds[0] }],
    nextCursor: 'opaque-order-boundary',
  });
  preserves('DeleteConversationResponseSchema', {
    deletedId: conversation.id,
    sourceRevision: 2,
    snapshotRevision: 2,
  });
  preserves('CancelTurnResponseSchema', { turnId: 'turn-1', status: 'interrupted' });
  preserves('PersonalizationSettingsSchema', {
    enabled: false,
    updatedAt: generatedAt,
    sourceRevision: 2,
    receiptId: null,
  });
  preserves('PersonalizationPatchSchema', { enabled: true });
  for (const status of ['queued', 'up_to_date', 'disabled']) {
    preserves('HealthOverviewRefreshResponseSchema', { status, sourceRevision: 2 });
  }
  preserves('DismissSuggestionRequestSchema', { expectedSnapshotRevision: 2 });
  preserves('StartSuggestionRequestSchema', { requestId: 'start-1', expectedSnapshotRevision: 2 });
  preserves('StartSuggestionResponseSchema', {
    conversationId: 'followup-1',
    initialMessage: localized,
    clientMessageId: 'start-message-1',
    originSuggestionId: suggestion.id,
  });

  const legacyMessage = {
    type: 'message',
    id: 'assistant-1',
    text: 'Reply',
    translation: null,
    suggestions: [],
  };
  contracts.ChatRequestSchema.parse({
    sessionId: 'legacy-label',
    message: turnRequest.message,
    uiLocale: turnRequest.uiLocale,
    openDraftId: turnRequest.openDraftId,
  });
  contracts.ChatEventSchema.parse(legacyMessage);
  const envelope = {
    conversationId: source.conversationId,
    turnId: 'turn-1',
    eventIndex: 0,
    at: reportedAt,
    entryId: source.messageId,
    payload: {
      type: 'turn_accepted',
      userMessageId: source.messageId,
      clientMessageId: 'client-1',
    },
  };
  preserves('ConversationStreamEventSchema', envelope);
  preserves('ConversationStreamEventSchema', {
    ...envelope,
    eventIndex: 1,
    entryId: 'assistant-1',
    payload: legacyMessage,
  });
  preserves('ConversationStreamEventSchema', {
    ...envelope,
    eventIndex: 2,
    entryId: null,
    payload: { type: 'done' },
  });
  assert.equal(
    contracts.ChatEventSchema.safeParse(envelope).success,
    false,
    'Legacy /chat stays unwrapped',
  );

  for (const field of ['conversationId', 'turnId', 'eventIndex', 'at']) {
    assert.equal(
      schema('ConversationStreamEventSchema').safeParse({ ...envelope, [field]: undefined })
        .success,
      false,
      `SSE must require ${field}`,
    );
  }
  assert.equal(
    schema('ConversationTurnRequestSchema').safeParse({
      ...turnRequest,
      clientMessageId: undefined,
    }).success,
    false,
    'Turns require a deduplication key',
  );
  assert.equal(
    schema('SourceRefSchema').safeParse({ ...source, reportedAt: 'not-a-date' }).success,
    false,
    'Source time must be ISO',
  );
  assert.equal(
    schema('HealthFactSchema').safeParse({ ...fact, sources: [] }).success,
    false,
    'Facts require at least one source',
  );
  assert.equal(
    schema('ConversationStreamEventSchema').safeParse({ ...envelope, eventIndex: -1 }).success,
    false,
    'Event index cannot be negative',
  );
});

test('shared arm fixture provides stable bilingual history and a user-message source', () => {
  const demoNow = new Date('2026-09-28T12:00:00+10:00');
  const originalClock = demoNow.toISOString();
  const expectedDay = new Date(demoNow);
  expectedDay.setDate(expectedDay.getDate() - 14);
  assert.equal(DEMO_ARM_DAYS_AGO, 14);
  for (const locale of ['en', 'zh'] as const) {
    const seed = demoConversationSeed(demoNow, locale);
    const persistedConversation = contracts.ConversationSchema.parse(seed.conversation);
    const entries = seed.entries.map((entry) => contracts.ConversationEntrySchema.parse(entry));
    assert.equal(persistedConversation.id, DEMO_CONVERSATION_ID);
    assert.equal(persistedConversation.activeDraftId, null);
    assert.equal(persistedConversation.latestTurn?.status, 'completed');
    assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
    assert.deepEqual(
      entries.map((entry) => entry.order),
      [0, 1],
    );
    assert.ok(entries.every((entry) => entry.conversationId === persistedConversation.id));
    const user = entries.find((entry) => entry.id === DEMO_ARM_USER_MESSAGE_ID);
    assert.ok(user?.kind === 'user');
    assert.equal(user.origin, 'user_input');
    assert.equal(
      user.text,
      locale === 'en'
        ? 'I injured my arm and it feels serious.'
        : '我的胳膊受伤了，我觉得伤得很严重。',
    );
    const when = new Date(user.createdAt);
    assert.deepEqual(
      [when.getFullYear(), when.getMonth(), when.getDate()],
      [expectedDay.getFullYear(), expectedDay.getMonth(), expectedDay.getDate()],
      'The user message is fourteen local calendar days before the saved demo clock',
    );
    contracts.SourceRefSchema.parse({
      conversationId: persistedConversation.id,
      messageId: user.id,
      reportedAt: user.createdAt,
    });
    assert.deepEqual(
      demoConversationSeed(demoNow, locale),
      seed,
      'The same saved clock yields stable history',
    );
  }
  assert.equal(demoNow.toISOString(), originalClock, 'Fixture must not mutate the saved clock');
});
