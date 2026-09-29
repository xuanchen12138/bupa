import { z } from 'zod';
import { ChatEventSchema, ProviderOptionsSchema } from './core.js';

/**
 * Persisted conversations (0.3.0).
 *
 * A conversation is a long-lived record owned by the member. It is different from the cookie
 * session (short-lived permissions, drafts, running requests) and from the member id (who may
 * read or delete). Servers attach the owner themselves; clients never send it.
 */

/** Points at the user message a health fact or derived prompt was taken from. */
export const SourceRefSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  /** When the user said it (the message time), not when a report was generated. */
  reportedAt: z.iso.datetime({ offset: true }),
});

export const TurnStatusSchema = z.enum(['running', 'completed', 'interrupted', 'failed']);

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** Unsubmitted booking draft prepared in this conversation, if it still exists. */
  activeDraftId: z.string().nullable().default(null),
  /** Set when the conversation was started from a Dashboard suggestion. */
  originSuggestionId: z.string().nullable().default(null),
  latestTurn: z.object({ id: z.string(), status: TurnStatusSchema }).nullable().default(null),
  /** True for the fictional sample conversation planted by the demo. */
  seeded: z.boolean().default(false),
});

const EntryBase = z.object({
  id: z.string(),
  conversationId: z.string(),
  /** Null for records that did not come from a model turn (e.g. a booking submitted later). */
  turnId: z.string().nullable(),
  /** Stable order inside the conversation. Updating a tool row keeps its order. */
  order: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const UserEntryOriginSchema = z.enum(['user_input', 'suggestion_action']);
export const ToolEntryStatusSchema = z.enum(['running', 'done', 'blocked', 'interrupted']);
export const ConsentEntryStatusSchema = z.enum(['pending', 'granted', 'denied', 'expired']);

export const ConversationEntrySchema = z.discriminatedUnion('kind', [
  EntryBase.extend({
    kind: z.literal('user'),
    text: z.string(),
    clientMessageId: z.string(),
    /** Typed by the user, or generated when they accepted a Dashboard suggestion. */
    origin: UserEntryOriginSchema.default('user_input'),
    /** Health messages a derived prompt refers to; empty for ordinary input. */
    sourceRefs: z.array(SourceRefSchema).default([]),
  }),
  EntryBase.extend({
    kind: z.literal('assistant'),
    text: z.string(),
    translation: z.string().nullable().default(null),
    suggestions: z.array(z.string()).default([]),
    sourceRefs: z.array(SourceRefSchema).default([]),
  }),
  EntryBase.extend({
    kind: z.literal('tool'),
    tool: z.string(),
    label: z.string(),
    status: ToolEntryStatusSchema,
  }),
  EntryBase.extend({
    kind: z.literal('consent'),
    consentId: z.string(),
    /** Short labels only; the full request lives with the consent record. */
    purpose: z.string(),
    dataLabel: z.string().default(''),
    benefit: z.string().default(''),
    sensitive: z.boolean().default(false),
    status: ConsentEntryStatusSchema,
    /** Scope the user chose when they granted it. */
    scope: z.enum(['session', 'days90', 'always']).nullable().default(null),
  }),
  EntryBase.extend({ kind: z.literal('receipt'), receiptId: z.string() }),
  EntryBase.extend({
    kind: z.literal('providers'),
    options: ProviderOptionsSchema,
    /** Set once the member picked one; the draft prepared from that choice. */
    selectedProviderId: z.string().nullable().default(null),
    draftId: z.string().nullable().default(null),
  }),
  EntryBase.extend({
    kind: z.literal('wizard'),
    draftId: z.string(),
    mode: z.enum(['open', 'update']),
    changed: z.array(z.string()).default([]),
  }),
  EntryBase.extend({ kind: z.literal('booking'), bookingId: z.string() }),
  EntryBase.extend({
    kind: z.literal('safety'),
    message: z.string(),
    resources: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  }),
  EntryBase.extend({
    kind: z.literal('handoff'),
    summary: z.string(),
    ticket: z.string().nullable().default(null),
  }),
  EntryBase.extend({
    kind: z.literal('error'),
    message: z.string(),
    retryable: z.boolean().default(false),
  }),
]);

export const CreateConversationRequestSchema = z.object({
  /** Idempotency key: retrying with the same id returns the same conversation. */
  requestId: z.string().min(1),
});

export const ConversationListResponseSchema = z.object({
  items: z.array(ConversationSchema),
  nextCursor: z.string().nullable(),
});

export const ConversationMessagesResponseSchema = z.object({
  conversation: ConversationSchema,
  items: z.array(ConversationEntrySchema),
  nextCursor: z.string().nullable(),
});

export const DeleteConversationResponseSchema = z.object({
  deletedId: z.string(),
  sourceRevision: z.number().int().nonnegative(),
  snapshotRevision: z.number().int().nonnegative(),
});

export const ConversationTurnRequestSchema = z.object({
  /** Unique inside the conversation; the same id retried never creates a second message. */
  clientMessageId: z.string().min(1),
  message: z.string().min(1),
  uiLocale: z.enum(['en', 'zh']).default('en'),
  /** Draft the user has open; it must belong to this conversation to be used. */
  openDraftId: z.string().nullable().default(null),
  /** Suggestion this message was generated from, when the user accepted one. */
  originSuggestionId: z.string().nullable().default(null),
});

export const ChooseProviderRequestSchema = z.object({
  providerId: z.string(),
  slotId: z.string().nullable().default(null),
});

export const CancelTurnResponseSchema = z.object({ turnId: z.string(), status: TurnStatusSchema });

export const TurnAcceptedEventSchema = z.object({
  type: z.literal('turn_accepted'),
  userMessageId: z.string(),
  clientMessageId: z.string(),
});

/** Envelope for every event on a conversation turn stream. `/chat` keeps the bare ChatEvent. */
export const ConversationStreamEventSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  /** Strictly increasing inside the turn; used for de-duplication, separate from entry.order. */
  eventIndex: z.number().int().nonnegative(),
  at: z.iso.datetime({ offset: true }),
  /** Persisted entry this event created or updated; null for pure run signals (done, error). */
  entryId: z.string().nullable(),
  payload: z.union([ChatEventSchema, TurnAcceptedEventSchema]),
});

export const ConversationErrorCodeSchema = z.enum([
  'CONVERSATION_NOT_FOUND',
  'CHAT_BUSY',
  'TURN_NOT_FOUND',
]);

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type TurnStatus = z.infer<typeof TurnStatusSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;
export type ConversationEntryKind = ConversationEntry['kind'];
export type UserEntryOrigin = z.infer<typeof UserEntryOriginSchema>;
export type ToolEntryStatus = z.infer<typeof ToolEntryStatusSchema>;
export type ConsentEntryStatus = z.infer<typeof ConsentEntryStatusSchema>;
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;
export type ConversationMessagesResponse = z.infer<typeof ConversationMessagesResponseSchema>;
export type DeleteConversationResponse = z.infer<typeof DeleteConversationResponseSchema>;
export type ConversationTurnRequest = z.infer<typeof ConversationTurnRequestSchema>;
export type CancelTurnResponse = z.infer<typeof CancelTurnResponseSchema>;
export type ChooseProviderRequest = z.infer<typeof ChooseProviderRequestSchema>;
export type TurnAcceptedEvent = z.infer<typeof TurnAcceptedEventSchema>;
export type ConversationStreamEvent = z.infer<typeof ConversationStreamEventSchema>;
export type ConversationErrorCode = z.infer<typeof ConversationErrorCodeSchema>;
