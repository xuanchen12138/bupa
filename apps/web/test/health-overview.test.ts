import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationEntry } from '@bupa/contracts';
import {
  classifyStatusUpdate,
  extractFacts,
  isOwnArmInjuryReport,
} from '../src/mock/health-overview.ts';

const now = new Date('2026-09-28T10:00:00');
let order = 0;
function report(text: string, at: string, conversationId = 'c1'): ConversationEntry {
  order += 1;
  return {
    kind: 'user',
    id: `m${order}`,
    conversationId,
    turnId: null,
    order,
    createdAt: at,
    text,
    clientMessageId: `cm${order}`,
    origin: 'user_input',
    sourceRefs: [],
  };
}

test('recognises the member’s own arm injury and nothing else', () => {
  assert.equal(isOwnArmInjuryReport('我的胳膊受伤了，我觉得伤得很严重。'), true);
  assert.equal(isOwnArmInjuryReport('I injured my arm and it feels serious.'), true);
  assert.equal(isOwnArmInjuryReport('我的朋友手臂受伤了'), false, 'third party');
  assert.equal(isOwnArmInjuryReport('假如手臂受伤了怎么办'), false, 'hypothetical');
  assert.equal(isOwnArmInjuryReport('我的手臂没有受伤'), false, 'negation');
  assert.equal(isOwnArmInjuryReport('What if I hurt my arm, is it covered?'), false);
  assert.equal(isOwnArmInjuryReport('我喉咙痛、低烧两天'), false, 'other topic');
});

test('status updates keep “better but still sore” apart from “recovered”', () => {
  assert.equal(classifyStatusUpdate('现在好一些了，但还是有点不舒服'), 'reported_improving');
  assert.equal(classifyStatusUpdate('It is better but still a bit sore'), 'reported_improving');
  assert.equal(classifyStatusUpdate('已经完全恢复了'), 'reported_resolved');
  assert.equal(classifyStatusUpdate('My arm has fully recovered'), 'reported_resolved');
  assert.equal(classifyStatusUpdate('还是很疼，有点担心'), 'reported_ongoing');
  assert.equal(classifyStatusUpdate('Still hurts and I am worried'), 'reported_ongoing');
  assert.equal(classifyStatusUpdate('上次说错了，那是朋友，不是我'), 'correction');
  assert.equal(classifyStatusUpdate('好的，谢谢'), null, 'filler is not an update');
  assert.equal(classifyStatusUpdate('急诊和 GP 有什么区别？'), null);
});

test('a single old report becomes one fact with unknown status and a source link', () => {
  const facts = extractFacts(
    [report('我的胳膊受伤了，我觉得伤得很严重。', '2026-09-14T20:14:00+10:00')],
    now,
  );
  assert.equal(facts.length, 1);
  const fact = facts[0]!;
  assert.equal(fact.state, 'unknown');
  assert.equal(fact.occurredAt.precision, 'unknown');
  assert.equal(fact.sources[0]?.messageId, 'm1');
  assert.match(fact.summary.zh, /约两周前提到手臂受伤，并描述伤势较重/);
  assert.match(fact.summary.zh, /还没有收到你最近的恢复情况更新/);
  assert.match(fact.summary.en, /about two weeks ago/);
});

test('later replies in the source conversation update the state without merging new injuries', () => {
  const base = [report('我的胳膊受伤了，我觉得伤得很严重。', '2026-09-14T20:14:00+10:00')];
  const improving = extractFacts(
    [
      ...base,
      report('关于之前提到的手臂受伤，现在好一些了，但还有点疼', '2026-09-28T09:00:00+10:00'),
    ],
    now,
  );
  assert.equal(improving[0]?.state, 'reported_improving');
  assert.equal(improving[0]?.sources.length, 2);

  const resolved = extractFacts(
    [...base, report('我的手臂已经完全恢复了', '2026-09-28T09:00:00+10:00', 'c2')],
    now,
  );
  assert.equal(resolved[0]?.state, 'reported_resolved');

  const filler = extractFacts([...base, report('好的，谢谢你', '2026-09-28T09:00:00+10:00')], now);
  assert.equal(filler[0]?.state, 'unknown', 'a thank-you does not change the state');

  const corrected = extractFacts(
    [...base, report('上次说错了，那是朋友的手臂，不是我', '2026-09-28T09:00:00+10:00')],
    now,
  );
  assert.equal(corrected.length, 0, 'a correction withdraws the item');

  const friend = extractFacts(
    [report('我的朋友手臂受伤了，怎么帮他', '2026-09-20T09:00:00+10:00')],
    now,
  );
  assert.equal(friend.length, 0);
});
