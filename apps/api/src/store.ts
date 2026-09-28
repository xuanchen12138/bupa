import { demoProfile, emptySchedule, demoProviders, demoCards } from '@bupa/contracts/fixtures';
import type {
  ConsentDecision,
  ConsentRequest,
  ProfileResponse,
  Provider,
  Receipt,
  Schedule,
} from '@bupa/contracts';

export interface SessionState {
  id: string;
  status: 'idle' | 'running' | 'awaiting_consent' | 'closed';
  grants: Set<string>;
  denied: Set<string>;
  createdAt: number;
  expiresAt: number;
  activeDraftId: string | null;
  activeChat: AbortController | null;
}
export interface DemoStore {
  ownerId: string;
  persistent: boolean;
  profile: ProfileResponse;
  schedule: Schedule;
  providers: Provider[];
  receipts: Receipt[];
  sessions: Map<string, SessionState>;
  consents: Map<string, ConsentRequest>;
  consentDecisions: Map<string, ConsentDecision>;
  consentReceipts: Map<string, string[]>;
  receiptSessions: Map<string, string>;
  consentWaiters: Map<string, Set<(decision: ConsentDecision) => void>>;
  draftSessions: Map<string, string>;
  draftProgress: Map<string, number>;
  draftSources: Map<string, string[]>;
  submissions: Map<string, { bookingId: string; receiptId: string; conversationId: string | null }>;
  clock: () => Date;
}
export function createDemoStore(
  clock: () => Date = () => new Date(),
  ownerId = 'demo-lin',
): DemoStore {
  return {
    ownerId,
    persistent: false,
    profile: structuredClone(demoProfile),
    schedule: { ...structuredClone(emptySchedule), cards: structuredClone(demoCards) },
    providers: demoProviders(clock()),
    receipts: [],
    sessions: new Map(),
    consents: new Map(),
    consentDecisions: new Map(),
    consentReceipts: new Map(),
    receiptSessions: new Map(),
    consentWaiters: new Map(),
    draftSessions: new Map(),
    draftProgress: new Map(),
    draftSources: new Map(),
    submissions: new Map(),
    clock,
  };
}
