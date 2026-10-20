#!/usr/bin/env node
/**
 * Diagnóstico da ponte local: chama premiere.status e imprime o resultado.
 *
 * Plain JS on purpose: it runs with `node scripts/bridge-ping.mjs` right after `pnpm install`, without
 * a TypeScript build. Speaks the same protocol as packages/core/src/bridge: `hello` first, then the
 * method call, both JSON-RPC 2.0.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { win32 } from 'node:path';

const TIMEOUT_MS = 5000;
const CLIENT_NAME = 'bridge-ping/0.1.0';

const appData = process.env.APPDATA ?? win32.join(homedir(), 'AppData', 'Roaming');
const bridgeFile = win32.join(appData, 'eve-cut', 'bridge.json');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (typeof WebSocket === 'undefined') {
  fail('Este Node não tem WebSocket global. Use o Node 24.');
}

let info;
try {
  info = JSON.parse(readFileSync(bridgeFile, 'utf8'));
} catch {
  fail(`Não achei a ponte do eve-cut (${bridgeFile}). Abra o painel no Premiere.`);
}

const socket = new WebSocket(`ws://127.0.0.1:${info.port}`);
const timer = setTimeout(() => {
  fail('A ponte não respondeu em 5 s. O painel eve-cut está aberto no Premiere?');
}, TIMEOUT_MS);

socket.addEventListener('open', () => {
  socket.send(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'hello',
      params: { token: info.token, client: CLIENT_NAME },
    }),
  );
});

socket.addEventListener('message', (event) => {
  let message;
  try {
    message = JSON.parse(String(event.data));
  } catch {
    return;
  }

  if (message.id === 0) {
    if (message.error) fail(`A ponte recusou a conexão: ${message.error.message}`);
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'premiere.status' }));
    return;
  }

  if (message.id === 1) {
    if (message.error) fail(`premiere.status falhou: ${message.error.message}`);

    clearTimeout(timer);
    const status = message.result;
    const sequence = status.sequence ? status.sequence.name : 'sem sequência';
    console.log(`Premiere ${status.appVersion} · ${sequence}`);
    console.log(JSON.stringify(status, null, 2));
    process.exit(0);
  }
});

socket.addEventListener('error', () => {
  fail('Não consegui falar com a ponte. O painel eve-cut está aberto?');
});

socket.addEventListener('close', () => {
  fail('A ponte fechou a conexão antes da resposta.');
});
