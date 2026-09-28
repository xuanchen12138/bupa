import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiErrorSchema,
  HealthResponseSchema,
  ProfileResponseSchema,
  ScheduleSchema,
} from '@bupa/contracts';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDemoStore } from '../src/store.js';

test('read endpoints satisfy the shared frontend contracts', async () => {
  const app = createApp();
  for (const [path, schema] of [
    ['/health', HealthResponseSchema],
    ['/profile', ProfileResponseSchema],
    ['/schedule', ScheduleSchema],
  ] as const) {
    const response = await app.request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(schema.safeParse(await response.json()).success, true, path);
  }
});

test('a nonexistent draft cannot create a booking or alter the schedule', async () => {
  const app = createApp();
  const response = await app.request('/wizards/demo/submit', { method: 'POST' });
  assert.equal(response.status, 404);
  assert.equal(ApiErrorSchema.parse(await response.json()).error.code, 'DRAFT_NOT_FOUND');
  const schedule = ScheduleSchema.parse(await (await app.request('/schedule')).json());
  assert.equal(schedule.bookings.length, 0);
});

test('fixtures keep voluntary fields off and stores do not share mutable state', () => {
  const first = createDemoStore();
  const second = createDemoStore();
  assert.equal(first.profile.member.fields.postcode.permission, 'off');
  assert.equal(first.profile.member.fields.preferredLanguage.permission, 'off');
  const originalName = second.profile.member.fields.name.value;
  first.profile.member.fields.name.value = 'Changed';
  assert.equal(second.profile.member.fields.name.value, originalName);
});

test('demo-only config rejects unsupported live mode and invalid ports', () => {
  assert.equal(readConfig({}).DEMO_MODE, 'true');
  assert.throws(() => readConfig({ DEMO_MODE: 'false' }));
  assert.throws(() => readConfig({ PORT: '0' }));
  assert.throws(() => readConfig({ PORT: '70000' }));
});
