import type { DemoStore, SessionState } from './store.js';
import { id } from './domain.js';
import { revokeField, resolveConsent } from './permissions.js';

export const SESSION_TTL = 30 * 60 * 1000;
export function createSession(store: DemoStore): SessionState {
  const session: SessionState = {
    id: id('session'),
    status: 'idle',
    grants: new Set(),
    denied: new Set(),
    createdAt: store.clock().getTime(),
    expiresAt: store.clock().getTime() + SESSION_TTL,
    activeDraftId: null,
    activeChat: null,
  };
  store.sessions.set(session.id, session);
  return session;
}
export function closeSession(store: DemoStore, session: SessionState) {
  session.activeChat?.abort();
  const ctx = { store, session };
  for (const field of [...session.grants]) revokeField(ctx, field, session.id);
  for (const request of store.consents.values()) {
    if (request.sessionId === session.id && request.status === 'pending')
      resolveConsent(ctx, request.id, 'deny');
  }
  session.status = 'closed';
  session.grants.clear();
  session.denied.clear();
  session.activeDraftId = null;
  for (const draft of store.schedule.drafts) {
    if (store.draftSessions.get(draft.id) === session.id && draft.status === 'draft') {
      // Do not retain session-only prefill values or unsubmitted symptom text after a session ends.
      draft.fields = {};
      draft.status = 'abandoned';
    }
  }
}
export function expireSessions(store: DemoStore) {
  for (const session of store.sessions.values()) {
    if (session.status !== 'closed' && session.expiresAt <= store.clock().getTime())
      closeSession(store, session);
  }
}
