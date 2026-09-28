import {
  ConsentRequestSchema,
  ProfileFieldNameSchema,
  ReceiptSchema,
  type ConsentDecision,
  type ConsentRequest,
  type Permission,
  type ProfileFieldName,
} from '@bupa/contracts';
import { bookingFields } from '@bupa/contracts/wizard';
import { fail, id, now, type BackendContext } from './domain.js';

const fieldLabels: Record<string, string> = {
  name: 'Name / 姓名',
  memberNumber: 'Member number / 会员号',
  phone: 'Phone / 电话',
  dateOfBirth: 'Date of birth / 出生日期',
  email: 'Email / 邮箱',
  address: 'Address / 地址',
  emergencyContact: 'Emergency contact / 紧急联系人',
  postcode: 'Postcode / 邮编',
  preferredLanguage: 'Preferred language / 首选语言',
  interpreter: 'Interpreter / 口译偏好',
  consultPreference: 'Consultation preference / 就诊方式',
  reminderChannel: 'Reminder channel / 提醒方式',
  needCategory: 'Need category / 需求类别',
  mentalHealthNeed: 'Mental health support category / 心理支持类别',
};
const excludedUses = [
  'Not used for pricing, claim assessment or marketing / 不用于定价、理赔审核或营销',
];

export function invalidateField(ctx: BackendContext, field: string, onlySession?: string) {
  for (const draft of ctx.store.schedule.drafts) {
    if (
      draft.status !== 'draft' ||
      (onlySession && ctx.store.draftSessions.get(draft.id) !== onlySession)
    )
      continue;
    let earliest = 6;
    for (const definition of bookingFields) {
      if (definition.consent !== field && definition.profileField !== field) continue;
      const value = draft.fields[definition.id];
      if (value && value.source !== 'user') {
        delete draft.fields[definition.id];
        earliest = Math.min(earliest, definition.step);
      }
    }
    if (
      ['postcode', 'preferredLanguage', 'consultPreference', 'mentalHealthNeed'].includes(field)
    ) {
      delete draft.fields.providerId;
      delete draft.fields.slotId;
      earliest = Math.min(earliest, 3);
    }
    if (field === 'mentalHealthNeed' && draft.fields.serviceType?.value === 'mental_health') {
      for (const key of ['serviceType', 'need', 'notes']) {
        if (draft.fields[key]?.source === 'conversation') delete draft.fields[key];
      }
      earliest = 1;
    }
    if (earliest < 6) {
      ctx.store.draftProgress.set(
        draft.id,
        Math.min(ctx.store.draftProgress.get(draft.id) ?? 1, earliest),
      );
      // Background permission changes do not advance a user's wizard.
      for (const definition of bookingFields) {
        if (definition.step >= earliest && draft.fields[definition.id])
          draft.fields[definition.id]!.confirmed = false;
      }
      draft.updatedAt = now(ctx);
    }
  }
}

export function revokeField(ctx: BackendContext, field: string, onlySession?: string) {
  const key = ProfileFieldNameSchema.safeParse(field);
  if (key.success) {
    const value = ctx.store.profile.member.fields[key.data];
    if (!onlySession || (value.permission === 'session' && value.sessionId === onlySession)) {
      value.permission = 'off';
      value.sessionId = null;
    }
  }
  for (const session of ctx.store.sessions.values()) {
    if (!onlySession || session.id === onlySession) session.grants.delete(field);
  }
  for (const receipt of ctx.store.receipts) {
    if (
      receipt.kind === 'data' &&
      receipt.status === 'active' &&
      receipt.fields.includes(field) &&
      (!onlySession ||
        (receipt.scope === 'session' && ctx.store.receiptSessions.get(receipt.id) === onlySession))
    )
      receipt.status = 'revoked';
  }
  invalidateField(ctx, field, onlySession);
}

export function grantField(
  ctx: BackendContext,
  field: string,
  permission: Exclude<Permission, 'off'>,
  request?: ConsentRequest,
) {
  const key = ProfileFieldNameSchema.safeParse(field);
  const wasAlways =
    key.success && ctx.store.profile.member.fields[key.data].permission === 'always';
  revokeField(ctx, field, permission === 'session' && !wasAlways ? ctx.session.id : undefined);
  if (key.success) {
    const entry = ctx.store.profile.member.fields[key.data];
    entry.permission = permission;
    entry.sessionId = permission === 'session' ? ctx.session.id : null;
  }
  if (permission === 'session') ctx.session.grants.add(field);
  ctx.session.denied.delete(field);
  if (key.success) {
    const raw = ctx.store.profile.member.fields[key.data].value;
    for (const draft of ctx.store.schedule.drafts) {
      if (draft.status !== 'draft' || ctx.store.draftSessions.get(draft.id) !== ctx.session.id)
        continue;
      for (const definition of bookingFields) {
        if (definition.profileField !== key.data) continue;
        const previous = draft.fields[definition.id];
        if (previous?.source === 'user' && previous.value !== null && previous.value !== '')
          continue;
        const value =
          definition.type === 'boolean'
            ? key.data === 'consultPreference'
              ? ['video', 'either'].includes(raw)
              : ['yes', 'true'].includes(raw)
            : raw || null;
        draft.fields[definition.id] = { value, source: 'profile', confirmed: false };
        draft.updatedAt = now(ctx);
      }
    }
  }
  const receipt = ReceiptSchema.parse({
    id: id('receipt'),
    kind: 'data',
    createdAt: now(ctx),
    summary: `Allowed ${fieldLabels[field] ?? field}`,
    purpose:
      request?.purpose ??
      'Use this field to prepare the requested member service / 用于准备你请求的会员服务',
    benefit:
      request?.benefit ??
      'Less repeated entry, with a revocable permission / 减少重复填写，可随时撤回',
    excludedUses,
    retention:
      permission === 'session'
        ? 'Until this session ends or permission is revoked / 会话结束或撤回时失效'
        : 'Until revoked / 直到撤回',
    scope: permission,
    status: 'active',
    fields: [field],
    bookingId: null,
    sensitive: request?.sensitive === true || field === 'mentalHealthNeed',
  });
  ctx.store.receipts.push(receipt);
  ctx.store.receiptSessions.set(receipt.id, ctx.session.id);
  return receipt;
}

export function setPermission(
  ctx: BackendContext,
  field: ProfileFieldName,
  permission: Permission,
) {
  if (permission === 'off') revokeField(ctx, field);
  else grantField(ctx, field, permission);
  return ctx.store.profile;
}

export function requestConsent(
  ctx: BackendContext,
  fields: string[],
  options: { sensitive?: boolean; wizardFieldId?: string | null } = {},
) {
  const unique = [...new Set(fields)];
  if (
    !unique.length ||
    unique.length > 13 ||
    unique.some((field) => !Object.hasOwn(fieldLabels, field))
  )
    fail(400, 'INVALID_FIELDS', 'Unknown or empty consent fields.');
  // Sensitive scope cannot be widened by a caller-supplied flag or UI text.
  const sensitive = unique.includes('mentalHealthNeed') || options.sensitive === true;
  const existing = [...ctx.store.consents.values()].find(
    (entry) =>
      entry.sessionId === ctx.session.id &&
      entry.status === 'pending' &&
      entry.sensitive === sensitive &&
      entry.fields.join('|') === unique.join('|'),
  );
  if (existing) return existing;
  const request = ConsentRequestSchema.parse({
    id: id('consent'),
    sessionId: ctx.session.id,
    fields: unique,
    sensitive,
    dataLabel: unique.map((field) => fieldLabels[field]).join(', '),
    purpose: sensitive
      ? 'Find requested mental health support / 查找你请求的心理支持服务'
      : 'Personalise the service you requested / 个性化你请求的服务',
    benefit: unique.includes('postcode')
      ? 'See nearby demo clinics / 查看附近的演示诊所'
      : 'Prepare relevant options without retyping / 准备合适选项，减少重复填写',
    excludedUses,
    retention: sensitive
      ? 'This session only / 仅本次会话'
      : 'This session, or until revoked if always allowed / 仅本次，或始终允许直到撤回',
    allowedScopes: sensitive ? ['session'] : ['session', 'always'],
    wizardFieldId: options.wizardFieldId ?? null,
    status: 'pending',
  });
  ctx.store.consents.set(request.id, request);
  return request;
}

export function resolveConsent(ctx: BackendContext, requestId: string, decision: ConsentDecision) {
  const request = ctx.store.consents.get(requestId);
  if (!request || request.sessionId !== ctx.session.id)
    fail(404, 'NOT_FOUND', 'Consent request not found.');
  const previous = ctx.store.consentDecisions.get(requestId);
  if (previous) {
    if (previous !== decision) fail(409, 'CONSENT_RESOLVED', 'This consent was already answered.');
    return request;
  }
  if (request.status !== 'pending')
    fail(409, 'CONSENT_EXPIRED', 'This consent request is no longer active.');
  if (decision !== 'deny' && !request.allowedScopes.includes(decision))
    fail(400, 'INVALID_SCOPE', 'This data is allowed for this session only.');
  const receiptIds: string[] = [];
  if (decision === 'deny') {
    for (const field of request.fields) ctx.session.denied.add(field);
    request.status = 'denied';
  } else {
    for (const field of request.fields)
      receiptIds.push(grantField(ctx, field, decision, request).id);
    request.status = 'granted';
  }
  ctx.store.consentDecisions.set(requestId, decision);
  ctx.store.consentReceipts.set(requestId, receiptIds);
  for (const notify of ctx.store.consentWaiters.get(requestId) ?? []) notify(decision);
  ctx.store.consentWaiters.delete(requestId);
  return request;
}

export function waitConsent(
  ctx: BackendContext,
  requestId: string,
  signal: AbortSignal,
  timeoutMs = 120_000,
): Promise<ConsentDecision> {
  const previous = ctx.store.consentDecisions.get(requestId);
  if (previous) return Promise.resolve(previous);
  return new Promise((resolve, reject) => {
    const request = ctx.store.consents.get(requestId);
    if (!request || request.sessionId !== ctx.session.id || request.status !== 'pending') {
      reject(new Error('Consent request expired.'));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const listeners = ctx.store.consentWaiters.get(requestId) ?? new Set();
    const clean = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      listeners.delete(complete);
      if (!listeners.size) ctx.store.consentWaiters.delete(requestId);
    };
    const complete = (decision: ConsentDecision) => {
      clean();
      resolve(decision);
    };
    const abort = () => {
      clean();
      if (request.status === 'pending') {
        request.status = 'denied';
        ctx.store.consentDecisions.set(requestId, 'deny');
      }
      reject(new Error('Consent request cancelled.'));
    };
    listeners.add(complete);
    ctx.store.consentWaiters.set(requestId, listeners);
    timer = setTimeout(() => {
      clean();
      resolveConsent(ctx, requestId, 'deny');
      resolve('deny');
    }, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function revokeReceipt(ctx: BackendContext, receiptId: string) {
  const receipt = ctx.store.receipts.find((entry) => entry.id === receiptId);
  if (!receipt) fail(404, 'NOT_FOUND', 'Receipt not found.');
  if (receipt.kind !== 'data')
    fail(
      409,
      'ACTION_RECEIPT',
      'Use the booking cancellation action; an action receipt is retained.',
    );
  if (receipt.status === 'active') {
    for (const field of receipt.fields)
      revokeField(
        ctx,
        field,
        receipt.scope === 'session' ? ctx.store.receiptSessions.get(receiptId) : undefined,
      );
    receipt.status = 'revoked';
  }
  return ctx.store.receipts;
}
