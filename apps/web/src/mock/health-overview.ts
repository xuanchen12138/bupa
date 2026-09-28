import type {
  Conversation,
  ConversationEntry,
  HealthFact,
  HealthFactState,
  HealthOverviewResponse,
  HealthSuggestion,
  HealthSuggestionAction,
  LocalizedText,
  SourceRef,
} from '@bupa/contracts';
import {
  type HistoryState,
  getConversation,
  isDeleted,
  userReports,
} from './history-repository.ts';

/**
 * Deterministic health overview for the demo.
 *
 * This is the phase-1 stand-in for the server's structured extraction. It only understands the
 * scenario the demo needs (a member's own arm injury and later updates about it) and says
 * "unknown" for everything else. It never diagnoses, scores or infers a current condition: every
 * fact is a restatement of what the member typed, with a link to the message.
 */

type UserEntry = Extract<ConversationEntry, { kind: 'user' }>;

/* ------------------------------------------------------------- patterns */
const ARM = /胳膊|手臂|手肘|手腕|前臂|\b(arm|elbow|wrist|forearm)s?\b/i;
const INJURY =
  /受伤|伤到|伤了|摔|骨折|扭|脱臼|\b(injur\w*|hurt|broke\w*|fractur\w*|sprain\w*|dislocat\w*)\b/i;
const SEVERE = /严重|很重|厉害|\b(serious\w*|severe\w*|really bad|badly)\b/i;
const FIRST_PERSON = /我|\b(i|i've|i'm|my|me|myself)\b/i;
const NEGATION =
  /没有?受伤|没伤|不是受伤|并没有|\b(not|never|n't|didn't|haven't|hasn't|isn't|wasn't)\s+(been\s+)?(injured|hurt|broken)\b|\bno injury\b/i;
const THIRD_PARTY =
  /朋友|同学|室友|家人|妈妈|爸爸|父母|爷爷|奶奶|哥哥|姐姐|弟弟|妹妹|男朋友|女朋友|老公|老婆|孩子|\bmy (friend|mate|roommate|flatmate|classmate|mum|mom|dad|mother|father|brother|sister|partner|husband|wife|son|daughter|kid)\b|\b(his|her|their)\s+(arm|elbow|wrist)\b/i;
const HYPOTHETICAL =
  /假如|要是|万一|如果[^。？!?]*(怎么办|会怎样|能报|报销|保障|包不包)|\b(what if|if i|hypothetically|in case i|suppose i|should i ever)\b/i;
const QUESTION_ONLY =
  /^(什么是|什么叫|请问|怎么|如何|能不能|可以)|保障|报销|\b(what is|what's|how do|how does|does (my|the)|is (the|an?)|can i|am i covered)\b/i;

const IMPROVING =
  /好一些|好一点|好点了|好多了|好转|有所好转|(但|还)(是)?(有点|有些|一点)?(疼|痛|不舒服|不适|酸|僵)|\b(better|improv\w*)\b[^.!?]*\b(but|still)\b|\bstill (a bit |a little |slightly |kind of |quite )?(sore|uncomfortable|tender|stiff|weak)\b|\b(somewhat|a bit|a little|slightly|getting) better\b/i;
const RESOLVED =
  /已经好了|完全好了|全好了|都好了|恢复了|已经恢复|痊愈|没事了|不疼了|不痛了|没问题了|\b(recovered|all better|fully healed|healed|back to normal|fine now|no longer hurts|completely fine|all good now|totally fine|feels normal)\b/i;
const ONGOING =
  /还是(很)?(疼|痛|不舒服)|仍然|仍旧|还没好|没有好转|没好转|更(疼|痛|严重)|恶化|越来越|担心|不放心|害怕|\b(still hurts|still painful|still sore|not better|no better|worse|worried|concerned|hasn't improved|not improving|not improved|still worried|still bad|isn't better)\b/i;
/** Words that make a message in a source conversation count as an update about the topic. */
const HEALTH_WORDS =
  /恢复|痊愈|伤|疼|痛|不舒服|不适|肿|好转|好一些|好一点|好多了|没事了|\b(recover\w*|heal\w*|hurt\w*|pain\w*|sore|injur\w*|swollen|better|worse|bothers?)\b/i;
const CORRECTION =
  /说错了|不是我|那是(我的?)?(朋友|同学|室友)|搞错了|\b(i was wrong|that was my (friend|mate)|not me|it wasn't me|correction:|i meant)\b/i;

export type StatusUpdate = Exclude<HealthFactState, 'unknown'> | 'correction' | null;

/**
 * Classifies a later message about a known topic. Order matters: "better but still sore" is
 * improving, not resolved, and a correction beats everything.
 */
export function classifyStatusUpdate(text: string): StatusUpdate {
  if (CORRECTION.test(text)) return 'correction';
  if (IMPROVING.test(text)) return 'reported_improving';
  if (RESOLVED.test(text)) return 'reported_resolved';
  if (ONGOING.test(text)) return 'reported_ongoing';
  return null;
}

/** True when the member reports their own arm injury, not a friend's, a hypothetical or a denial. */
export function isOwnArmInjuryReport(text: string) {
  if (!ARM.test(text) || !INJURY.test(text)) return false;
  if (NEGATION.test(text) || THIRD_PARTY.test(text) || HYPOTHETICAL.test(text)) return false;
  if (!FIRST_PERSON.test(text)) return false;
  // A pure cover question ("does my cover pay if I injure my arm") is not a report.
  if (
    QUESTION_ONLY.test(text) &&
    !/受伤了|伤了|\b(injured|hurt|broke|fractured|sprained)\b/i.test(text)
  )
    return false;
  return true;
}

export function mentionsArm(text: string) {
  return ARM.test(text);
}

/* ---------------------------------------------------------------- facts */
const MERGE_WINDOW_DAYS = 30;
const DAY = 86_400_000;

function toRef(entry: UserEntry): SourceRef {
  return { conversationId: entry.conversationId, messageId: entry.id, reportedAt: entry.createdAt };
}

function daysBetween(fromIso: string, to: Date) {
  const from = new Date(fromIso);
  from.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - from.getTime()) / DAY);
}

function whenPhrase(iso: string, now: Date): LocalizedText {
  const days = daysBetween(iso, now);
  if (days <= 0) return { en: 'today', zh: '今天' };
  if (days === 1) return { en: 'yesterday', zh: '昨天' };
  if (days >= 13 && days <= 15) return { en: 'about two weeks ago', zh: '约两周前' };
  if (days >= 6 && days <= 8) return { en: 'about a week ago', zh: '约一周前' };
  if (days >= 28 && days <= 31) return { en: 'about a month ago', zh: '约一个月前' };
  return { en: `${days} days ago`, zh: `${days} 天前` };
}

interface FactDraft {
  topicKey: string;
  firstReportedAt: string;
  lastReportedAt: string;
  severe: boolean;
  state: HealthFactState;
  stateReportedAt: string | null;
  sources: SourceRef[];
  conversationIds: Set<string>;
  withdrawn: boolean;
}

/**
 * Builds facts from the member's own messages, oldest first. Only the arm-injury topic is
 * understood in phase 1; anything else yields no fact rather than a guess.
 */
export function extractFacts(reports: UserEntry[], now: Date): HealthFact[] {
  const drafts: FactDraft[] = [];
  const ordered = [...reports].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  for (const entry of ordered) {
    const text = entry.text;
    // A later message is about an open item when it names the arm, or when it sits in a
    // conversation that already reported the item and talks about health at all.
    const open = drafts.find(
      (draft) =>
        !draft.withdrawn &&
        (ARM.test(text) ||
          (draft.conversationIds.has(entry.conversationId) && HEALTH_WORDS.test(text))) &&
        daysBetween(draft.lastReportedAt, new Date(entry.createdAt)) <= MERGE_WINDOW_DAYS,
    );

    if (isOwnArmInjuryReport(text) && (!open || open.state === 'reported_resolved')) {
      drafts.push({
        topicKey: `arm_injury:${entry.id}`,
        firstReportedAt: entry.createdAt,
        lastReportedAt: entry.createdAt,
        severe: SEVERE.test(text),
        state: 'unknown',
        stateReportedAt: null,
        sources: [toRef(entry)],
        conversationIds: new Set([entry.conversationId]),
        withdrawn: false,
      });
      continue;
    }

    if (!open) continue;
    const update = classifyStatusUpdate(text);
    if (!update) continue;
    if (update === 'correction') {
      // The member says it was not about them: withdraw the item instead of keeping a claim.
      open.withdrawn = true;
      continue;
    }
    open.state = update;
    open.stateReportedAt = entry.createdAt;
    open.lastReportedAt = entry.createdAt;
    open.sources.push(toRef(entry));
    open.conversationIds.add(entry.conversationId);
  }

  return drafts.filter((draft) => !draft.withdrawn).map((draft) => toFact(draft, now));
}

function toFact(draft: FactDraft, now: Date): HealthFact {
  const first = draft.sources[0]!;
  const when = whenPhrase(first.reportedAt, now);
  const base: LocalizedText = {
    en: `You mentioned an arm injury ${when.en}${draft.severe ? ' and described it as serious' : ''}.`,
    zh: `你在${when.zh}提到手臂受伤${draft.severe ? '，并描述伤势较重' : ''}。`,
  };
  const since = draft.stateReportedAt ? whenPhrase(draft.stateReportedAt, now) : null;
  const status: Record<HealthFactState, LocalizedText> = {
    unknown: {
      en: 'We have not received an update from you on how it is recovering.',
      zh: '我们还没有收到你最近的恢复情况更新。',
    },
    reported_ongoing: {
      en: `${cap(since?.en ?? '')} you said it still bothers you or you are still worried.`,
      zh: `你在${since?.zh ?? ''}表示仍有不适或仍在担心。`,
    },
    reported_improving: {
      en: `${cap(since?.en ?? '')} you said it was better but still uncomfortable.`,
      zh: `你在${since?.zh ?? ''}表示有所好转，但仍有不适。`,
    },
    reported_resolved: {
      en: `${cap(since?.en ?? '')} you said it had recovered.`,
      zh: `你在${since?.zh ?? ''}表示已经恢复。`,
    },
  };
  return {
    id: `fact-${draft.topicKey}`,
    topicKey: draft.topicKey,
    title: { en: 'Arm injury', zh: '手臂受伤' },
    summary: {
      en: `${base.en} ${status[draft.state].en}`,
      zh: `${base.zh}${status[draft.state].zh}`,
    },
    evidenceType: 'user_reported',
    state: draft.state,
    firstReportedAt: draft.firstReportedAt,
    lastReportedAt: draft.lastReportedAt,
    // The member said the arm "is injured", not when it happened, so the date stays unknown.
    occurredAt: { value: null, precision: 'unknown' },
    sources: draft.sources,
  };
}

function cap(text: string) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/* ---------------------------------------------------------- suggestions */
/** Persisted per dedupeKey: the member's decisions and the follow-up they started. */
export interface SuggestionRecord {
  dedupeKey: string;
  dismissedAt: string | null;
  followUpConversationId: string | null;
  bookingId: string | null;
  /** How many times "prepare a booking" was started; feeds the idempotent clientMessageId. */
  startCount: number;
}

export function suggestionId(topicKey: string, action: HealthSuggestionAction) {
  return `hs-${topicKey}:${action}`;
}

export function buildSuggestions(
  facts: HealthFact[],
  records: Record<string, SuggestionRecord>,
  history: HistoryState,
  bookings: Array<{ id: string; status: 'confirmed' | 'cancelled' }>,
): HealthSuggestion[] {
  const suggestions: HealthSuggestion[] = [];
  for (const fact of facts) {
    const sourceConversation = fact.sources[0]!.conversationId;
    const resolved = fact.state === 'reported_resolved';

    const stateFor = (action: HealthSuggestionAction) => {
      const key = suggestionId(fact.topicKey, action);
      const record = records[key];
      const followUp =
        record?.followUpConversationId && !isDeleted(history, record.followUpConversationId)
          ? getConversation(history, record.followUpConversationId)
          : null;
      const booking = record?.bookingId
        ? bookings.find((candidate) => candidate.id === record.bookingId)
        : undefined;
      let state: HealthSuggestion['state'] = 'available';
      if (booking?.status === 'confirmed') state = 'booked';
      else if (booking?.status === 'cancelled') state = 'cancelled';
      else if (record?.dismissedAt) state = 'dismissed';
      else if (followUp) state = 'in_progress';
      return { key, state, followUp, booking };
    };
    const gpArranged = stateFor('prepare_gp_booking').state === 'booked';

    for (const action of ['update_status', 'prepare_gp_booking'] as const) {
      const { key, state, followUp, booking } = stateFor(action);

      // A recovered arm needs no further prompting; keep only the record of an arranged visit.
      if (resolved && state !== 'booked') continue;
      // The "how is it now" prompt is pointless once a visit is arranged.
      if (action === 'update_status' && gpArranged) continue;

      suggestions.push({
        id: key,
        dedupeKey: key,
        factIds: [fact.id],
        sourceRefs: fact.sources,
        ...copyFor(action, fact, sourceConversation),
        action,
        state,
        followUpConversationId: followUp?.id ?? null,
        bookingId: booking?.id ?? null,
      });
    }
  }
  return suggestions;
}

function copyFor(
  action: HealthSuggestionAction,
  fact: HealthFact,
  _sourceConversation: string,
): Pick<HealthSuggestion, 'title' | 'body' | 'reason'> {
  const improving = fact.state === 'reported_improving';
  const ongoing = fact.state === 'reported_ongoing';
  const reason: LocalizedText =
    fact.state === 'unknown'
      ? {
          en: 'Because you mentioned an arm injury in this conversation and have not updated us since.',
          zh: '因为你在这段对话中提到过手臂受伤，之后没有更新近况。',
        }
      : improving
        ? {
            en: 'Because you said the arm was better but still uncomfortable.',
            zh: '因为你表示手臂有所好转，但仍有不适。',
          }
        : {
            en: 'Because you said the arm still bothers you.',
            zh: '因为你表示手臂仍有不适。',
          };
  if (action === 'update_status') {
    return {
      title: { en: 'How is your arm now?', zh: '更新手臂恢复情况' },
      body: {
        en: 'Tell us how it is—recovered, better but still uncomfortable, or still worried. The overview updates from your reply.',
        zh: '告诉我们现在怎么样了——已经恢复、好一些但仍不舒服，还是仍然担心。概览会随你的回复更新。',
      },
      reason,
    };
  }
  return {
    title: { en: 'Check the arm with a GP?', zh: '想和 GP 确认一下手臂的恢复情况吗？' },
    body: improving
      ? {
          en: 'If you would like a further opinion, I can prepare a GP booking for you to review and confirm.',
          zh: '如果想进一步咨询，我可以帮你准备一次 GP 预约，由你确认是否提交。',
        }
      : ongoing
        ? {
            en: 'Ongoing pain or swelling is worth having examined. I can prepare a GP booking for you to review and confirm.',
            zh: '持续的疼痛或肿胀值得让医生看看。我可以帮你准备一次 GP 预约，由你确认是否提交。',
          }
        : {
            en: 'I can prepare a GP booking for you to review and confirm—nothing is booked until you submit it.',
            zh: '我可以帮你准备一次 GP 预约，由你确认是否提交；提交前不会创建任何预约。',
          },
    reason,
  };
}

/* ------------------------------------------------------------- overview */
export interface OverviewInput {
  enabled: boolean;
  sourceRevision: number;
  snapshotRevision: number;
  generatedAt: string | null;
  facts: HealthFact[];
  records: Record<string, SuggestionRecord>;
  history: HistoryState;
  bookings: Array<{ id: string; status: 'confirmed' | 'cancelled' }>;
}

export function buildOverview(input: OverviewInput): HealthOverviewResponse {
  const base = {
    sourceRevision: input.sourceRevision,
    snapshotRevision: input.snapshotRevision,
    generationMode: 'scripted' as const,
    dataMode: 'fictional' as const,
    error: null,
  };
  if (!input.enabled) {
    return {
      ...base,
      status: 'disabled',
      generatedAt: null,
      summary: null,
      facts: [],
      suggestions: [],
    };
  }
  const facts = input.facts.slice(0, 3);
  if (!facts.length) {
    return {
      ...base,
      status: 'empty',
      generatedAt: input.generatedAt,
      summary: null,
      facts: [],
      suggestions: [],
    };
  }
  const suggestions = buildSuggestions(facts, input.records, input.history, input.bookings);
  const summary: LocalizedText =
    facts.length === 1
      ? facts[0]!.summary
      : {
          en: `From your conversations we noted ${facts.length} health matters you told us about.`,
          zh: `根据你的对话，我们整理了 ${facts.length} 项你提到过的健康关注事项。`,
        };
  return {
    ...base,
    status: 'ready',
    generatedAt: input.generatedAt,
    summary,
    facts,
    suggestions,
  };
}

/** Convenience for the service: facts from everything the member typed themselves. */
export function factsFromHistory(history: HistoryState, now: Date) {
  return extractFacts(userReports(history), now);
}

/** Which conversations currently support at least one fact. */
export function sourceConversationIds(facts: HealthFact[]) {
  return new Set(facts.flatMap((fact) => fact.sources.map((source) => source.conversationId)));
}

export type { Conversation };
