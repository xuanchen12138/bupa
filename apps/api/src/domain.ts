import { randomUUID } from 'node:crypto';
import { ProfileFieldNameSchema } from '@bupa/contracts';
import type { DemoStore, SessionState } from './store.js';

export interface BackendContext {
  store: DemoStore;
  session: SessionState;
}
export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new DomainError(status, code, message);
}
export function id(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}
export function now(ctx: BackendContext) {
  return ctx.store.clock().toISOString();
}
export function canUse(ctx: BackendContext, field: string): boolean {
  if (ctx.session.status === 'closed' || ctx.session.expiresAt <= ctx.store.clock().getTime())
    return false;
  const name = ProfileFieldNameSchema.safeParse(field);
  return (
    (name.success && ctx.store.profile.member.fields[name.data].permission === 'always') ||
    ctx.session.grants.has(field)
  );
}
