import { z } from 'zod';

// Core shared contracts for web, api and the demo fixtures.
// 0.3.0 adds persisted conversations and health personalisation (see conversations.ts and
// personalization.ts). Every 0.2.0 shape below is kept; new fields default so old callers parse.
// Use matching fixtures and update consumers together when changing these schemas.
export const CONTRACT_VERSION = '0.3.0';

/** Text that the UI can show in either interface language. */
export const LocalizedTextSchema = z.object({ en: z.string(), zh: z.string() });
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export const PermissionSchema = z.enum(['off', 'session', 'always']);
export const ServiceTypeSchema = z.enum([
  'gp',
  'dental',
  'mental_health',
  'telehealth',
  'emergency',
  'hospital',
]);
export const FieldSourceSchema = z.enum(['conversation', 'profile', 'cover', 'user']);
export const ProfileFieldNameSchema = z.enum([
  'name',
  'dateOfBirth',
  'memberNumber',
  'phone',
  'email',
  'address',
  'emergencyContact',
  'postcode',
  'preferredLanguage',
  'interpreter',
  'consultPreference',
  'reminderChannel',
  'needCategory',
]);
export const ProfileFieldSchema = z.object({
  value: z.string(),
  permission: PermissionSchema,
  // A session grant must eventually be checked against the active session, not just the enum.
  sessionId: z.string().nullable(),
});
export const MemberSchema = z.object({
  id: z.string(),
  product: z.literal('OSHC'),
  productName: z.string().default('Bupa Overseas Student Health Cover'),
  memberSince: z.iso.date().default('2026-09-07'),
  demo: z.literal(true),
  fields: z.record(ProfileFieldNameSchema, ProfileFieldSchema),
});

export const CostRangeSchema = z
  .object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
    currency: z.literal('AUD'),
  })
  .refine((range) => range.max >= range.min, { message: 'Maximum must be at least minimum' });
export const WaitingPeriodSchema = z.object({
  endsAt: z.iso.date(),
  served: z.boolean(),
});
export const BenefitLimitSchema = z.object({
  used: z.number().nonnegative(),
  total: z.number().positive(),
  currency: z.literal('AUD'),
  resetsAt: z.iso.date(),
});
export const CoverSchema = z.object({
  service: ServiceTypeSchema,
  status: z.enum(['included', 'partial', 'excluded', 'needs_confirmation']),
  outOfPocket: CostRangeSchema.nullable(),
  summary: LocalizedTextSchema.nullable().default(null),
  sourceLabel: z.string(),
  sourceUrl: z.url().nullable(),
  disclaimer: z.string(),
  waitingPeriod: WaitingPeriodSchema.nullable().default(null),
  limit: BenefitLimitSchema.nullable().default(null),
  demo: z.literal(true),
});
export const ProfileResponseSchema = z.object({
  member: MemberSchema,
  covers: z.array(CoverSchema),
});
export const ProfilePatchSchema = z.object({
  fields: z.partialRecord(ProfileFieldNameSchema, z.string()),
});
export const PermissionPatchSchema = z.object({
  field: ProfileFieldNameSchema,
  permission: PermissionSchema,
});

export const SlotSchema = z.object({
  id: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
});
export const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  service: ServiceTypeSchema,
  address: z.string(),
  suburb: z.string(),
  distanceKm: z.number().nonnegative().nullable(),
  languages: z.array(z.string()),
  relationship: z.enum(['bupa_owned', 'partner', 'independent']),
  telehealth: z.boolean().default(false),
  bulkBilling: z.boolean().default(false),
  rating: z.number().min(0).max(5).nullable().default(null),
  reason: LocalizedTextSchema,
  slots: z.array(SlotSchema),
  outOfPocket: CostRangeSchema.nullable(),
  demo: z.literal(true),
});
export const ProviderSearchSchema = z.object({
  service: ServiceTypeSchema,
  postcode: z.string().nullable(),
  language: z.string().nullable(),
  telehealthOnly: z.boolean().default(false),
});
export const ProviderSearchResultSchema = z.object({
  providers: z.array(ProviderSchema),
  rankingNote: LocalizedTextSchema,
});

export const WizardFieldValueSchema = z.union([z.string(), z.boolean(), z.number(), z.null()]);
export const WizardFieldSchema = z.object({
  value: WizardFieldValueSchema,
  source: FieldSourceSchema,
  confirmed: z.boolean(),
});
export const WizardDraftSchema = z.object({
  id: z.string(),
  type: z.literal('booking'),
  step: z.number().int().min(1).max(5),
  fields: z.record(z.string(), WizardFieldSchema),
  status: z.enum(['draft', 'submitted', 'abandoned']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** Booking id being rescheduled, when the draft was opened from an existing booking. */
  rescheduleOf: z.string().nullable().default(null),
  /**
   * Conversation the draft was prepared from, so the booking result lands in that conversation
   * even if the user is looking at another one when they submit. Null or absent for drafts
   * started from the Dashboard. Optional so 0.2.0 producers still type-check.
   */
  conversationId: z.string().nullable().optional(),
});
export const WizardPatchSchema = z.object({
  step: z.number().int().min(1).max(5).optional(),
  fields: z.record(z.string(), WizardFieldValueSchema).optional(),
});
export const ProviderSummarySchema = ProviderSchema.pick({
  id: true,
  name: true,
  address: true,
  suburb: true,
  relationship: true,
  telehealth: true,
  languages: true,
});
export const BookingSchema = z.object({
  id: z.string(),
  draftId: z.string(),
  providerId: z.string(),
  provider: ProviderSummarySchema,
  slot: SlotSchema,
  service: ServiceTypeSchema,
  need: z.string(),
  patientName: z.string(),
  interpreter: z.boolean(),
  language: z.string().nullable(),
  outOfPocket: CostRangeSchema.nullable(),
  whatToBring: z.array(z.string()),
  status: z.enum(['confirmed', 'cancelled']),
  createdAt: z.iso.datetime({ offset: true }),
  demo: z.literal(true),
});
export const ReminderSchema = z.object({
  id: z.string(),
  bookingId: z.string().nullable(),
  text: z.string(),
  at: z.iso.datetime({ offset: true }),
  enabled: z.boolean(),
  createdBy: z.enum(['ai', 'user']).default('user'),
});
export const NoteSchema = z.object({
  id: z.string(),
  bookingId: z.string().nullable(),
  text: z.string(),
  createdBy: z.enum(['ai', 'user']).default('user'),
});
export const ProactiveCardSchema = z.object({
  id: z.string(),
  kind: z.enum(['waiting_period', 'limit_reset', 'checkup']),
  title: LocalizedTextSchema,
  body: LocalizedTextSchema,
  dueAt: z.iso.date(),
  prompt: LocalizedTextSchema,
  dismissed: z.boolean().default(false),
});
export const ScheduleSchema = z.object({
  bookings: z.array(BookingSchema),
  reminders: z.array(ReminderSchema),
  notes: z.array(NoteSchema),
  drafts: z.array(WizardDraftSchema),
  cards: z.array(ProactiveCardSchema).default([]),
});

export const ConsentScopeSchema = z.enum(['session', 'always']);
export const ConsentDecisionSchema = z.enum(['session', 'always', 'deny']);
export const ConsentRequestSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  /** Profile field names, or a free-form key for sensitive categories (e.g. "mentalHealthNeed"). */
  fields: z.array(z.string()),
  sensitive: z.boolean().default(false),
  dataLabel: z.string(),
  purpose: z.string(),
  benefit: z.string(),
  excludedUses: z.array(z.string()),
  retention: z.string(),
  /** Scopes the user may pick; sensitive requests default to session only. */
  allowedScopes: z.array(ConsentScopeSchema).default(['session', 'always']),
  /** Wizard field that triggered the request, when raised from a form. */
  wizardFieldId: z.string().nullable().default(null),
  status: z.enum(['pending', 'granted', 'denied']).default('pending'),
});
export const ConsentResponseSchema = z.object({ decision: ConsentDecisionSchema });
export const ReceiptSchema = z.object({
  id: z.string(),
  kind: z.enum(['data', 'action']),
  createdAt: z.iso.datetime({ offset: true }),
  summary: z.string(),
  purpose: z.string(),
  benefit: z.string(),
  excludedUses: z.array(z.string()),
  retention: z.string(),
  scope: z.enum(['session', 'always', 'single_action']),
  status: z.enum(['active', 'revoked', 'completed', 'cancelled']),
  fields: z.array(z.string()).default([]),
  bookingId: z.string().nullable().default(null),
  sensitive: z.boolean().default(false),
});
export const ChatSessionSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  status: z.enum(['idle', 'running', 'awaiting_consent', 'closed']),
  pendingConsentId: z.string().nullable(),
});
export const ChatRequestSchema = z.object({
  sessionId: z.string(),
  message: z.string().min(1),
  /** Interface language; the model still answers in the user's language. */
  uiLocale: z.enum(['en', 'zh']).default('en'),
  openDraftId: z.string().nullable().default(null),
});
export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    id: z.string(),
    text: z.string(),
    /** Optional rendering of the same reply in the other language, for the demo audience. */
    translation: z.string().nullable().default(null),
    suggestions: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal('tool_status'),
    id: z.string(),
    tool: z.string(),
    status: z.enum(['running', 'done', 'blocked']),
    label: z.string(),
  }),
  z.object({ type: z.literal('consent_request'), request: ConsentRequestSchema }),
  z.object({ type: z.literal('consent_resolved'), requestId: z.string() }),
  z.object({ type: z.literal('wizard_open'), draft: WizardDraftSchema }),
  z.object({
    type: z.literal('wizard_prefill'),
    draft: WizardDraftSchema,
    changed: z.array(z.string()).default([]),
  }),
  z.object({ type: z.literal('action_done'), booking: BookingSchema }),
  z.object({ type: z.literal('receipt'), receipt: ReceiptSchema }),
  z.object({
    type: z.literal('safety_alert'),
    message: z.string(),
    resources: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  }),
  z.object({ type: z.literal('handoff'), summary: z.string(), ticket: z.string().nullable() }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('my-bupa-agent-api'),
  mode: z.literal('demo'),
  contractVersion: z.string(),
});
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Whether the same request may succeed if retried unchanged. */
    retryable: z.boolean().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export type Permission = z.infer<typeof PermissionSchema>;
export type ServiceType = z.infer<typeof ServiceTypeSchema>;
export type FieldSource = z.infer<typeof FieldSourceSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type ProfileFieldName = z.infer<typeof ProfileFieldNameSchema>;
export type ProfileField = z.infer<typeof ProfileFieldSchema>;
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;
export type PermissionPatch = z.infer<typeof PermissionPatchSchema>;
export type CostRange = z.infer<typeof CostRangeSchema>;
export type Cover = z.infer<typeof CoverSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type ProviderSummary = z.infer<typeof ProviderSummarySchema>;
export type ProviderSearch = z.infer<typeof ProviderSearchSchema>;
export type ProviderSearchResult = z.infer<typeof ProviderSearchResultSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type WizardFieldValue = z.infer<typeof WizardFieldValueSchema>;
export type WizardField = z.infer<typeof WizardFieldSchema>;
export type WizardDraft = z.infer<typeof WizardDraftSchema>;
export type WizardPatch = z.infer<typeof WizardPatchSchema>;
export type Booking = z.infer<typeof BookingSchema>;
export type Reminder = z.infer<typeof ReminderSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type ProactiveCard = z.infer<typeof ProactiveCardSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type ConsentScope = z.infer<typeof ConsentScopeSchema>;
export type ConsentDecision = z.infer<typeof ConsentDecisionSchema>;
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;
export type ConsentResponse = z.infer<typeof ConsentResponseSchema>;
export type ChatSession = z.infer<typeof ChatSessionSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatEvent = z.infer<typeof ChatEventSchema>;
