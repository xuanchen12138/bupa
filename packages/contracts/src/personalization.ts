import { z } from 'zod';
import { LocalizedTextSchema } from './core.js';
import { SourceRefSchema } from './conversations.js';

/**
 * Health overview and personalised suggestions (0.3.0).
 *
 * Everything here is an organised restatement of what the member said in their own
 * conversations. It is never a diagnosis, a medical record, a score or an inferred condition.
 * Facts must point at user messages that still exist and are allowed to be used.
 */

export const HealthFactStateSchema = z.enum([
  'unknown',
  'reported_ongoing',
  'reported_improving',
  'reported_resolved',
]);

export const HealthFactSchema = z.object({
  id: z.string(),
  /** Stable topic key. Two injuries to the same body part are not merged on the key alone. */
  topicKey: z.string(),
  title: LocalizedTextSchema,
  summary: LocalizedTextSchema,
  evidenceType: z.literal('user_reported'),
  state: HealthFactStateSchema,
  firstReportedAt: z.iso.datetime({ offset: true }),
  lastReportedAt: z.iso.datetime({ offset: true }),
  /** When the thing happened, as far as the user said; never inferred from message dates. */
  occurredAt: z.object({
    value: z.iso.datetime({ offset: true }).nullable(),
    precision: z.enum(['day', 'approximate', 'unknown']),
  }),
  /** At least one still-existing, permitted user message. */
  sources: z.array(SourceRefSchema).min(1),
});

export const HealthSuggestionActionSchema = z.enum(['update_status', 'prepare_gp_booking']);
export const HealthSuggestionStateSchema = z.enum([
  'available',
  'dismissed',
  'in_progress',
  'booked',
  'cancelled',
]);

export const HealthSuggestionSchema = z.object({
  id: z.string(),
  /** Same topic + action always yields the same key, so regenerated copy cannot undo a dismiss. */
  dedupeKey: z.string(),
  factIds: z.array(z.string()),
  sourceRefs: z.array(SourceRefSchema),
  title: LocalizedTextSchema,
  body: LocalizedTextSchema,
  reason: LocalizedTextSchema,
  action: HealthSuggestionActionSchema,
  state: HealthSuggestionStateSchema,
  followUpConversationId: z.string().nullable().default(null),
  bookingId: z.string().nullable().default(null),
});

export const HealthOverviewStatusSchema = z.enum([
  'disabled',
  'empty',
  'pending',
  'ready',
  'error',
]);

export const HealthOverviewResponseSchema = z.object({
  status: HealthOverviewStatusSchema,
  /** Bumped when source messages are added or removed, or personalisation changes. */
  sourceRevision: z.number().int().nonnegative(),
  /** Bumped when the published overview or a suggestion's display state changes. */
  snapshotRevision: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime({ offset: true }).nullable(),
  /** How the overview was produced. `fixture` and `scripted` are demo modes. */
  generationMode: z.enum(['fixture', 'scripted', 'model']),
  /** Whether the underlying member data is fictional demo data or a real member's. */
  dataMode: z.enum(['fictional', 'member']),
  summary: LocalizedTextSchema.nullable(),
  facts: z.array(HealthFactSchema),
  suggestions: z.array(HealthSuggestionSchema),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

export const PersonalizationSettingsSchema = z.object({
  enabled: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
  sourceRevision: z.number().int().nonnegative(),
  /** Purpose receipt created when the member switched personalisation on. */
  receiptId: z.string().nullable(),
  /** Demo builds may pre-enable the setting; the UI must say so. */
  presetByDemo: z.boolean().default(false),
});

export const PersonalizationPatchSchema = z.object({ enabled: z.boolean() });

export const HealthOverviewRefreshResponseSchema = z.object({
  status: z.enum(['queued', 'up_to_date', 'disabled']),
  sourceRevision: z.number().int().nonnegative(),
});

export const DismissSuggestionRequestSchema = z.object({
  expectedSnapshotRevision: z.number().int().nonnegative(),
});

export const StartSuggestionRequestSchema = z.object({
  /** Idempotency key for double clicks and network retries. */
  requestId: z.string().min(1),
  expectedSnapshotRevision: z.number().int().nonnegative(),
});

export const StartSuggestionResponseSchema = z.object({
  conversationId: z.string(),
  /** The follow-up request the client sends as a user-chosen message, in both languages. */
  initialMessage: LocalizedTextSchema,
  /** Reuse this id when sending, so retries never create a second message. */
  clientMessageId: z.string(),
  originSuggestionId: z.string(),
});

export const PersonalizationErrorCodeSchema = z.enum([
  'PERSONALIZATION_DISABLED',
  'SOURCE_REMOVED',
  'STALE_SUGGESTION',
  'SUGGESTION_NOT_FOUND',
  'GENERATION_FAILED',
]);

export type HealthFactState = z.infer<typeof HealthFactStateSchema>;
export type HealthFact = z.infer<typeof HealthFactSchema>;
export type HealthSuggestionAction = z.infer<typeof HealthSuggestionActionSchema>;
export type HealthSuggestionState = z.infer<typeof HealthSuggestionStateSchema>;
export type HealthSuggestion = z.infer<typeof HealthSuggestionSchema>;
export type HealthOverviewStatus = z.infer<typeof HealthOverviewStatusSchema>;
export type HealthOverviewResponse = z.infer<typeof HealthOverviewResponseSchema>;
export type PersonalizationSettings = z.infer<typeof PersonalizationSettingsSchema>;
export type PersonalizationPatch = z.infer<typeof PersonalizationPatchSchema>;
export type HealthOverviewRefreshResponse = z.infer<typeof HealthOverviewRefreshResponseSchema>;
export type DismissSuggestionRequest = z.infer<typeof DismissSuggestionRequestSchema>;
export type StartSuggestionRequest = z.infer<typeof StartSuggestionRequestSchema>;
export type StartSuggestionResponse = z.infer<typeof StartSuggestionResponseSchema>;
export type PersonalizationErrorCode = z.infer<typeof PersonalizationErrorCodeSchema>;
