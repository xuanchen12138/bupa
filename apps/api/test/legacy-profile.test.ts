import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository } from '../src/repository.js';
import { createApp } from '../src/app.js';
import { createDemoStore } from '../src/store.js';

const owner = 'demo-lin';
const clock = () => new Date('2030-06-03T00:00:00Z');
const emptyPreference = { value: '', permission: 'off', sessionId: null };
function savedBusiness(repo: Repository) {
  return String(
    repo.db.prepare('SELECT business FROM owners WHERE owner_id=?').get(owner)!.business,
  );
}
function writeBusiness(repo: Repository, business: unknown) {
  repo.db
    .prepare('UPDATE owners SET business=? WHERE owner_id=?')
    .run(JSON.stringify(business), owner);
}

test('API starts with a legacy profile and preserves saved business and conversation history', async (t) => {
  const repo = new Repository();
  t.after(() => repo.close());
  repo.loadOwner(owner, clock, true);
  const legacy = JSON.parse(savedBusiness(repo));
  delete legacy.profile.member.fields.preferredTime;
  delete legacy.profile.member.fields.travelDuration;
  legacy.profile.member.fields.name.value = 'Saved member';
  legacy.futureMetadata = { preserved: true };
  writeBusiness(repo, legacy);
  const history = repo.db.prepare('SELECT * FROM entries').all();
  const conversations = repo.db.prepare('SELECT * FROM conversations').all();
  const app = createApp(createDemoStore(clock), { repository: repo });
  const expected = structuredClone(legacy);
  expected.profile.member.fields.preferredTime = emptyPreference;
  expected.profile.member.fields.travelDuration = emptyPreference;
  assert.deepEqual(JSON.parse(savedBusiness(repo)), expected);
  assert.deepEqual(repo.db.prepare('SELECT * FROM entries').all(), history);
  assert.deepEqual(repo.db.prepare('SELECT * FROM conversations').all(), conversations);
  const upgraded = savedBusiness(repo);
  repo.loadOwner(owner, clock, true);
  assert.equal(savedBusiness(repo), upgraded);
  assert.equal((await app.request('/health')).status, 200);
});

test('partial legacy profiles keep existing preferences and permissions', (t) => {
  const repo = new Repository();
  t.after(() => repo.close());
  repo.loadOwner(owner, clock);
  const legacy = JSON.parse(savedBusiness(repo));
  const existing = {
    value: 'evening',
    permission: 'days90',
    sessionId: null,
    expiresAt: '2030-07-01T00:00:00Z',
  };
  legacy.profile.member.fields.preferredTime = existing;
  delete legacy.profile.member.fields.travelDuration;
  writeBusiness(repo, legacy);
  const restored = repo.loadOwner(owner, clock);
  assert.deepEqual(restored.profile.member.fields.preferredTime, existing);
  assert.deepEqual(restored.profile.member.fields.travelDuration, emptyPreference);
});

test('invalid existing profile data is rejected without overwriting the saved snapshot', (t) => {
  const repo = new Repository();
  t.after(() => repo.close());
  repo.loadOwner(owner, clock);
  const legacy = JSON.parse(savedBusiness(repo));
  delete legacy.profile.member.fields.travelDuration;
  legacy.profile.member.fields.preferredTime = null;
  writeBusiness(repo, legacy);
  const original = savedBusiness(repo);
  assert.throws(() => repo.loadOwner(owner, clock), { name: 'ZodError' });
  assert.equal(savedBusiness(repo), original);
});
