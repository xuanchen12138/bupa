import {
  CoverSchema,
  ProviderSearchResultSchema,
  type ProviderSearch,
  type ServiceType,
} from '@bupa/contracts';
import { canUse, fail, type BackendContext } from './domain.js';

export function getCover(ctx: BackendContext, service: ServiceType) {
  return (
    ctx.store.profile.covers.find((entry) => entry.service === service) ??
    CoverSchema.parse({
      service,
      status: 'needs_confirmation',
      outOfPocket: null,
      sourceLabel: 'Demo / 演示数据',
      sourceUrl: null,
      disclaimer: 'Demo only; cover needs confirmation / 仅为演示，保障需确认',
      demo: true,
    })
  );
}
export function findProviders(ctx: BackendContext, search: ProviderSearch, manual = false) {
  // Manual entry is limited to a value explicitly saved by this user in their own draft.
  // The model tool never enables this exception or obtains access to an unauthorized Profile value.
  const userEntered = (field: string, value: string) =>
    manual &&
    ctx.store.schedule.drafts.some(
      (draft) =>
        draft.status === 'draft' &&
        ctx.store.draftSessions.get(draft.id) === ctx.session.id &&
        draft.fields[field]?.source === 'user' &&
        draft.fields[field]?.value === value,
    );
  if (search.postcode && !/^\d{4}$/.test(search.postcode))
    fail(400, 'INVALID_POSTCODE', 'Enter a four-digit postcode.');
  if (search.postcode && !canUse(ctx, 'postcode') && !userEntered('postcode', search.postcode))
    fail(
      403,
      'CONSENT_REQUIRED',
      'Allow postcode use first, enter an area in your draft, or leave it empty for telehealth.',
    );
  if (
    search.language &&
    !canUse(ctx, 'preferredLanguage') &&
    !userEntered('language', search.language)
  )
    fail(
      403,
      'CONSENT_REQUIRED',
      'Allow preferred language use first, enter it in your draft, or omit this filter.',
    );
  if (search.service === 'mental_health' && !canUse(ctx, 'mentalHealthNeed'))
    fail(403, 'CONSENT_REQUIRED', 'Mental health support requires separate session consent.');
  const onlineOnly = search.telehealthOnly || !search.postcode || search.service === 'telehealth';
  const providers = ctx.store.providers
    .filter((provider) => {
      const serviceMatch =
        provider.service === search.service ||
        (search.service === 'gp' && provider.service === 'telehealth');
      return serviceMatch && (!onlineOnly || provider.telehealth);
    })
    .map((provider) => ({
      ...structuredClone(provider),
      slots: provider.slots.filter(
        (slot) =>
          new Date(slot.startsAt).getTime() > ctx.store.clock().getTime() &&
          !ctx.store.schedule.bookings.some(
            (booking) =>
              booking.status === 'confirmed' &&
              booking.providerId === provider.id &&
              booking.slot.id === slot.id,
          ),
      ),
      reason: {
        en: 'Fictional demo option, ranked by your permitted filters.',
        zh: '虚构演示选项，根据已授权的筛选条件排序。',
      },
    }))
    .sort((a, b) => {
      if (search.language) {
        const language =
          Number(b.languages.includes(search.language)) -
          Number(a.languages.includes(search.language));
        if (language) return language;
      }
      const feeA = a.outOfPocket?.max ?? Infinity,
        feeB = b.outOfPocket?.max ?? Infinity;
      if (feeA !== feeB) return feeA < feeB ? -1 : 1;
      const distanceA = a.distanceKm ?? Infinity,
        distanceB = b.distanceKm ?? Infinity;
      if (distanceA !== distanceB) return distanceA < distanceB ? -1 : 1;
      return Number(b.relationship === 'bupa_owned') - Number(a.relationship === 'bupa_owned');
    })
    .slice(0, 3);
  return ProviderSearchResultSchema.parse({
    providers,
    rankingNote: {
      en: 'Demo distances and fees are fictional. Ranked by permitted language, maximum estimated fee, distance, then disclosed Bupa ownership as a tie-breaker. No postcode: telehealth only.',
      zh: '距离和费用均为虚构演示数据。依次按已授权语言、最高估算费用、距离排序，同等条件优先标明的 Bupa 自有服务。没有邮编时仅显示远程选项。',
    },
  });
}
