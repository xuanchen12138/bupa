import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  ConversationSchema,
  ConversationEntrySchema,
  HealthOverviewResponseSchema,
  PersonalizationSettingsSchema,
  ProfileResponseSchema,
  ScheduleSchema,
  ProviderSchema,
  ReceiptSchema,
  type Conversation,
  type ConversationEntry,
  type HealthOverviewResponse,
  type PersonalizationSettings,
  type SourceRef,
  type ChatEvent,
  type ConversationTurnRequest,
  type StartSuggestionResponse,
} from '@bupa/contracts';
import { demoConversationSeed } from '@bupa/contracts/fixtures';
import { createDemoStore, type DemoStore } from './store.js';
import { fail, id } from './domain.js';

const BusinessSchema = z.object({
  profile: ProfileResponseSchema,
  schedule: ScheduleSchema,
  providers: z.array(ProviderSchema),
  receipts: z.array(ReceiptSchema),
  submissions: z.array(
    z.tuple([
      z.string(),
      z.object({
        bookingId: z.string(),
        receiptId: z.string(),
        conversationId: z.string().nullable(),
      }),
    ]),
  ),
});
type Row = Record<string, string | number | bigint | Uint8Array | null>;
export type Turn = {
  id: string;
  conversationId: string;
  userId: string;
  sessionId: string;
  status: 'running' | 'completed' | 'interrupted' | 'failed';
  sourceRevision: number;
  eventIndex: number;
};
export const emptyOverview = (mode: 'scripted' | 'model' = 'scripted'): HealthOverviewResponse => ({
  status: 'disabled',
  sourceRevision: 0,
  snapshotRevision: 0,
  generatedAt: null,
  generationMode: mode,
  dataMode: 'fictional',
  summary: null,
  facts: [],
  suggestions: [],
  error: null,
});
const parse = <T>(schema: z.ZodType<T>, data: unknown) => schema.parse(JSON.parse(String(data)));

/** One service process per database. Every content query is owner-scoped. */
export class Repository {
  readonly db: DatabaseSync;
  private depth = 0;
  constructor(readonly path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE;',
    );
    if (path !== ':memory:')
      this.db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS owners(owner_id TEXT PRIMARY KEY, business TEXT NOT NULL, settings TEXT NOT NULL, overview TEXT NOT NULL, seeded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations(owner_id TEXT NOT NULL, id TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,request_id), FOREIGN KEY(owner_id) REFERENCES owners(owner_id));
      CREATE INDEX IF NOT EXISTS conversation_list ON conversations(owner_id,deleted,updated_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS entries(owner_id TEXT NOT NULL,id TEXT NOT NULL,conversation_id TEXT NOT NULL,turn_id TEXT,seq INTEGER NOT NULL,client_id TEXT,payload TEXT NOT NULL,PRIMARY KEY(owner_id,id),UNIQUE(owner_id,conversation_id,seq),UNIQUE(owner_id,conversation_id,client_id),FOREIGN KEY(owner_id,conversation_id) REFERENCES conversations(owner_id,id));
      CREATE TABLE IF NOT EXISTS turns(owner_id TEXT NOT NULL,id TEXT NOT NULL,conversation_id TEXT NOT NULL,user_id TEXT NOT NULL,session_id TEXT NOT NULL,status TEXT NOT NULL,source_revision INTEGER NOT NULL,event_index INTEGER NOT NULL DEFAULT -1,PRIMARY KEY(owner_id,id),FOREIGN KEY(owner_id,conversation_id) REFERENCES conversations(owner_id,id));
      CREATE UNIQUE INDEX IF NOT EXISTS one_running_turn ON turns(owner_id,conversation_id) WHERE status='running';
      CREATE TABLE IF NOT EXISTS source_edges(owner_id TEXT NOT NULL,target_id TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(owner_id,target_id,source_id),FOREIGN KEY(owner_id,target_id) REFERENCES entries(owner_id,id) ON DELETE CASCADE,FOREIGN KEY(owner_id,source_id) REFERENCES entries(owner_id,id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS suggestion_state(owner_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner_id,id),FOREIGN KEY(owner_id) REFERENCES owners(owner_id));
      CREATE TABLE IF NOT EXISTS commands(owner_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(owner_id,id,kind),FOREIGN KEY(owner_id) REFERENCES owners(owner_id));
      CREATE TABLE IF NOT EXISTS generation_jobs(owner_id TEXT PRIMARY KEY,source_revision INTEGER NOT NULL,status TEXT NOT NULL,FOREIGN KEY(owner_id) REFERENCES owners(owner_id));
      INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
    `);
    this.recover();
  }
  close() {
    this.db.close();
  }
  transaction<T>(action: () => T): T {
    if (this.depth) return action();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }
  private recover() {
    this.transaction(() => {
      const owners = this.db.prepare('SELECT owner_id FROM owners').all();
      for (const row of owners) {
        const owner = String(row.owner_id);
        for (const turn of this.db
          .prepare("SELECT * FROM turns WHERE owner_id=? AND status='running'")
          .all(owner))
          this.finishTurn(owner, String(turn.id), 'interrupted');
        const report = this.overview(owner);
        if (report.status === 'pending')
          this.writeOverview(owner, {
            ...report,
            status: 'error',
            summary: null,
            facts: [],
            suggestions: [],
            error: {
              code: 'GENERATION_INTERRUPTED',
              message: 'Generation was interrupted. Please refresh.',
            },
          });
      }
      this.db.exec("UPDATE generation_jobs SET status='interrupted' WHERE status='running'");
    });
  }
  loadOwner(
    owner: string,
    clock: () => Date,
    seed = false,
    mode: 'scripted' | 'model' = 'scripted',
  ): DemoStore {
    const store = createDemoStore(clock, owner);
    store.persistent = this.path !== ':memory:';
    const saved = this.db.prepare('SELECT business FROM owners WHERE owner_id=?').get(owner);
    if (saved) {
      const persisted = JSON.parse(String(saved.business));
      const fields = persisted?.profile?.member?.fields;
      let upgraded = false;
      // Older snapshots predate these preferences. Add empty, unshared values only;
      // never replace saved choices or infer permission from the current demo fixture.
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        for (const name of ['preferredTime', 'travelDuration']) {
          if (Object.hasOwn(fields, name)) continue;
          fields[name] = { value: '', permission: 'off', sessionId: null };
          upgraded = true;
        }
      }
      const business = BusinessSchema.parse(persisted);
      // Validate before writing; preserve all other stored data, including unknown keys.
      if (upgraded)
        this.db
          .prepare('UPDATE owners SET business=? WHERE owner_id=?')
          .run(JSON.stringify(persisted), owner);
      Object.assign(store, { ...business, submissions: new Map(business.submissions) });
      // Unsubmitted payload, permission sessions and consent waiters are deliberately not restored.
      for (const receipt of store.receipts)
        if (receipt.scope === 'session' && receipt.status === 'active') receipt.status = 'revoked';
      return store;
    }
    this.transaction(() => {
      this.db.prepare('INSERT INTO owners VALUES(?,?,?,?,?)').run(
        owner,
        this.businessJSON(store),
        JSON.stringify({
          enabled: false,
          updatedAt: null,
          sourceRevision: 0,
          receiptId: null,
          presetByDemo: false,
        }),
        JSON.stringify(emptyOverview(mode)),
        clock().toISOString(),
      );
      if (seed) {
        const sample = demoConversationSeed(clock(), 'zh');
        this.insertConversation(owner, sample.conversation, 'initial-fictional-seed');
        for (const entry of sample.entries) this.writeEntry(owner, entry);
      }
    });
    return store;
  }
  private businessJSON(store: DemoStore) {
    const profile = structuredClone(store.profile);
    for (const field of Object.values(profile.member.fields))
      if (field.permission === 'session') {
        field.permission = 'off';
        field.sessionId = null;
      }
    return JSON.stringify({
      profile,
      schedule: { ...store.schedule, drafts: [] },
      providers: store.providers,
      receipts: store.receipts,
      submissions: [...store.submissions],
    });
  }
  saveBusiness(store: DemoStore) {
    this.db
      .prepare('UPDATE owners SET business=? WHERE owner_id=?')
      .run(this.businessJSON(store), store.ownerId);
  }
  atomic<T>(store: DemoStore, action: () => T): T {
    const rollback = structuredClone({
      profile: store.profile,
      schedule: store.schedule,
      receipts: store.receipts,
      providers: store.providers,
      draftSessions: store.draftSessions,
      draftProgress: store.draftProgress,
      draftSources: store.draftSources,
      submissions: store.submissions,
      consents: store.consents,
      consentDecisions: store.consentDecisions,
      consentReceipts: store.consentReceipts,
      receiptSessions: store.receiptSessions,
    });
    const sessions = [...store.sessions.values()].map((session) => ({
      session,
      grants: new Set(session.grants),
      denied: new Set(session.denied),
    }));
    try {
      return this.transaction(() => {
        const value = action();
        this.saveBusiness(store);
        return value;
      });
    } catch (error) {
      Object.assign(store, rollback);
      for (const prior of sessions) {
        prior.session.grants = prior.grants;
        prior.session.denied = prior.denied;
      }
      throw error;
    }
  }
  settings(owner: string): PersonalizationSettings {
    const row = this.db.prepare('SELECT settings FROM owners WHERE owner_id=?').get(owner);
    if (!row) return fail(404, 'OWNER_NOT_FOUND', 'Owner was not found.');
    return parse(PersonalizationSettingsSchema, row.settings);
  }
  writeSettings(owner: string, settings: PersonalizationSettings) {
    this.db
      .prepare('UPDATE owners SET settings=? WHERE owner_id=?')
      .run(JSON.stringify(PersonalizationSettingsSchema.parse(settings)), owner);
  }
  overview(owner: string): HealthOverviewResponse {
    const row = this.db.prepare('SELECT overview FROM owners WHERE owner_id=?').get(owner);
    if (!row) return fail(404, 'OWNER_NOT_FOUND', 'Owner was not found.');
    return parse(HealthOverviewResponseSchema, row.overview);
  }
  writeOverview(owner: string, value: HealthOverviewResponse) {
    this.db
      .prepare('UPDATE owners SET overview=? WHERE owner_id=?')
      .run(JSON.stringify(HealthOverviewResponseSchema.parse(value)), owner);
  }
  invalidate(owner: string) {
    const settings = this.settings(owner);
    settings.sourceRevision++;
    this.writeSettings(owner, settings);
    const report = this.overview(owner);
    this.writeOverview(owner, {
      ...emptyOverview(report.generationMode === 'model' ? 'model' : 'scripted'),
      status: settings.enabled ? 'pending' : 'disabled',
      sourceRevision: settings.sourceRevision,
      snapshotRevision: report.snapshotRevision + 1,
    });
    return settings.sourceRevision;
  }
  private insertConversation(owner: string, conversation: Conversation, requestId: string) {
    this.db
      .prepare(
        'INSERT INTO conversations(owner_id,id,request_id,payload,updated_at) VALUES(?,?,?,?,?)',
      )
      .run(
        owner,
        conversation.id,
        requestId,
        JSON.stringify(ConversationSchema.parse(conversation)),
        conversation.updatedAt,
      );
  }
  createConversation(
    owner: string,
    requestId: string,
    at: string,
    originSuggestionId: string | null = null,
  ): Conversation {
    const old = this.db
      .prepare('SELECT id,deleted FROM conversations WHERE owner_id=? AND request_id=?')
      .get(owner, requestId);
    if (old) {
      if (old.deleted)
        fail(410, 'SOURCE_REMOVED', 'The previously created conversation was deleted.');
      return this.conversation(owner, String(old.id));
    }
    const conversation = ConversationSchema.parse({
      id: id('conversation'),
      title: '',
      createdAt: at,
      updatedAt: at,
      activeDraftId: null,
      originSuggestionId,
      latestTurn: null,
    });
    this.insertConversation(owner, conversation, requestId);
    return conversation;
  }
  conversation(owner: string, conversationId: string): Conversation {
    const row = this.db
      .prepare('SELECT payload FROM conversations WHERE owner_id=? AND id=? AND deleted=0')
      .get(owner, conversationId);
    if (!row) fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found.');
    return parse(ConversationSchema, row.payload);
  }
  updateConversation(owner: string, conversation: Conversation) {
    this.db
      .prepare(
        'UPDATE conversations SET payload=?,updated_at=? WHERE owner_id=? AND id=? AND deleted=0',
      )
      .run(
        JSON.stringify(ConversationSchema.parse(conversation)),
        conversation.updatedAt,
        owner,
        conversation.id,
      );
  }
  private cursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | null {
    if (!cursor) return null;
    try {
      return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    } catch {
      return fail(400, 'INVALID_CURSOR', 'Cursor is invalid for this resource.');
    }
  }
  page(owner: string, limit: number, cursor?: string) {
    const boundary = this.cursor(
      cursor,
      z.object({ scope: z.literal(owner + ':conversations'), at: z.string(), id: z.string() }),
    );
    const rows = this.db
      .prepare(
        'SELECT c.payload,c.updated_at,c.id FROM conversations c WHERE c.owner_id=? AND c.deleted=0 AND EXISTS(SELECT 1 FROM entries e WHERE e.owner_id=c.owner_id AND e.conversation_id=c.id) AND (? IS NULL OR c.updated_at < ? OR (c.updated_at=? AND c.id<?)) ORDER BY c.updated_at DESC,c.id DESC LIMIT ?',
      )
      .all(
        owner,
        boundary?.at ?? null,
        boundary?.at ?? null,
        boundary?.at ?? null,
        boundary?.id ?? null,
        limit + 1,
      );
    const last = rows[limit - 1];
    return {
      items: rows.slice(0, limit).map((row) => parse(ConversationSchema, row.payload)),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ scope: owner + ':conversations', at: last.updated_at, id: last.id }),
            ).toString('base64url')
          : null,
    };
  }
  messages(owner: string, conversationId: string, limit = 100, cursor?: string) {
    const conversation = this.conversation(owner, conversationId);
    const boundary = this.cursor(
      cursor,
      z.object({
        scope: z.literal(owner + ':' + conversationId),
        order: z.number().int().nonnegative(),
      }),
    );
    const rows = this.db
      .prepare(
        'SELECT payload,seq FROM entries WHERE owner_id=? AND conversation_id=? AND seq>? ORDER BY seq LIMIT ?',
      )
      .all(owner, conversationId, boundary?.order ?? -1, limit + 1);
    const last = rows[limit - 1];
    return {
      conversation,
      items: rows.slice(0, limit).map((row) => parse(ConversationEntrySchema, row.payload)),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ scope: owner + ':' + conversationId, order: last.seq }),
            ).toString('base64url')
          : null,
    };
  }

  allEntries(owner: string, conversationId?: string): ConversationEntry[] {
    const rows = conversationId
      ? this.db
          .prepare(
            'SELECT payload FROM entries WHERE owner_id=? AND conversation_id=? ORDER BY seq',
          )
          .all(owner, conversationId)
      : this.db
          .prepare(
            'SELECT e.payload FROM entries e JOIN conversations c ON c.owner_id=e.owner_id AND c.id=e.conversation_id WHERE e.owner_id=? AND c.deleted=0 ORDER BY e.seq',
          )
          .all(owner);
    return rows.map((row) => parse(ConversationEntrySchema, row.payload));
  }
  entry(owner: string, conversationId: string, entryId: string) {
    this.conversation(owner, conversationId);
    const row = this.db
      .prepare('SELECT payload FROM entries WHERE owner_id=? AND conversation_id=? AND id=?')
      .get(owner, conversationId, entryId);
    if (!row) fail(404, 'SOURCE_REMOVED', 'The source message is no longer available.');
    return parse(ConversationEntrySchema, row.payload);
  }
  sourcesExist(owner: string, refs: SourceRef[]) {
    return refs.every((ref) => {
      try {
        const entry = this.entry(owner, ref.conversationId, ref.messageId);
        return (
          entry.kind === 'user' &&
          entry.origin === 'user_input' &&
          entry.createdAt === ref.reportedAt &&
          entry.text.length > 0
        );
      } catch {
        return false;
      }
    });
  }
  nextOrder(owner: string, conversationId: string) {
    const row = this.db
      .prepare(
        'SELECT COALESCE(MAX(seq),-1)+1 AS n FROM entries WHERE owner_id=? AND conversation_id=?',
      )
      .get(owner, conversationId)!;
    return Number(row.n);
  }
  writeEntry(owner: string, entry: ConversationEntry, sources: SourceRef[] = []) {
    this.conversation(owner, entry.conversationId);
    const value = ConversationEntrySchema.parse(entry);
    this.db
      .prepare(
        'INSERT INTO entries VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET payload=excluded.payload',
      )
      .run(
        owner,
        entry.id,
        entry.conversationId,
        entry.turnId,
        entry.order,
        entry.kind === 'user' ? entry.clientMessageId : null,
        JSON.stringify(value),
      );
    this.db
      .prepare('DELETE FROM source_edges WHERE owner_id=? AND target_id=?')
      .run(owner, entry.id);
    for (const ref of sources) {
      if (!this.sourcesExist(owner, [ref]))
        fail(409, 'SOURCE_REMOVED', 'A referenced source is no longer available.');
      this.db
        .prepare('INSERT OR IGNORE INTO source_edges VALUES(?,?,?)')
        .run(owner, entry.id, ref.messageId);
    }
  }
  beginTurn(
    owner: string,
    conversationId: string,
    sessionId: string,
    request: ConversationTurnRequest,
    at: string,
    refs: SourceRef[] = [],
  ) {
    return this.transaction(() => {
      const conversation = this.conversation(owner, conversationId);
      const existing = this.db
        .prepare(
          'SELECT payload FROM entries WHERE owner_id=? AND conversation_id=? AND client_id=?',
        )
        .get(owner, conversationId, request.clientMessageId);
      if (existing) {
        const user = parse(ConversationEntrySchema, existing.payload);
        if (user.kind !== 'user' || user.text !== request.message)
          fail(409, 'IDEMPOTENCY_CONFLICT', 'Use a new message ID for different text.');
        const turn = this.turn(owner, conversationId, user.turnId!);
        if (turn.status === 'running') fail(409, 'CHAT_BUSY', 'This message is already running.');
        return { turn, user, replay: true };
      }
      if (
        this.db
          .prepare(
            "SELECT id FROM turns WHERE owner_id=? AND conversation_id=? AND status='running'",
          )
          .get(owner, conversationId)
      )
        fail(409, 'CHAT_BUSY', 'This conversation is already running.');
      const turnId = id('turn');
      const user = ConversationEntrySchema.parse({
        id: id('message'),
        conversationId,
        turnId,
        order: this.nextOrder(owner, conversationId),
        createdAt: at,
        kind: 'user',
        text: request.message,
        clientMessageId: request.clientMessageId,
        origin: request.originSuggestionId ? 'suggestion_action' : 'user_input',
        sourceRefs: refs,
      });
      this.writeEntry(owner, user, refs);
      const revision = request.originSuggestionId
        ? this.settings(owner).sourceRevision
        : this.invalidate(owner);
      this.db
        .prepare('INSERT INTO turns VALUES(?,?,?,?,?,?,?,?)')
        .run(owner, turnId, conversationId, user.id, sessionId, 'running', revision, -1);
      this.updateConversation(owner, {
        ...conversation,
        title: conversation.title || request.message.slice(0, 60),
        updatedAt: at,
        latestTurn: { id: turnId, status: 'running' },
      });
      return { turn: this.turn(owner, conversationId, turnId), user, replay: false };
    });
  }
  turn(owner: string, conversationId: string, turnId: string): Turn {
    const row = this.db
      .prepare('SELECT * FROM turns WHERE owner_id=? AND conversation_id=? AND id=?')
      .get(owner, conversationId, turnId);
    if (!row) fail(404, 'TURN_NOT_FOUND', 'Turn was not found.');
    return this.turnValue(row);
  }
  private turnValue(row: Row): Turn {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      userId: String(row.user_id),
      sessionId: String(row.session_id),
      status: row.status as Turn['status'],
      sourceRevision: Number(row.source_revision),
      eventIndex: Number(row.event_index),
    };
  }
  assertRunning(owner: string, turn: Turn) {
    this.conversation(owner, turn.conversationId);
    const latest = this.turn(owner, turn.conversationId, turn.id);
    if (
      latest.status !== 'running' ||
      latest.sourceRevision !== this.settings(owner).sourceRevision
    )
      fail(409, 'SOURCE_REMOVED', 'This execution is no longer current.');
  }
  finishTurn(owner: string, turnId: string, status: Exclude<Turn['status'], 'running'>) {
    const row = this.db.prepare('SELECT * FROM turns WHERE owner_id=? AND id=?').get(owner, turnId);
    if (!row || row.status !== 'running') return;
    this.db
      .prepare('UPDATE turns SET status=? WHERE owner_id=? AND id=?')
      .run(status, owner, turnId);
    const conversationRow = this.db
      .prepare('SELECT payload FROM conversations WHERE owner_id=? AND id=? AND deleted=0')
      .get(owner, String(row.conversation_id));
    if (!conversationRow) return;
    const conversation = parse(ConversationSchema, conversationRow.payload);
    if (conversation.latestTurn?.id === turnId)
      this.updateConversation(owner, { ...conversation, latestTurn: { id: turnId, status } });
    for (const entry of this.allEntries(owner, conversation.id)) {
      if (entry.turnId !== turnId) continue;
      if (entry.kind === 'tool' && entry.status === 'running')
        this.writeEntry(owner, { ...entry, status: 'interrupted' });
      if (entry.kind === 'consent' && entry.status === 'pending')
        this.writeEntry(owner, { ...entry, status: 'expired' });
    }
  }
  interruptOwner(owner: string) {
    for (const row of this.db
      .prepare("SELECT id FROM turns WHERE owner_id=? AND status='running'")
      .all(owner))
      this.finishTurn(owner, String(row.id), 'interrupted');
  }
  command<T>(owner: string, kind: string, requestId: string): T | null {
    const row = this.db
      .prepare('SELECT result FROM commands WHERE owner_id=? AND kind=? AND id=?')
      .get(owner, kind, requestId);
    return row ? (JSON.parse(String(row.result)) as T) : null;
  }
  saveCommand(owner: string, kind: string, requestId: string, result: unknown) {
    this.db
      .prepare('INSERT INTO commands VALUES(?,?,?,?)')
      .run(owner, requestId, kind, JSON.stringify(result));
  }
  states(owner: string): HealthOverviewResponse['suggestions'] {
    return this.db
      .prepare('SELECT payload FROM suggestion_state WHERE owner_id=?')
      .all(owner)
      .map((row) =>
        HealthOverviewResponseSchema.shape.suggestions.element.parse(
          JSON.parse(String(row.payload)),
        ),
      );
  }
  saveSuggestion(owner: string, value: HealthOverviewResponse['suggestions'][number]) {
    this.db
      .prepare(
        'INSERT INTO suggestion_state VALUES(?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET payload=excluded.payload',
      )
      .run(owner, value.id, JSON.stringify(value));
  }
  clearPersonalization(owner: string) {
    this.db.prepare('DELETE FROM suggestion_state WHERE owner_id=?').run(owner);
    this.db
      .prepare('DELETE FROM commands WHERE owner_id=? AND kind LIKE ?')
      .run(owner, 'suggestion:%');
    this.db.prepare('DELETE FROM generation_jobs WHERE owner_id=?').run(owner);
  }
  removeConversation(store: DemoStore, conversationId: string) {
    const owner = store.ownerId;
    return this.atomic(store, () => {
      const row = this.db
        .prepare('SELECT deleted FROM conversations WHERE owner_id=? AND id=?')
        .get(owner, conversationId);
      if (!row) fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found.');
      if (row.deleted) {
        const report = this.overview(owner);
        return {
          deletedId: conversationId,
          sourceRevision: report.sourceRevision,
          snapshotRevision: report.snapshotRevision,
        };
      }
      this.interruptOwner(owner);
      const deletedIds = new Set(this.allEntries(owner, conversationId).map((entry) => entry.id));
      const affected = new Set(deletedIds);
      for (const sourceId of affected)
        for (const edge of this.db
          .prepare('SELECT target_id FROM source_edges WHERE owner_id=? AND source_id=?')
          .all(owner, sourceId))
          affected.add(String(edge.target_id));
      for (const entry of this.allEntries(owner)) {
        if (!affected.has(entry.id) || entry.conversationId === conversationId) continue;
        if (entry.kind === 'assistant')
          this.writeEntry(owner, {
            ...entry,
            text: '',
            translation: null,
            suggestions: [],
            sourceRefs: [],
          });
        else if (entry.kind === 'user' && entry.origin === 'suggestion_action')
          this.writeEntry(owner, { ...entry, text: '', sourceRefs: [] });
        else if (entry.kind === 'handoff')
          this.writeEntry(owner, { ...entry, summary: '', ticket: null });
      }
      for (const draft of store.schedule.drafts) {
        if (draft.status !== 'draft') continue;
        if (draft.conversationId === conversationId) {
          draft.status = 'abandoned';
          draft.fields = {};
        } else if ((store.draftSources.get(draft.id) ?? []).some((ref) => affected.has(ref))) {
          for (const [key, value] of Object.entries(draft.fields))
            if (value.source === 'conversation') delete draft.fields[key];
          store.draftProgress.set(draft.id, 1);
        }
      }
      for (const submission of store.submissions.values())
        if (submission.conversationId === conversationId) submission.conversationId = null;
      this.db
        .prepare('DELETE FROM entries WHERE owner_id=? AND conversation_id=?')
        .run(owner, conversationId);
      this.db
        .prepare('DELETE FROM turns WHERE owner_id=? AND conversation_id=?')
        .run(owner, conversationId);
      this.db
        .prepare('UPDATE conversations SET deleted=1,payload=NULL WHERE owner_id=? AND id=?')
        .run(owner, conversationId);
      for (const suggestion of this.states(owner))
        if (suggestion.sourceRefs.some((ref) => affected.has(ref.messageId))) {
          this.db
            .prepare('DELETE FROM suggestion_state WHERE owner_id=? AND id=?')
            .run(owner, suggestion.id);
          this.db
            .prepare('DELETE FROM commands WHERE owner_id=? AND kind=?')
            .run(owner, `suggestion:${suggestion.id}`);
        }
      this.invalidate(owner);
      const report = this.overview(owner);
      return {
        deletedId: conversationId,
        sourceRevision: report.sourceRevision,
        snapshotRevision: report.snapshotRevision,
      };
    });
  }
  setTurnEventIndex(owner: string, turn: Turn) {
    this.db
      .prepare('UPDATE turns SET event_index=event_index+1 WHERE owner_id=? AND id=?')
      .run(owner, turn.id);
    return this.turn(owner, turn.conversationId, turn.id).eventIndex;
  }
  recordEvent(
    store: DemoStore,
    turn: Turn,
    event: ChatEvent,
    sources: SourceRef[],
    at: string,
  ): string | null {
    const owner = store.ownerId;
    return this.atomic(store, () => {
      this.assertRunning(owner, turn);
      const existing = this.allEntries(owner, turn.conversationId);
      const base = {
        id: id('entry'),
        conversationId: turn.conversationId,
        turnId: turn.id,
        order: this.nextOrder(owner, turn.conversationId),
        createdAt: at,
      };
      let entry: ConversationEntry | null = null;
      switch (event.type) {
        case 'message':
          entry = {
            ...base,
            id: event.id,
            kind: 'assistant',
            text: event.text,
            translation: event.translation,
            suggestions: event.suggestions,
            sourceRefs: sources,
          };
          break;
        case 'tool_status': {
          const prior = existing.find((item) => item.id === event.id);
          entry = {
            ...base,
            ...(prior ?? {}),
            id: event.id,
            kind: 'tool',
            tool: event.tool,
            label: event.label,
            status: event.status,
          };
          break;
        }
        case 'consent_request':
          entry = {
            ...base,
            kind: 'consent',
            consentId: event.request.id,
            dataLabel: event.request.dataLabel,
            purpose: event.request.purpose,
            benefit: event.request.benefit,
            sensitive: event.request.sensitive,
            status: 'pending',
            scope: null,
          };
          break;
        case 'consent_resolved': {
          const prior = existing.find(
            (item) => item.kind === 'consent' && item.consentId === event.requestId,
          );
          const decision = store.consentDecisions.get(event.requestId);
          if (prior?.kind === 'consent')
            entry = {
              ...prior,
              status: decision === 'deny' ? 'denied' : 'granted',
              scope: decision === 'session' || decision === 'always' ? decision : null,
            };
          break;
        }
        case 'wizard_open':
        case 'wizard_prefill':
          entry = {
            ...base,
            kind: 'wizard',
            draftId: event.draft.id,
            mode: event.type === 'wizard_open' ? 'open' : 'update',
            changed: event.type === 'wizard_prefill' ? event.changed : [],
          };
          break;
        case 'receipt':
          entry = { ...base, kind: 'receipt', receiptId: event.receipt.id };
          break;
        case 'action_done':
          entry = { ...base, kind: 'booking', bookingId: event.booking.id };
          break;
        case 'safety_alert':
          entry = { ...base, kind: 'safety', message: event.message, resources: event.resources };
          break;
        case 'handoff':
          entry = { ...base, kind: 'handoff', summary: event.summary, ticket: event.ticket };
          break;
        case 'error':
          entry = { ...base, kind: 'error', message: event.message, retryable: true };
          break;
      }
      if (entry)
        this.writeEntry(
          owner,
          entry,
          entry.kind === 'assistant' || entry.kind === 'handoff' ? sources : [],
        );
      return entry?.id ?? null;
    });
  }
  initialSuggestionMessage(): StartSuggestionResponse['initialMessage'] {
    return {
      en: 'Please help me prepare a GP consultation about the health concern I previously reported.',
      zh: '请帮我为之前提到的健康问题准备一次 GP 咨询。',
    };
  }
}
