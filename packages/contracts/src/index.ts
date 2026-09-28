// Shared contracts for web, api and the demo fixtures.
// `core.ts` holds the 0.2.0 shapes (profile, cover, wizard, bookings, chat events).
// `conversations.ts` and `personalization.ts` add the 0.3.0 persisted-history and
// health-overview contracts. They import from core, never the other way round, so the
// package has no import cycles.
export * from './core.js';
export * from './conversations.js';
export * from './personalization.js';
