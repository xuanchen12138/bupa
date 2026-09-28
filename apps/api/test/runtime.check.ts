import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ConversationSchema, ConversationMessagesResponseSchema } from '@bupa/contracts';

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = mkdtempSync(join(tmpdir(), 'bupa-runtime-'));
const database = join(directory, 'runtime.sqlite');
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert.ok(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>((done) => listener.close(() => done()));
const env = {
  ...process.env,
  HOST: '127.0.0.1',
  PORT: String(port),
  MODEL_MODE: 'scripted',
  HISTORY_SEED: 'false',
  DATABASE_PATH: database,
};
async function start() {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: apiRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (value: Buffer) => {
    output += value.toString();
  });
  child.stderr?.on('data', (value: Buffer) => {
    output += value.toString();
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('API startup failed: ' + output);
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health');
      if (response.ok) {
        const value = (await response.json()) as { storage: string; modelMode: string };
        assert.equal(value.storage, 'sqlite');
        assert.equal(value.modelMode, 'scripted');
        return child;
      }
    } catch {
      /* wait for listener */
    }
    await delay(100);
  }
  child.kill();
  throw new Error('API listener did not start.');
}
async function stop(child: ChildProcess) {
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
async function migrate() {
  const child = spawn(process.execPath, ['dist/migrate.js'], {
    cwd: apiRoot,
    env,
    windowsHide: true,
    stdio: 'pipe',
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, 'Standalone migration failed');
}
let child: ChildProcess | undefined;
try {
  await migrate();
  await migrate();
  child = await start();
  const base = 'http://127.0.0.1:' + port;
  const created = await fetch(base + '/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'runtime-only-fictional' }),
  });
  const conversation = ConversationSchema.parse(await created.json());
  const cookie = created.headers.get('set-cookie')!.split(';')[0]!;
  const response = await fetch(base + '/conversations/' + conversation.id + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ clientMessageId: 'runtime-message', message: 'Thanks', uiLocale: 'en' }),
  });
  assert.ok((await response.text()).includes('"type":"done"'));
  await stop(child);
  child = undefined;
  child = await start();
  const saved = ConversationMessagesResponseSchema.parse(
    await (await fetch(base + '/conversations/' + conversation.id + '/messages')).json(),
  );
  assert.equal(saved.conversation.latestTurn?.status, 'completed');
  assert.ok(saved.items.some((entry) => entry.kind === 'user' && entry.text === 'Thanks'));
  await stop(child);
  child = undefined;
  console.info(
    'Runtime check PASS: compiled server, TCP HTTP/SSE, idempotent migration and process restart persistence.',
  );
} finally {
  if (child && child.exitCode === null) await stop(child);
  assert.ok(directory.startsWith(join(tmpdir(), 'bupa-runtime-')));
  rmSync(directory, { recursive: true, force: true });
}
