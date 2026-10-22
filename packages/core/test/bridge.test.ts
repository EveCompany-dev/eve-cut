import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BRIDGE_ERRORS,
  BridgeClient,
  type BridgeInfo,
  type ProgressParams,
} from '../src/bridge/index.js';
import { startBridgeServer, type BridgeServer } from '../../panel/src/bridge/server.js';
import type { PremiereAdapter, PremiereStatus } from '../../panel/src/premiere/adapter.js';

const STATUS: PremiereStatus = {
  appVersion: '26.0.0',
  projectPath: 'C:\\projetos\\4s.prproj',
  sequence: { name: 'Reels 4S', id: 'seq-1' },
};

const adapter: PremiereAdapter = {
  status: async () => STATUS,
  exportCaptionsSrt: async () => ({ result: 'No Error', sequence: 'Reels 4S', durationMs: 1 }),
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once('close', (code: number) => resolve(code));
  });
}

let dir: string;
let bridgeFile: string;
let server: BridgeServer | undefined;
let client: BridgeClient | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eve-cut-bridge-'));
  bridgeFile = join(dir, 'bridge.json');
});

afterEach(async () => {
  await client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function start(options: { helloTimeoutMs?: number } = {}): Promise<BridgeServer> {
  server = await startBridgeServer({ adapter, bridgeFile, port: 0, ...options });
  return server;
}

function readInfo(): BridgeInfo {
  return JSON.parse(readFileSync(bridgeFile, 'utf8')) as BridgeInfo;
}

describe('bridge server', () => {
  it('writes bridge.json with port and a 64 hex token, then answers premiere.status', async () => {
    const started = await start();
    const info = readInfo();

    expect(info.port).toBe(started.port);
    expect(info.token).toMatch(/^[0-9a-f]{64}$/);
    expect(info.pid).toBe(process.pid);
    expect(info.startedAt).not.toBe('');

    client = new BridgeClient({ bridgeFile, clientName: 'test/0.1.0' });
    await expect(client.call('premiere.status', null, { timeoutMs: 2000 })).resolves.toEqual(STATUS);
  });

  it('closes the connection when the token is wrong', async () => {
    await start();
    writeFileSync(bridgeFile, JSON.stringify({ ...readInfo(), token: 'f'.repeat(64) }));

    client = new BridgeClient({ bridgeFile });
    await expect(client.call('premiere.status', null, { timeoutMs: 2000 })).rejects.toMatchObject({
      code: BRIDGE_ERRORS.unauthorized,
    });
  });

  it('closes a connection that never sends hello', async () => {
    const started = await start({ helloTimeoutMs: 120 });
    const socket = new WebSocket(`ws://127.0.0.1:${started.port}`);

    await new Promise<void>((resolve) => socket.once('open', () => resolve()));
    await expect(waitForClose(socket)).resolves.toBe(1008);
  });

  it('refuses an upgrade that carries an Origin header', async () => {
    const started = await start();
    const socket = new WebSocket(`ws://127.0.0.1:${started.port}`, {
      headers: { Origin: 'http://evil.example' },
    });

    const error = await new Promise<Error>((resolve) => socket.once('error', resolve));

    expect(error.message).toContain('401');
    expect(socket.readyState).not.toBe(WebSocket.OPEN);
  });

  it('answers -32601 for an unknown method', async () => {
    await start();
    client = new BridgeClient({ bridgeFile });

    await expect(client.call('nope')).rejects.toMatchObject({
      code: BRIDGE_ERRORS.methodNotFound,
    });
  });

  it('times out a slow method with -32002', async () => {
    const started = await start();
    started.register('slow', async () => {
      await delay(200);
      return 'ok';
    });
    client = new BridgeClient({ bridgeFile });

    await expect(client.call('slow', null, { timeoutMs: 40 })).rejects.toMatchObject({
      code: BRIDGE_ERRORS.timeout,
    });
  });

  it('delivers progress notifications to onProgress', async () => {
    const started = await start();
    started.register('work', (_params, context) => {
      context.progress({ done: 1, total: 2, label: 'lote 1' });
      context.progress({ done: 2, total: 2, label: 'lote 2' });
      return { ok: true };
    });
    client = new BridgeClient({ bridgeFile });

    const updates: ProgressParams[] = [];
    await client.call('work', null, { onProgress: (progress) => updates.push(progress) });

    expect(updates.map(({ done, total, label }) => ({ done, total, label }))).toEqual([
      { done: 1, total: 2, label: 'lote 1' },
      { done: 2, total: 2, label: 'lote 2' },
    ]);
    expect(new Set(updates.map((update) => update.requestId)).size).toBe(1);
  });

  it('keeps working after the panel restarts with a new token', async () => {
    const first = await start();
    client = new BridgeClient({ bridgeFile });
    await expect(client.call('premiere.status', null, { timeoutMs: 2000 })).resolves.toEqual(STATUS);

    await first.close();
    server = undefined;
    await delay(50);

    const second = await start();
    await expect(client.call('premiere.status', null, { timeoutMs: 2000 })).resolves.toEqual(STATUS);
    expect(second.token).not.toBe(first.token);
  });

  it('does not resend a request whose connection dropped after it was sent', async () => {
    let calls = 0;
    const first = await start();
    first.register('apply', async () => {
      calls++;
      // The panel dies mid-request and comes back: running "apply" again could apply it twice.
      await first.close();
      const second = await start();
      second.register('apply', () => {
        calls++;
        return 'ok';
      });
      return new Promise(() => {});
    });
    client = new BridgeClient({ bridgeFile });

    await expect(client.call('apply', null, { timeoutMs: 2000 })).rejects.toMatchObject({
      code: BRIDGE_ERRORS.connectionClosed,
      sent: true,
    });
    await delay(50);
    expect(calls).toBe(1);
  });

  it('removes bridge.json on close when it still belongs to this panel', async () => {
    const started = await start();
    expect(existsSync(bridgeFile)).toBe(true);

    await started.close();
    server = undefined;

    expect(existsSync(bridgeFile)).toBe(false);
  });
});
