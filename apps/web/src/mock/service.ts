import { z } from 'zod';
import {
  CONTRACT_VERSION,
  ConsentRequestSchema,
  ConversationEntrySchema,
  ConversationSchema,
  HealthFactSchema,
  ProfileResponseSchema,
  ReceiptSchema,
  ScheduleSchema,
  StartSuggestionResponseSchema,
  type Booking,
  type CancelTurnResponse,
  type ChatEvent,
  type ConsentDecision,
  type ConsentRequest,
  type Conversation,
  type ConversationEntry,
  type ConversationListResponse,
  type ConversationMessagesResponse,
  type ConversationStreamEvent,
  type ConversationTurnRequest,
  type Cover,
  type DeleteConversationResponse,
  type DismissSuggestionRequest,
  type FieldSource,
  type HealthOverviewRefreshResponse,
  type HealthOverviewResponse,
  type Note,
  type PermissionPatch,
  type PersonalizationPatch,
  type PreferredTime,
  type PersonalizationSettings,
  type ProfileFieldName,
  type ProfilePatch,
  type Provider,
  type ProviderSearch,
  type ProviderSearchResult,
  type Receipt,
  type Reminder,
  type ServiceType,
  type StartSuggestionRequest,
  type StartSuggestionResponse,
  type WizardDraft,
  type WizardFieldValue,
  type WizardPatch,
} from '@bupa/contracts';
import {
  demoCards,
  demoConversationSeed,
  demoProfile,
  demoProviders,
  emptySchedule,
  toOffsetIso,
} from '@bupa/contracts/fixtures';
import { bookingWizard, type WizardFieldDefinition } from '@bupa/contracts/wizard';
import { ApiError, ValidationError } from '../lib/errors.ts';
import {
  buildOverview,
  factsFromHistory,
  sourceConversationIds,
  type SuggestionRecord,
} from './health-overview.ts';
import * as history from './history-repository.ts';
import {
  IndexedDbSnapshotStore,
  MemorySnapshotStore,
  SNAPSHOT_VERSION,
  SnapshotWriter,
  type PersistenceStatus,
  type SnapshotStore,
} from './persistence.ts';
import { detectLang, runScript, type Lang, type ScriptContext } from './script.ts';

/**
 * In-browser stand-in for apps/api. Same contracts, same rules:
 * - the model (script) can only prefill wizard fields; only submitDraft() creates a booking;
 * - a tool that needs data waits for consent; declining still leaves a path forward;
 * - every grant and every action leaves a receipt that can be withdrawn;
 * - conversations, bookings, receipts and personalisation state persist in the browser
 *   (IndexedDB) as one versioned snapshot; runtime objects never do.
 *
 * Three ids, never mixed: the member (always the fictional Lin here), the short-lived session
 * (temporary permissions, drafts, running turns; 30 min idle), and the conversation (kept until
 * the member deletes it).
 */

export type Locale = 'en' | 'zh';

const SESSION_TTL_MS = 30 * 60_000;
const DAYS_90_MS = 90 * 86_400_000;
/** Preferences the member set in the product; private until shared for a purpose. */
export const PREFERENCE_FIELDS: ProfileFieldName[] = [
  'preferredTime',
  'travelDuration',
  'preferredLanguage',
  'consultPreference',
  'interpreter',
];

/** ISO 8601 with local offset and full second precision (fixtures' helper rounds to minutes). */
function isoWithOffset(date: Date) {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
const clone = <T>(value: T): T => structuredClone(value);

/* --------------------------------------------------------------- state */
const SuggestionRecordSchema = z.object({
  dedupeKey: z.string(),
  dismissedAt: z.string().nullable(),
  followUpConversationId: z.string().nullable(),
  bookingId: z.string().nullable(),
  startCount: z.number().int().nonnegative(),
});

const PersistedStateSchema = z.object({
  demo: z.object({
    seededAt: z.string(),
    /** Anchor for the sample conversation; fixed at first initialisation. */
    demoNow: z.string(),
    seedLocale: z.enum(['en', 'zh']),
  }),
  session: z.object({ id: z.string(), lastActiveAt: z.string() }),
  profile: ProfileResponseSchema,
  schedule: ScheduleSchema,
  receipts: z.array(ReceiptSchema),
  consents: z.record(z.string(), ConsentRequestSchema),
  sensitiveGrants: z.array(z.string()),
  history: z.object({
    conversations: z.record(z.string(), ConversationSchema),
    entries: z.record(z.string(), z.array(ConversationEntrySchema)),
    createRequests: z.record(z.string(), z.string()),
    tombstones: z.array(z.string()),
  }),
  personalization: z.object({
    enabled: z.boolean(),
    updatedAt: z.string().nullable(),
    sourceRevision: z.number().int().nonnegative(),
    snapshotRevision: z.number().int().nonnegative(),
    receiptId: z.string().nullable(),
    presetByDemo: z.boolean(),
    records: z.record(z.string(), SuggestionRecordSchema),
    cache: z
      .object({
        sourceRevision: z.number().int().nonnegative(),
        generatedAt: z.string(),
        facts: z.array(HealthFactSchema),
      })
      .nullable(),
    startRequests: z.record(z.string(), StartSuggestionResponseSchema),
  }),
});
export type PersistedState = z.infer<typeof PersistedStateSchema>;

export interface InitError {
  kind: 'corrupt' | 'unavailable';
  message: string;
}

interface RunningTurn {
  turnId: string;
  controller: AbortController;
  /** Consent waiters opened by this turn, rejected when the turn stops. */
  consentIds: Set<string>;
}

const TEXT = {
  whatToBring: {
    zh: '护照或学生证 · Bupa 会员卡（App 内）· 症状开始的时间 · 正在吃的药',
    en: 'Passport or student ID · Bupa member card (in the app) · When symptoms started · Any medication you take',
  },
  personalizationReceipt: {
    zh: {
      summary: '健康历史用于个性化概览与建议',
      purpose: '从你自己在对话中说过的健康情况整理概览，并提出与之相关的下一步',
      benefit: 'Dashboard 顶部的健康概览、有来源的建议、和一次由你确认的预约准备',
      excluded: ['定价或续保', '理赔审核', '营销', '不做诊断或风险评分'],
      retention: '直到你关闭此设置或删除来源对话；概览随之删除',
    },
    en: {
      summary: 'Health history used for your overview and suggestions',
      purpose:
        'Organise what you told us about your health in conversations and suggest related next steps',
      benefit:
        'A health overview at the top of your Dashboard, suggestions with their source, and bookings prepared for you to confirm',
      excluded: [
        'Pricing or renewal',
        'Claims assessment',
        'Marketing',
        'No diagnosis or risk scoring',
      ],
      retention:
        'Until you switch this off or delete the source conversation; the overview goes with it',
    },
  },
  followUpMessage: {
    zh: '我想和 GP 确认一下之前提到的手臂受伤的恢复情况，请帮我准备一次预约。',
    en: 'I would like to check the arm injury I mentioned earlier with a GP. Please prepare a booking for me to confirm.',
  },
  followUpTitle: { zh: '手臂受伤 · GP 预约', en: 'Arm injury · GP booking' },
};

export class MockService {
  private state!: PersistedState;
  private providers: Provider[] = demoProviders();
  private consentWaiters = new Map<
    string,
    { resolve: (decision: ConsentDecision) => void; reject: (error: unknown) => void }
  >();
  private runs = new Map<string, RunningTurn>();
  private listeners = new Set<() => void>();
  private statusListeners = new Set<(status: PersistenceStatus) => void>();
  private readyPromise: Promise<void> | null = null;
  private writer: SnapshotWriter<PersistedState>;
  private store: SnapshotStore<PersistedState>;
  private counter = 0;
  private locale: Locale = 'en';
  private now: () => Date;

  status: PersistenceStatus = { state: 'loading' };
  initError: InitError | null = null;

  constructor(
    options: { store?: SnapshotStore<PersistedState>; now?: () => Date; locale?: Locale } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.locale = options.locale ?? 'en';
    this.store =
      options.store ??
      (IndexedDbSnapshotStore.available()
        ? new IndexedDbSnapshotStore<PersistedState>()
        : new MemorySnapshotStore<PersistedState>());
    this.writer = new SnapshotWriter(this.store, (status) => this.setStatus(status));
  }

  /* ---------------------------------------------------------- lifecycle */
  /** Loads (or seeds) the snapshot. Safe to call many times; work happens once. */
  ready() {
    this.readyPromise ??= this.initialise();
    return this.readyPromise;
  }

  private async initialise() {
    let envelope: Awaited<ReturnType<SnapshotStore<PersistedState>['load']>> = null;
    try {
      envelope = await this.store.load();
    } catch (error) {
      if (this.store.kind === 'indexeddb') {
        // No usable storage: run in memory and say so, rather than pretending to save.
        this.store = new MemorySnapshotStore<PersistedState>();
        this.writer = new SnapshotWriter(this.store, (status) => this.setStatus(status));
        this.initError = {
          kind: 'unavailable',
          message: error instanceof Error ? error.message : 'IndexedDB unavailable',
        };
      }
    }
    if (envelope) {
      if (envelope.version !== SNAPSHOT_VERSION) {
        this.initError = {
          kind: 'corrupt',
          message: `Stored demo data is version ${envelope.version}; this build expects ${SNAPSHOT_VERSION}.`,
        };
      } else {
        const parsed = PersistedStateSchema.safeParse(envelope.data);
        if (parsed.success) {
          this.state = parsed.data;
          this.afterLoad();
          this.setStatus({ state: 'ready', savedAt: envelope.savedAt, store: this.store.kind });
          return;
        }
        this.initError = {
          kind: 'corrupt',
          message: 'Stored demo data could not be read. Reset the demo to start again.',
        };
      }
      // Keep the unreadable snapshot untouched; run on a fresh in-memory seed until reset.
      this.state = this.seed(this.locale);
      this.setStatus({ state: 'corrupt', message: this.initError?.message ?? 'Corrupt snapshot' });
      return;
    }
    this.state = this.seed(this.locale);
    if (this.initError?.kind === 'unavailable') {
      this.setStatus({ state: 'unavailable', message: this.initError.message });
      return;
    }
    await this.persist();
  }

  /** A reload can never resume running work or keep session-only permissions past their TTL. */
  private afterLoad() {
    for (const conversation of Object.values(this.state.history.conversations)) {
      history.interruptOpenWork(this.state.history, conversation.id);
    }
    for (const consent of Object.values(this.state.consents)) {
      if (consent.status === 'pending') consent.status = 'denied';
    }
    const idle = this.now().getTime() - new Date(this.state.session.lastActiveAt).getTime();
    if (idle > SESSION_TTL_MS) this.expireSession();
    this.expireTimedGrants();
    void this.persist();
  }

  /** A 90-day grant that has run out behaves exactly like "off", receipt included. */
  private expireTimedGrants() {
    const now = this.now().getTime();
    for (const [name, field] of Object.entries(this.state.profile.member.fields)) {
      if (field.permission !== 'days90') continue;
      if (field.expiresAt && new Date(field.expiresAt).getTime() > now) continue;
      field.permission = 'off';
      field.expiresAt = null;
      for (const receipt of this.state.receipts) {
        if (
          receipt.kind === 'data' &&
          receipt.status === 'active' &&
          receipt.scope === 'days90' &&
          receipt.fields.includes(name)
        )
          receipt.status = 'revoked';
      }
    }
  }

  private grantUntil(permission: 'session' | 'days90' | 'always') {
    return permission === 'days90'
      ? isoWithOffset(new Date(this.now().getTime() + DAYS_90_MS))
      : null;
  }

  private expireSession() {
    for (const field of Object.values(this.state.profile.member.fields)) {
      if (field.permission === 'session') {
        field.permission = 'off';
        field.sessionId = null;
      }
    }
    for (const receipt of this.state.receipts) {
      if (receipt.kind === 'data' && receipt.status === 'active' && receipt.scope === 'session')
        receipt.status = 'revoked';
    }
    this.state.sensitiveGrants = [];
    for (const draft of this.state.schedule.drafts) {
      const conversation = draft.conversationId
        ? this.state.history.conversations[draft.conversationId]
        : undefined;
      if (conversation?.activeDraftId === draft.id) conversation.activeDraftId = null;
    }
    this.state.schedule.drafts = [];
    this.state.session = { id: this.nextId('session'), lastActiveAt: this.stamp() };
  }

  private seed(locale: Locale): PersistedState {
    const now = this.now();
    const stamp = toOffsetIso(now);
    const hist = history.emptyHistory();
    history.insertSeed(hist, demoConversationSeed(now, locale));
    const receiptId = this.nextId('receipt');
    const copy = TEXT.personalizationReceipt[locale];
    return {
      demo: { seededAt: stamp, demoNow: stamp, seedLocale: locale },
      session: { id: this.nextId('session'), lastActiveAt: stamp },
      profile: clone(demoProfile),
      schedule: { ...clone(emptySchedule), cards: clone(demoCards) },
      receipts: [
        {
          id: receiptId,
          kind: 'data',
          createdAt: stamp,
          summary: copy.summary,
          purpose: copy.purpose,
          benefit: copy.benefit,
          excludedUses: copy.excluded,
          retention: copy.retention,
          scope: 'always',
          status: 'active',
          fields: ['healthHistory'],
          bookingId: null,
          sensitive: true,
        },
      ],
      consents: {},
      sensitiveGrants: [],
      history: hist,
      personalization: {
        // Pre-enabled so judges see the full loop on first open; the UI labels it as a demo preset.
        enabled: true,
        updatedAt: stamp,
        sourceRevision: 1,
        snapshotRevision: 1,
        receiptId,
        presetByDemo: true,
        records: {},
        cache: null,
        startRequests: {},
      },
    };
  }

  /** Current time from the injected clock, so tests and the demo anchor agree. */
  private stamp() {
    return isoWithOffset(this.now());
  }

  private nextId(prefix: string) {
    this.counter += 1;
    return `${prefix}-${this.counter.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  private setStatus(status: PersistenceStatus) {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  /** Subscribe to any state change (used to invalidate queries). */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onPersistence(listener: (status: PersistenceStatus) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  private changed() {
    for (const listener of this.listeners) listener();
  }

  /** Writes the snapshot; failures surface through `status`, never silently. */
  private persist() {
    if (this.initError?.kind === 'corrupt') return Promise.resolve();
    return this.writer.write(clone(this.state));
  }
  retryPersist() {
    return this.writer.retry();
  }
  /** Persist and notify. Every mutation ends here. */
  private commit() {
    const written = this.persist();
    this.changed();
    return written;
  }

  private async begin() {
    await this.ready();
    this.state.session.lastActiveAt = this.stamp();
  }

  setLocale(locale: Locale) {
    this.locale = locale;
  }

  async reset(options: { locale?: Locale } = {}) {
    await this.ready();
    for (const run of this.runs.values()) run.controller.abort();
    this.runs.clear();
    for (const waiter of this.consentWaiters.values())
      waiter.reject(new DOMException('Reset', 'AbortError'));
    this.consentWaiters.clear();
    this.providers = demoProviders();
    this.initError = null;
    try {
      await this.store.clear();
    } catch {
      // A failed clear is reported by the following write.
    }
    this.state = this.seed(options.locale ?? this.locale);
    await this.commit();
  }

  /* --------------------------------------------------------------- reads */
  async health() {
    await this.begin();
    return {
      status: 'ok',
      service: 'my-bupa-agent-api',
      mode: 'demo',
      contractVersion: CONTRACT_VERSION,
    } as const;
  }
  async profile() {
    await this.begin();
    return clone(this.state.profile);
  }
  async schedule() {
    await this.begin();
    return clone(this.state.schedule);
  }
  async receipts() {
    await this.begin();
    return clone(this.state.receipts).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async provider(id: string) {
    await this.begin();
    return this.providers.find((p) => p.id === id) ?? null;
  }
  async findProviders(search: ProviderSearch): Promise<ProviderSearchResult> {
    await this.begin();
    const { providers, personalisedBy } = this.searchProviders(search);
    return {
      providers: clone(providers),
      personalisedBy,
      rankingNote: {
        en: 'Ranked by: language match, then distance, then earliest time. Preferences you have shared narrow the times and the trip; Bupa clinics are shown first only when distance, cost and language are similar.',
        zh: '排序规则：语言匹配 → 距离 → 最早可约时间。你分享的偏好会进一步筛选时段和路程；只有在距离、费用、语言相近时，Bupa 自有服务才会优先显示。',
      },
    };
  }

  /**
   * Applies the member's preferences only where permission allows, and reports which ones
   * were used so the UI and the assistant can say so.
   */
  private searchProviders(search: {
    service: string;
    postcode: string | null;
    language: string | null;
    telehealthOnly?: boolean;
    preferredTime?: PreferredTime | null;
    maxTravelMinutes?: number | null;
  }) {
    const personalisedBy: ProfileFieldName[] = [];
    const fields = this.state.profile.member.fields;
    const language =
      search.language ??
      (this.permissionAllows('preferredLanguage') ? fields.preferredLanguage.value || null : null);
    if (!search.language && language) personalisedBy.push('preferredLanguage');
    let preferredTime = search.preferredTime ?? null;
    if (!preferredTime && this.permissionAllows('preferredTime')) {
      const raw = fields.preferredTime.value;
      if (raw === 'morning' || raw === 'afternoon' || raw === 'evening') preferredTime = raw;
      if (preferredTime) personalisedBy.push('preferredTime');
    }
    let maxTravelMinutes = search.maxTravelMinutes ?? null;
    if (!maxTravelMinutes && this.permissionAllows('travelDuration')) {
      const raw = Number(fields.travelDuration.value);
      if (Number.isFinite(raw) && raw > 0) {
        maxTravelMinutes = raw;
        personalisedBy.push('travelDuration');
      }
    }
    const providers = this.rankProviders(
      search.service,
      search.postcode,
      language,
      search.telehealthOnly ?? false,
      { preferredTime, maxTravelMinutes },
    );
    return { providers, personalisedBy };
  }

  private rankProviders(
    service: string,
    postcode: string | null,
    language: string | null,
    telehealthOnly = false,
    prefs: { preferredTime?: PreferredTime | null; maxTravelMinutes?: number | null } = {},
  ) {
    const wantsTelehealth = service === 'telehealth' || telehealthOnly || !postcode;
    let list = this.providers.filter((p) => {
      if (service === 'mental_health') return p.service === 'mental_health';
      if (p.service === 'mental_health') return false;
      if (service === 'dental') return p.service === 'dental';
      if (wantsTelehealth && !postcode) return p.telehealth;
      return p.service === 'gp' || p.telehealth;
    });
    const preferredTime = prefs.preferredTime ?? null;
    const inWindow = (iso: string) => {
      if (!preferredTime || preferredTime === 'any') return true;
      const hour = new Date(iso).getHours();
      if (preferredTime === 'morning') return hour < 12;
      if (preferredTime === 'afternoon') return hour >= 12 && hour < 17;
      return hour >= 17;
    };
    // Slots the member prefers come first, so "earliest" means "earliest that suits you".
    list = list.map((p) => ({
      ...p,
      slots: [
        ...p.slots.filter((s) => inWindow(s.startsAt)),
        ...p.slots.filter((s) => !inWindow(s.startsAt)),
      ],
    }));
    const score = (p: Provider) =>
      (language && p.languages.includes(language) ? 0 : 10) +
      (p.telehealth ? (wantsTelehealth ? 0 : 2) : (p.distanceKm ?? 5)) +
      (prefs.maxTravelMinutes && p.travelMinutes != null && p.travelMinutes > prefs.maxTravelMinutes
        ? 6
        : 0) +
      (preferredTime && preferredTime !== 'any' && !p.slots.some((s) => inWindow(s.startsAt))
        ? 3
        : 0) +
      (p.relationship === 'bupa_owned' ? -0.1 : 0);
    list = [...list].sort((a, b) => score(a) - score(b));
    if (service === 'telehealth')
      list = [...list.filter((p) => p.telehealth), ...list.filter((p) => !p.telehealth)];
    return list.slice(0, 3);
  }

  /* ------------------------------------------------------------- profile */
  async patchProfile(patch: ProfilePatch) {
    await this.begin();
    for (const [key, value] of Object.entries(patch.fields)) {
      const field = this.state.profile.member.fields[key as ProfileFieldName];
      if (field && typeof value === 'string') field.value = value;
    }
    this.refreshDraftsFromProfile();
    await this.commit();
    return clone(this.state.profile);
  }

  async setPermission({ field, permission }: PermissionPatch) {
    await this.begin();
    const target = this.state.profile.member.fields[field];
    const previous = target.permission;
    target.permission = permission;
    target.sessionId = permission === 'session' ? this.state.session.id : null;
    target.expiresAt = permission === 'off' ? null : this.grantUntil(permission);
    if (permission === 'off') {
      this.clearProfileSourcedFields(field);
      for (const receipt of this.state.receipts) {
        if (
          receipt.kind === 'data' &&
          receipt.status === 'active' &&
          receipt.fields.includes(field)
        )
          receipt.status = 'revoked';
      }
    } else {
      if (previous === 'off') this.pushPermissionReceipt(field, permission);
      this.refreshDraftsFromProfile();
    }
    await this.commit();
    return clone(this.state.profile);
  }

  /** Turning a field on in Profile is a grant too, so it gets a receipt like any other. */
  private pushPermissionReceipt(field: ProfileFieldName, scope: 'session' | 'days90' | 'always') {
    const zh = this.locale === 'zh';
    this.state.receipts.push({
      id: this.nextId('receipt'),
      kind: 'data',
      createdAt: this.stamp(),
      summary: zh ? `在 Profile 中允许 AI 使用：${field}` : `Allowed in Profile: ${field}`,
      purpose: zh
        ? '预填预约向导并个性化推荐'
        : 'Prefill the booking wizard and personalise recommendations',
      benefit: zh
        ? '不必重复输入；推荐更贴近你的情况'
        : 'No retyping; recommendations that fit you',
      excludedUses: zh
        ? ['定价或续保', '理赔审核', '营销']
        : ['Pricing or renewal', 'Claims assessment', 'Marketing'],
      retention: zh
        ? scope === 'session'
          ? '仅本次会话'
          : scope === 'days90'
            ? '90 天，或直到你撤回'
            : '直到你撤回'
        : scope === 'session'
          ? 'This session only'
          : scope === 'days90'
            ? '90 days, or until you withdraw it'
            : 'Until you withdraw it',
      scope,
      status: 'active',
      fields: [field],
      bookingId: null,
      sensitive: false,
    });
  }

  private permissionAllows(field: ProfileFieldName) {
    const entry = this.state.profile.member.fields[field];
    if (entry.permission === 'always') return true;
    if (entry.permission === 'session') return entry.sessionId === this.state.session.id;
    if (entry.permission === 'days90')
      return (
        Boolean(entry.expiresAt) && new Date(entry.expiresAt!).getTime() > this.now().getTime()
      );
    return false;
  }

  /* ------------------------------------------------------------ consents */
  async requestConsent(input: Omit<ConsentRequest, 'id' | 'sessionId' | 'status'>) {
    await this.begin();
    const request = this.createConsent(input);
    await this.commit();
    return clone(request);
  }

  private createConsent(input: Omit<ConsentRequest, 'id' | 'sessionId' | 'status'>) {
    const request: ConsentRequest = {
      ...input,
      id: this.nextId('consent'),
      sessionId: this.state.session.id,
      status: 'pending',
    };
    this.state.consents[request.id] = request;
    return request;
  }

  async respondConsent(id: string, decision: ConsentDecision) {
    await this.begin();
    const request = this.state.consents[id];
    if (!request)
      throw new ApiError('CONSENT_NOT_FOUND', 'Unknown consent request', { status: 404 });
    if (request.sessionId !== this.state.session.id)
      throw new ApiError(
        'CONSENT_EXPIRED',
        'This permission request belongs to an expired session',
        { status: 409 },
      );
    if (request.status !== 'pending') {
      // Idempotent: a second click never creates a second receipt or flips the answer.
      return { request: clone(request) };
    }
    request.status = decision === 'deny' ? 'denied' : 'granted';
    if (decision !== 'deny') {
      for (const field of request.fields) {
        if (this.isProfileField(field)) {
          const entry = this.state.profile.member.fields[field];
          entry.permission = decision;
          entry.sessionId = decision === 'session' ? this.state.session.id : null;
          entry.expiresAt = this.grantUntil(decision);
        } else if (!this.state.sensitiveGrants.includes(field)) {
          this.state.sensitiveGrants.push(field);
        }
      }
      this.state.receipts.push({
        id: this.nextId('receipt'),
        kind: 'data',
        createdAt: this.stamp(),
        summary: request.dataLabel,
        purpose: request.purpose,
        benefit: request.benefit,
        excludedUses: request.excludedUses,
        retention: request.retention,
        scope: decision,
        status: 'active',
        fields: request.fields,
        bookingId: null,
        sensitive: request.sensitive,
      });
      this.refreshDraftsFromProfile();
    }
    await this.commit();
    const waiter = this.consentWaiters.get(id);
    if (waiter) {
      this.consentWaiters.delete(id);
      waiter.resolve(decision);
    }
    return { request: clone(request) };
  }

  async revokeReceipt(id: string) {
    await this.begin();
    const receipt = this.state.receipts.find((r) => r.id === id);
    if (!receipt) throw new ApiError('RECEIPT_NOT_FOUND', 'Unknown receipt', { status: 404 });
    if (receipt.kind !== 'data' || receipt.status !== 'active') return this.receipts();
    receipt.status = 'revoked';
    for (const field of receipt.fields) {
      if (this.isProfileField(field)) {
        const entry = this.state.profile.member.fields[field];
        entry.permission = 'off';
        entry.sessionId = null;
        entry.expiresAt = null;
        this.clearProfileSourcedFields(field);
      } else if (field === 'healthHistory') {
        this.disablePersonalization();
      } else {
        this.state.sensitiveGrants = this.state.sensitiveGrants.filter((f) => f !== field);
      }
    }
    await this.commit();
    return this.receipts();
  }

  private isProfileField(field: string): field is ProfileFieldName {
    return field in this.state.profile.member.fields;
  }

  /* -------------------------------------------------------------- wizard */
  private fieldDefs(): WizardFieldDefinition[] {
    return bookingWizard.fields;
  }

  private coverFor(service: string): Cover | undefined {
    return this.state.profile.covers.find((c) => c.service === service);
  }

  private coverValues(service: string): Record<string, WizardFieldValue> {
    const cover = this.coverFor(service);
    if (!cover)
      return {
        coverStatus: 'needs_confirmation',
        coverOutOfPocket: null,
        coverSource: null,
        coverDisclaimer: null,
      };
    return {
      coverStatus: cover.status,
      coverOutOfPocket: cover.outOfPocket
        ? `${cover.outOfPocket.min}-${cover.outOfPocket.max}`
        : null,
      coverSource: cover.sourceLabel,
      coverDisclaimer: cover.disclaimer,
    };
  }

  private profileValue(def: WizardFieldDefinition): WizardFieldValue {
    if (!def.profileField) return null;
    const raw = this.state.profile.member.fields[def.profileField].value;
    if (def.type === 'boolean') {
      if (def.profileField === 'consultPreference') return raw === 'video' || raw === 'either';
      return raw === 'yes';
    }
    return raw || null;
  }

  private buildDraft(
    prefill: Record<string, WizardFieldValue>,
    sources: Record<string, FieldSource>,
    rescheduleOf: string | null,
    conversationId: string | null,
  ): WizardDraft {
    const service = typeof prefill.serviceType === 'string' ? prefill.serviceType : 'gp';
    const coverValues = this.coverValues(service);
    const fields: WizardDraft['fields'] = {};
    for (const def of this.fieldDefs()) {
      if (def.id in prefill) {
        fields[def.id] = {
          value: prefill[def.id] ?? null,
          source: sources[def.id] ?? 'conversation',
          confirmed: false,
        };
      } else if (def.id in coverValues) {
        fields[def.id] = { value: coverValues[def.id] ?? null, source: 'cover', confirmed: false };
      } else if (def.profileField && this.permissionAllows(def.consent ?? def.profileField)) {
        fields[def.id] = { value: this.profileValue(def), source: 'profile', confirmed: false };
      } else if (def.id === 'whatToBring') {
        fields[def.id] = {
          value: TEXT.whatToBring[this.locale],
          source: 'cover',
          confirmed: false,
        };
      } else if (def.type === 'boolean') {
        fields[def.id] = {
          value: def.id === 'reminder' ? true : false,
          source: 'user',
          confirmed: false,
        };
      } else if (def.id === 'reminderLead') {
        fields[def.id] = { value: '2h', source: 'user', confirmed: false };
      } else {
        fields[def.id] = { value: null, source: 'user', confirmed: false };
      }
    }
    const stamp = this.stamp();
    return {
      id: this.nextId('draft'),
      type: 'booking',
      step: 1,
      fields,
      status: 'draft',
      createdAt: stamp,
      updatedAt: stamp,
      rescheduleOf,
      conversationId,
    };
  }

  async createDraft(
    input: {
      prefill?: Record<string, WizardFieldValue>;
      sources?: Record<string, FieldSource>;
      rescheduleOf?: string | null;
    } = {},
  ) {
    await this.begin();
    let prefill = input.prefill ?? {};
    if (input.rescheduleOf) {
      const booking = this.state.schedule.bookings.find((b) => b.id === input.rescheduleOf);
      if (booking) {
        prefill = {
          serviceType: booking.service,
          need: booking.need,
          providerId: booking.providerId,
          interpreter: booking.interpreter,
          language: booking.language,
          ...prefill,
        };
      }
    }
    const draft = this.buildDraft(prefill, input.sources ?? {}, input.rescheduleOf ?? null, null);
    this.state.schedule.drafts.push(draft);
    await this.commit();
    return clone(draft);
  }

  private findDraft(id: string) {
    const draft = this.state.schedule.drafts.find((d) => d.id === id);
    if (!draft)
      throw new ApiError('DRAFT_NOT_FOUND', 'This booking draft no longer exists or has expired.', {
        status: 404,
      });
    return draft;
  }

  async getDraft(id: string) {
    await this.begin();
    return clone(this.findDraft(id));
  }

  /** User edits: any field, any step. Marks edited fields as confirmed by the user. */
  async patchDraft(id: string, patch: WizardPatch) {
    await this.begin();
    const draft = this.findDraft(id);
    if (patch.fields) {
      for (const [key, value] of Object.entries(patch.fields)) {
        const current = draft.fields[key];
        if (current && current.value === value) {
          current.confirmed = true;
          continue;
        }
        draft.fields[key] = { value: value ?? null, source: 'user', confirmed: true };
        if (key === 'serviceType' && typeof value === 'string') {
          this.applyCover(draft, value);
          this.clearSelection(draft);
        }
        if (key === 'postcode' || key === 'acceptTelehealth') this.clearSelection(draft);
        if (key === 'providerId')
          draft.fields.slotId = { value: null, source: 'user', confirmed: false };
      }
    }
    if (patch.step) {
      const missing = this.validateStep(draft, draft.step);
      if (patch.step > draft.step && missing.length) throw new ValidationError(missing, draft.step);
      draft.step = patch.step;
    }
    draft.updatedAt = this.stamp();
    await this.commit();
    return clone(draft);
  }

  /** The clinic and time were chosen for a different service or location; choose again. */
  private clearSelection(draft: WizardDraft) {
    draft.fields.providerId = { value: null, source: 'user', confirmed: false };
    draft.fields.slotId = { value: null, source: 'user', confirmed: false };
  }

  /** Model edits: fields only, never step or status. */
  private prefillDraft(id: string, fields: Record<string, WizardFieldValue>) {
    const draft = this.findDraft(id);
    const changed: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (draft.fields[key]?.value === value) continue;
      draft.fields[key] = { value: value ?? null, source: 'conversation', confirmed: false };
      changed.push(key);
      if (key === 'serviceType' && typeof value === 'string') this.applyCover(draft, value);
    }
    draft.updatedAt = this.stamp();
    void this.commit();
    return { draft: clone(draft), changed };
  }

  private applyCover(draft: WizardDraft, service: string) {
    for (const [key, value] of Object.entries(this.coverValues(service))) {
      draft.fields[key] = { value: value ?? null, source: 'cover', confirmed: false };
    }
  }

  private isVisible(draft: WizardDraft, def: WizardFieldDefinition) {
    if (!def.hiddenWhen) return true;
    const value = draft.fields[def.hiddenWhen.field]?.value;
    return !def.hiddenWhen.in.includes(String(value));
  }

  validateStep(draft: WizardDraft, step: number) {
    const missing: string[] = [];
    for (const def of this.fieldDefs()) {
      if (def.step !== step || !this.isVisible(draft, def)) continue;
      let required = def.required;
      if (def.requiredWhen)
        required = def.requiredWhen.in.includes(
          String(draft.fields[def.requiredWhen.field]?.value),
        );
      if (!required) continue;
      const value = draft.fields[def.id]?.value;
      if (value === null || value === undefined || value === '') missing.push(def.id);
    }
    return missing;
  }

  async submitDraft(id: string) {
    await this.begin();
    const draft = this.findDraft(id);
    for (const step of [1, 3, 4, 5]) {
      const missing = this.validateStep(draft, step);
      if (missing.length) throw new ValidationError(missing, step);
    }
    const service = String(draft.fields.serviceType?.value) as ServiceType;
    const providerId = String(draft.fields.providerId?.value);
    const provider = this.providers.find((p) => p.id === providerId);
    const slot = provider?.slots.find((s) => s.id === draft.fields.slotId?.value);
    if (!provider || !slot) throw new ValidationError(['providerId', 'slotId'], 3);
    const compatible =
      provider.service === service ||
      (provider.telehealth && (service === 'gp' || service === 'telehealth'));
    if (!compatible) throw new ValidationError(['providerId'], 3);

    const zh = this.locale === 'zh';
    const booking: Booking = {
      id: this.nextId('booking'),
      draftId: draft.id,
      providerId: provider.id,
      provider: {
        id: provider.id,
        name: provider.name,
        address: provider.address,
        suburb: provider.suburb,
        relationship: provider.relationship,
        telehealth: provider.telehealth,
        languages: provider.languages,
      },
      slot,
      service,
      need: String(draft.fields.need?.value ?? ''),
      patientName: String(draft.fields.patientName?.value ?? ''),
      interpreter: draft.fields.interpreter?.value === true,
      language:
        typeof draft.fields.language?.value === 'string' ? draft.fields.language.value : null,
      outOfPocket: provider.outOfPocket,
      whatToBring: String(draft.fields.whatToBring?.value ?? '')
        .split('·')
        .map((s) => s.trim())
        .filter(Boolean),
      status: 'confirmed',
      createdAt: this.stamp(),
      demo: true,
    };
    if (draft.rescheduleOf) this.cancelInternal(draft.rescheduleOf, true);
    this.state.schedule.bookings.push(booking);
    if (draft.fields.reminder?.value === true) {
      const lead = draft.fields.reminderLead?.value === '24h' ? 24 : 2;
      const at = new Date(slot.startsAt);
      at.setHours(at.getHours() - lead);
      this.state.schedule.reminders.push({
        id: this.nextId('reminder'),
        bookingId: booking.id,
        text: zh ? `${provider.name} 就诊提醒` : `Appointment at ${provider.name}`,
        at: toOffsetIso(at),
        enabled: true,
        createdBy: 'ai',
      });
    }
    if (booking.whatToBring.length) {
      this.state.schedule.notes.push({
        id: this.nextId('note'),
        bookingId: booking.id,
        text: (zh ? '要带的东西：' : 'What to bring: ') + booking.whatToBring.join(' · '),
        createdBy: 'ai',
      });
    }
    const receipt: Receipt = {
      id: this.nextId('receipt'),
      kind: 'action',
      createdAt: this.stamp(),
      summary: zh ? `预约：${provider.name}` : `Booking: ${provider.name}`,
      purpose: zh
        ? '按你在向导中确认的内容创建预约'
        : 'Create the booking exactly as you confirmed in the wizard',
      benefit: zh
        ? '预约、提醒和备注已加入日程'
        : 'Appointment, reminder and notes added to your Dashboard',
      excludedUses: zh
        ? ['不涉及付款', '不修改保单']
        : ['No payment taken', 'No change to your policy'],
      retention: zh ? '与预约记录一致' : 'Kept with the appointment record',
      scope: 'single_action',
      status: 'completed',
      fields: [],
      bookingId: booking.id,
      sensitive: false,
    };
    this.state.receipts.push(receipt);
    draft.status = 'submitted';
    this.state.schedule.drafts = this.state.schedule.drafts.filter((d) => d.id !== draft.id);

    // The result belongs to the conversation the draft came from, whatever is open right now.
    const conversationId = draft.conversationId ?? null;
    const conversation = conversationId
      ? this.state.history.conversations[conversationId]
      : undefined;
    if (conversation && !history.isDeleted(this.state.history, conversation.id)) {
      const stamp = this.stamp();
      history.appendEntry(
        this.state.history,
        conversation.id,
        { kind: 'booking', turnId: null, bookingId: booking.id },
        stamp,
        () => this.nextId('entry'),
      );
      history.appendEntry(
        this.state.history,
        conversation.id,
        { kind: 'receipt', turnId: null, receiptId: receipt.id },
        stamp,
        () => this.nextId('entry'),
      );
      if (conversation.activeDraftId === draft.id) conversation.activeDraftId = null;
      if (conversation.originSuggestionId) {
        const record = this.suggestionRecord(conversation.originSuggestionId);
        record.bookingId = booking.id;
        this.state.personalization.snapshotRevision += 1;
      }
    }
    await this.commit();
    return { booking: clone(booking), receipt: clone(receipt), conversationId };
  }

  async abandonDraft(id: string) {
    await this.begin();
    const draft = this.state.schedule.drafts.find((d) => d.id === id);
    this.state.schedule.drafts = this.state.schedule.drafts.filter((d) => d.id !== id);
    const conversation = draft?.conversationId
      ? this.state.history.conversations[draft.conversationId]
      : undefined;
    if (conversation?.activeDraftId === id) conversation.activeDraftId = null;
    await this.commit();
  }

  private refreshDraftsFromProfile() {
    for (const draft of this.state.schedule.drafts) {
      for (const def of this.fieldDefs()) {
        if (!def.profileField) continue;
        const current = draft.fields[def.id];
        if (current && current.value !== null && current.value !== '') continue;
        if (this.permissionAllows(def.consent ?? def.profileField)) {
          draft.fields[def.id] = {
            value: this.profileValue(def),
            source: 'profile',
            confirmed: false,
          };
        }
      }
    }
  }

  private clearProfileSourcedFields(field: ProfileFieldName) {
    for (const draft of this.state.schedule.drafts) {
      for (const def of this.fieldDefs()) {
        if ((def.consent ?? def.profileField) !== field) continue;
        const current = draft.fields[def.id];
        if (current && current.source !== 'user') {
          draft.fields[def.id] = { value: null, source: 'user', confirmed: false };
          if (def.id === 'postcode') {
            // The previous clinic/time was selected using the withdrawn location.
            // Re-select from the now-visible options rather than submit a hidden stale choice.
            this.clearSelection(draft);
            draft.step = Math.min(draft.step, 3);
          }
          draft.updatedAt = this.stamp();
        }
      }
    }
  }

  /* ------------------------------------------------------------ schedule */
  private cancelInternal(bookingId: string, rescheduled: boolean) {
    const booking = this.state.schedule.bookings.find((b) => b.id === bookingId);
    if (!booking || booking.status === 'cancelled') return;
    const zh = this.locale === 'zh';
    booking.status = 'cancelled';
    this.state.schedule.reminders = this.state.schedule.reminders.filter(
      (r) => r.bookingId !== bookingId,
    );
    this.state.receipts.push({
      id: this.nextId('receipt'),
      kind: 'action',
      createdAt: this.stamp(),
      summary:
        (zh ? (rescheduled ? '改期：' : '取消：') : rescheduled ? 'Rescheduled: ' : 'Cancelled: ') +
        booking.provider.name,
      purpose: zh ? '按你的操作取消原预约' : 'Cancel the original appointment as you requested',
      benefit: zh ? '日程与提醒已同步移除' : 'Removed from your schedule and reminders',
      excludedUses: [],
      retention: zh ? '与预约记录一致' : 'Kept with the appointment record',
      scope: 'single_action',
      status: 'cancelled',
      fields: [],
      bookingId: booking.id,
      sensitive: false,
    });
    // A suggestion that led to this booking now shows "cancelled, can be prepared again".
    for (const record of Object.values(this.state.personalization.records)) {
      if (record.bookingId === bookingId) this.state.personalization.snapshotRevision += 1;
    }
  }

  async cancelBooking(id: string) {
    await this.begin();
    this.cancelInternal(id, false);
    await this.commit();
    return clone(this.state.schedule);
  }

  async createReminder(input: Pick<Reminder, 'bookingId' | 'text' | 'at'>) {
    await this.begin();
    this.state.schedule.reminders.push({
      ...input,
      id: this.nextId('reminder'),
      enabled: true,
      createdBy: 'user',
    });
    await this.commit();
    return clone(this.state.schedule);
  }
  async toggleReminder(id: string, enabled: boolean) {
    await this.begin();
    const reminder = this.state.schedule.reminders.find((r) => r.id === id);
    if (reminder) reminder.enabled = enabled;
    await this.commit();
    return clone(this.state.schedule);
  }
  async createNote(input: Pick<Note, 'bookingId' | 'text'>) {
    await this.begin();
    this.state.schedule.notes.push({ ...input, id: this.nextId('note'), createdBy: 'user' });
    await this.commit();
    return clone(this.state.schedule);
  }
  async dismissCard(id: string) {
    await this.begin();
    const card = this.state.schedule.cards.find((c) => c.id === id);
    if (card) card.dismissed = true;
    await this.commit();
    return clone(this.state.schedule);
  }

  /* ------------------------------------------------------- conversations */
  async conversations(): Promise<ConversationListResponse> {
    await this.begin();
    return { items: clone(history.listConversations(this.state.history)), nextCursor: null };
  }

  async createConversation(input: { requestId: string }): Promise<Conversation> {
    await this.begin();
    const conversation = history.createConversation(this.state.history, {
      id: this.nextId('conv'),
      requestId: input.requestId,
      now: this.stamp(),
    });
    await this.commit();
    return clone(conversation);
  }

  private requireConversation(id: string) {
    const conversation = this.state.history.conversations[id];
    if (!conversation || history.isDeleted(this.state.history, id))
      throw new ApiError('CONVERSATION_NOT_FOUND', 'This conversation no longer exists.', {
        status: 404,
      });
    return conversation;
  }

  async conversationMessages(id: string): Promise<ConversationMessagesResponse> {
    await this.begin();
    const conversation = this.requireConversation(id);
    return {
      conversation: clone(conversation),
      items: clone(history.getEntries(this.state.history, id)),
      nextCursor: null,
    };
  }

  async conversationEntry(id: string, messageId: string): Promise<ConversationEntry> {
    await this.begin();
    this.requireConversation(id);
    const entry = history.getEntry(this.state.history, id, messageId);
    if (!entry)
      throw new ApiError('MESSAGE_NOT_FOUND', 'This message no longer exists.', { status: 404 });
    return clone(entry);
  }

  async deleteConversation(id: string): Promise<DeleteConversationResponse> {
    await this.begin();
    const existed = Boolean(this.state.history.conversations[id]);
    this.stopRun(id);
    // Drafts prepared in this conversation and their automatic prefill go with it.
    this.state.schedule.drafts = this.state.schedule.drafts.filter(
      (d) => (d.conversationId ?? null) !== id,
    );
    // Follow-up conversations that were started from this one lose the prefill derived from it.
    const derivedFrom = new Set<string>();
    for (const [otherId, entries] of Object.entries(this.state.history.entries)) {
      if (
        entries.some(
          (e) =>
            (e.kind === 'user' || e.kind === 'assistant') &&
            e.sourceRefs.some((ref) => ref.conversationId === id),
        )
      )
        derivedFrom.add(otherId);
    }
    for (const draft of this.state.schedule.drafts) {
      if (!draft.conversationId || !derivedFrom.has(draft.conversationId)) continue;
      const need = draft.fields.need;
      if (need && need.source === 'conversation')
        draft.fields.need = { value: null, source: 'user', confirmed: false };
    }
    history.deleteConversation(this.state.history, id);
    for (const record of Object.values(this.state.personalization.records)) {
      if (record.followUpConversationId === id) record.followUpConversationId = null;
    }
    if (existed) {
      this.state.personalization.sourceRevision += 1;
      this.state.personalization.cache = null;
    }
    await this.commit();
    return {
      deletedId: id,
      sourceRevision: this.state.personalization.sourceRevision,
      snapshotRevision: this.state.personalization.snapshotRevision,
    };
  }

  /** A stopped turn must not leave anyone waiting on a consent card that can no longer be answered. */
  private releaseWaiters(run: RunningTurn) {
    for (const consentId of run.consentIds) {
      const waiter = this.consentWaiters.get(consentId);
      if (waiter) {
        this.consentWaiters.delete(consentId);
        waiter.reject(new DOMException('Turn cancelled', 'AbortError'));
      }
      const consent = this.state.consents[consentId];
      if (consent?.status === 'pending') consent.status = 'denied';
    }
    run.consentIds.clear();
  }

  private stopRun(conversationId: string, turnId?: string) {
    const run = this.runs.get(conversationId);
    if (!run || (turnId && run.turnId !== turnId)) return false;
    run.controller.abort();
    this.releaseWaiters(run);
    this.runs.delete(conversationId);
    history.interruptOpenWork(this.state.history, conversationId, run.turnId);
    return true;
  }

  async cancelTurn(conversationId: string, turnId: string): Promise<CancelTurnResponse> {
    await this.begin();
    const conversation = this.requireConversation(conversationId);
    if (this.stopRun(conversationId, turnId)) await this.commit();
    const latest = conversation.latestTurn;
    if (latest?.id !== turnId)
      throw new ApiError('TURN_NOT_FOUND', 'Unknown turn', { status: 404 });
    return { turnId, status: latest.status };
  }

  /**
   * Runs one turn of the scripted model inside a conversation. Every displayable event is
   * persisted before it is streamed, so a reload shows exactly what the member saw.
   */
  async sendTurn(
    conversationId: string,
    request: ConversationTurnRequest,
    onEvent: (event: ConversationStreamEvent) => void,
    signal?: AbortSignal,
  ) {
    await this.begin();
    const conversation = this.requireConversation(conversationId);
    if (this.runs.has(conversationId))
      throw new ApiError('CHAT_BUSY', 'The assistant is still answering in this conversation.', {
        status: 409,
        retryable: true,
      });
    const duplicate = history.findUserEntryByClientId(
      this.state.history,
      conversationId,
      request.clientMessageId,
    );
    if (duplicate) return; // Already accepted; the client reads the persisted result.

    const turnId = this.nextId('turn');
    const controller = new AbortController();
    const run: RunningTurn = { turnId, controller, consentIds: new Set() };
    this.runs.set(conversationId, run);
    controller.signal.addEventListener('abort', () => this.releaseWaiters(run), { once: true });
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let eventIndex = 0;
    const send = (payload: ConversationStreamEvent['payload'], entryId: string | null) => {
      if (controller.signal.aborted && payload.type !== 'done') return;
      onEvent({
        conversationId,
        turnId,
        eventIndex: eventIndex++,
        at: this.stamp(),
        entryId,
        payload,
      });
    };
    const append = (input: Parameters<typeof history.appendEntry>[2]) =>
      history.appendEntry(this.state.history, conversationId, input, this.stamp(), () =>
        this.nextId('entry'),
      );

    // Accept: persist the user message first, then tell the client which id it got.
    const originSuggestion = request.originSuggestionId
      ? this.overview().suggestions.find((s) => s.id === request.originSuggestionId)
      : undefined;
    const userEntry = append({
      kind: 'user',
      turnId,
      text: request.message,
      clientMessageId: request.clientMessageId,
      origin: originSuggestion ? 'suggestion_action' : 'user_input',
      sourceRefs: originSuggestion?.sourceRefs ?? [],
    });
    conversation.latestTurn = { id: turnId, status: 'running' };
    if (!originSuggestion) {
      this.state.personalization.sourceRevision += 1;
      this.state.personalization.cache = null;
    }
    await this.commit();
    send(
      {
        type: 'turn_accepted',
        userMessageId: userEntry.id,
        clientMessageId: request.clientMessageId,
      },
      userEntry.id,
    );

    const lang: Lang = detectLang(request.message);
    const toolEntries = new Map<string, string>();
    const emit = (event: ChatEvent) => {
      if (controller.signal.aborted) return;
      let entryId: string | null = null;
      switch (event.type) {
        case 'message':
          // Replies in a turn started from a suggestion refer to its sources, so they are
          // redacted together with the source if it is ever deleted.
          entryId = append({
            kind: 'assistant',
            turnId,
            text: event.text,
            translation: event.translation,
            suggestions: event.suggestions,
            sourceRefs: originSuggestion?.sourceRefs ?? [],
          }).id;
          break;
        case 'tool_status': {
          const existing = toolEntries.get(event.id);
          if (existing) {
            history.updateEntry<'tool'>(this.state.history, conversationId, existing, {
              status: event.status,
              label: event.label,
            });
            entryId = existing;
          } else {
            entryId = append({
              kind: 'tool',
              turnId,
              tool: event.tool,
              label: event.label,
              status: event.status,
            }).id;
            toolEntries.set(event.id, entryId);
          }
          break;
        }
        case 'consent_request':
          entryId = append({
            kind: 'consent',
            turnId,
            consentId: event.request.id,
            dataLabel: event.request.dataLabel,
            purpose: event.request.purpose,
            benefit: event.request.benefit,
            sensitive: event.request.sensitive,
            status: 'pending',
            scope: null,
          }).id;
          break;
        case 'consent_resolved': {
          const consent = this.state.consents[event.requestId];
          const entry = history
            .getEntries(this.state.history, conversationId)
            .find((e) => e.kind === 'consent' && e.consentId === event.requestId);
          if (entry && consent) {
            const granted = consent.status === 'granted';
            const receipt = granted
              ? [...this.state.receipts]
                  .reverse()
                  .find((r) => r.kind === 'data' && r.fields.join() === consent.fields.join())
              : undefined;
            const scope = receipt?.scope;
            history.updateEntry<'consent'>(this.state.history, conversationId, entry.id, {
              status: granted ? 'granted' : 'denied',
              scope: scope === 'session' || scope === 'always' ? scope : null,
            });
            entryId = entry.id;
          }
          break;
        }
        case 'receipt':
          entryId = append({ kind: 'receipt', turnId, receiptId: event.receipt.id }).id;
          break;
        case 'wizard_open':
          entryId = append({
            kind: 'wizard',
            turnId,
            draftId: event.draft.id,
            mode: 'open',
            changed: [],
          }).id;
          break;
        case 'wizard_prefill':
          entryId = append({
            kind: 'wizard',
            turnId,
            draftId: event.draft.id,
            mode: 'update',
            changed: event.changed,
          }).id;
          break;
        case 'action_done':
          entryId = append({ kind: 'booking', turnId, bookingId: event.booking.id }).id;
          break;
        case 'safety_alert':
          entryId = append({
            kind: 'safety',
            turnId,
            message: event.message,
            resources: event.resources,
          }).id;
          break;
        case 'handoff':
          entryId = append({
            kind: 'handoff',
            turnId,
            summary: event.summary,
            ticket: event.ticket,
          }).id;
          break;
        case 'error':
          entryId = append({ kind: 'error', turnId, message: event.message, retryable: false }).id;
          break;
        case 'done':
          break;
      }
      void this.commit();
      send(event, entryId);
    };

    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const timer = setTimeout(resolve, ms);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });

    const facts = this.state.personalization.enabled ? this.currentFacts() : [];
    const ctx: ScriptContext = {
      lang,
      now: this.now(),
      emit,
      wait,
      sourceRefs: originSuggestion?.sourceRefs ?? [],
      isHealthSource: sourceConversationIds(facts).has(conversationId),
      requestConsent: async (input) => {
        const created = this.createConsent(input);
        run.consentIds.add(created.id);
        emit({ type: 'consent_request', request: clone(created) });
        const decision = await new Promise<ConsentDecision>((resolve, reject) => {
          this.consentWaiters.set(created.id, { resolve, reject });
        });
        run.consentIds.delete(created.id);
        emit({ type: 'consent_resolved', requestId: created.id });
        const receipt = this.state.receipts.at(-1);
        if (decision !== 'deny' && receipt) emit({ type: 'receipt', receipt: clone(receipt) });
        await wait(300);
        return decision;
      },
      hasPermission: (field) => this.permissionAllows(field),
      profileValue: (field) => this.state.profile.member.fields[field].value || null,
      preferenceFields: PREFERENCE_FIELDS,
      openDraft: () => {
        const draft = request.openDraftId
          ? this.state.schedule.drafts.find((d) => d.id === request.openDraftId)
          : undefined;
        // A draft can only be steered from the conversation it belongs to.
        return draft && (draft.conversationId ?? null) === conversationId ? clone(draft) : null;
      },
      createDraft: (prefill, sources = {}) => {
        const draft = this.buildDraft(prefill, sources, null, conversationId);
        this.state.schedule.drafts.push(draft);
        conversation.activeDraftId = draft.id;
        void this.commit();
        return clone(draft);
      },
      prefillDraft: (id, fields) => this.prefillDraft(id, fields),
      findProviders: (service, postcode, language) =>
        clone(this.searchProviders({ service, postcode, language })),
    };

    try {
      await runScript(ctx, request.message);
      if (!controller.signal.aborted) {
        conversation.latestTurn = { id: turnId, status: 'completed' };
        this.runs.delete(conversationId);
        await this.commit();
        send({ type: 'done' }, null);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.stopRun(conversationId, turnId);
        history.interruptOpenWork(this.state.history, conversationId, turnId);
        await this.commit();
        return;
      }
      conversation.latestTurn = { id: turnId, status: 'failed' };
      this.runs.delete(conversationId);
      const message = error instanceof Error ? error.message : 'Unexpected error';
      const entry = append({ kind: 'error', turnId, message, retryable: true });
      await this.commit();
      send({ type: 'error', message }, entry.id);
    }
  }

  /* ----------------------------------------------------- personalization */
  async personalization(): Promise<PersonalizationSettings> {
    await this.begin();
    const p = this.state.personalization;
    return {
      enabled: p.enabled,
      updatedAt: p.updatedAt,
      sourceRevision: p.sourceRevision,
      receiptId: p.receiptId,
      presetByDemo: p.presetByDemo,
    };
  }

  async setPersonalization(patch: PersonalizationPatch): Promise<PersonalizationSettings> {
    await this.begin();
    const p = this.state.personalization;
    if (patch.enabled && !p.enabled) {
      const copy = TEXT.personalizationReceipt[this.locale];
      const receipt: Receipt = {
        id: this.nextId('receipt'),
        kind: 'data',
        createdAt: this.stamp(),
        summary: copy.summary,
        purpose: copy.purpose,
        benefit: copy.benefit,
        excludedUses: copy.excluded,
        retention: copy.retention,
        scope: 'always',
        status: 'active',
        fields: ['healthHistory'],
        bookingId: null,
        sensitive: true,
      };
      this.state.receipts.push(receipt);
      p.enabled = true;
      p.receiptId = receipt.id;
      p.presetByDemo = false;
      p.updatedAt = this.stamp();
      p.sourceRevision += 1;
      p.cache = null;
    } else if (!patch.enabled && p.enabled) {
      this.disablePersonalization();
    }
    await this.commit();
    return this.personalization();
  }

  /** Derived health data goes; conversations stay readable. */
  private disablePersonalization() {
    const p = this.state.personalization;
    p.enabled = false;
    p.updatedAt = this.stamp();
    p.sourceRevision += 1;
    p.snapshotRevision += 1;
    p.cache = null;
    p.presetByDemo = false;
    const receipt = p.receiptId ? this.state.receipts.find((r) => r.id === p.receiptId) : undefined;
    if (receipt && receipt.status === 'active') receipt.status = 'revoked';
    p.receiptId = null;
  }

  /** Facts for the current source revision, regenerated only when sources changed. */
  private currentFacts() {
    const p = this.state.personalization;
    if (!p.enabled) return [];
    if (!p.cache || p.cache.sourceRevision !== p.sourceRevision) {
      p.cache = {
        sourceRevision: p.sourceRevision,
        generatedAt: this.stamp(),
        facts: factsFromHistory(this.state.history, this.now()),
      };
      p.snapshotRevision += 1;
      void this.persist();
    }
    return p.cache.facts;
  }

  private overview(): HealthOverviewResponse {
    const p = this.state.personalization;
    const facts = this.currentFacts();
    return buildOverview({
      enabled: p.enabled,
      sourceRevision: p.sourceRevision,
      snapshotRevision: p.snapshotRevision,
      generatedAt: p.cache?.generatedAt ?? null,
      facts,
      records: p.records,
      history: this.state.history,
      bookings: this.state.schedule.bookings.map((b) => ({ id: b.id, status: b.status })),
    });
  }

  async healthOverview(): Promise<HealthOverviewResponse> {
    await this.begin();
    return clone(this.overview());
  }

  async refreshHealthOverview(): Promise<HealthOverviewRefreshResponse> {
    await this.begin();
    const p = this.state.personalization;
    if (!p.enabled) return { status: 'disabled', sourceRevision: p.sourceRevision };
    const fresh = p.cache?.sourceRevision === p.sourceRevision;
    this.currentFacts();
    await this.commit();
    return { status: fresh ? 'up_to_date' : 'queued', sourceRevision: p.sourceRevision };
  }

  private suggestionRecord(id: string): SuggestionRecord {
    const records = this.state.personalization.records;
    records[id] ??= {
      dedupeKey: id,
      dismissedAt: null,
      followUpConversationId: null,
      bookingId: null,
      startCount: 0,
    };
    return records[id]!;
  }

  private requireSuggestion(id: string, expectedSnapshotRevision: number) {
    const p = this.state.personalization;
    if (!p.enabled)
      throw new ApiError('PERSONALIZATION_DISABLED', 'Personalisation is switched off.', {
        status: 409,
      });
    if (expectedSnapshotRevision !== p.snapshotRevision)
      throw new ApiError(
        'STALE_SUGGESTION',
        'This suggestion has changed. Refresh and try again.',
        { status: 409, retryable: true },
      );
    const suggestion = this.overview().suggestions.find((s) => s.id === id);
    if (!suggestion)
      throw new ApiError('SUGGESTION_NOT_FOUND', 'This suggestion is no longer available.', {
        status: 404,
      });
    const sourcesExist = suggestion.sourceRefs.every(
      (ref) =>
        !history.isDeleted(this.state.history, ref.conversationId) &&
        history.getEntry(this.state.history, ref.conversationId, ref.messageId),
    );
    if (!sourcesExist)
      throw new ApiError(
        'SOURCE_REMOVED',
        'The conversation this suggestion came from was deleted.',
        { status: 409 },
      );
    return suggestion;
  }

  async dismissSuggestion(
    id: string,
    body: DismissSuggestionRequest,
  ): Promise<HealthOverviewResponse> {
    await this.begin();
    this.requireSuggestion(id, body.expectedSnapshotRevision);
    const record = this.suggestionRecord(id);
    record.dismissedAt = this.stamp();
    this.state.personalization.snapshotRevision += 1;
    await this.commit();
    return clone(this.overview());
  }

  async startSuggestion(
    id: string,
    body: StartSuggestionRequest,
  ): Promise<StartSuggestionResponse> {
    await this.begin();
    const p = this.state.personalization;
    const replay = p.startRequests[body.requestId];
    if (replay) return clone(replay);
    const suggestion = this.requireSuggestion(id, body.expectedSnapshotRevision);
    if (suggestion.action !== 'prepare_gp_booking')
      throw new ApiError('SUGGESTION_NOT_FOUND', 'This suggestion cannot start a follow-up.', {
        status: 400,
      });
    const record = this.suggestionRecord(id);
    const existing =
      record.followUpConversationId &&
      !history.isDeleted(this.state.history, record.followUpConversationId)
        ? this.state.history.conversations[record.followUpConversationId]
        : undefined;
    const previousBooking = record.bookingId
      ? this.state.schedule.bookings.find((b) => b.id === record.bookingId)
      : undefined;
    const newAttempt =
      !existing || suggestion.state === 'cancelled' || suggestion.state === 'available';
    if (newAttempt) {
      record.startCount += 1;
      if (previousBooking?.status === 'cancelled') record.bookingId = null;
    }
    const conversation =
      existing ??
      history.createConversation(this.state.history, {
        id: this.nextId('conv'),
        requestId: `start-${id}-${record.startCount}`,
        now: this.stamp(),
        originSuggestionId: id,
        title: TEXT.followUpTitle[this.locale],
      });
    record.followUpConversationId = conversation.id;
    record.dismissedAt = null;
    p.snapshotRevision += 1;
    const response: StartSuggestionResponse = {
      conversationId: conversation.id,
      initialMessage: TEXT.followUpMessage,
      clientMessageId: `suggestion-${id}-${record.startCount}`,
      originSuggestionId: id,
    };
    p.startRequests[body.requestId] = response;
    await this.commit();
    return clone(response);
  }
}

export const mockService = new MockService();
export { ValidationError };
