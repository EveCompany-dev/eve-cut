import { randomBytes } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';

import WebSocket, { WebSocketServer } from 'ws';

import {
  BRIDGE_ERRORS,
  JSON_RPC_VERSION,
  bridgeFilePath,
  isRpcRequest,
  writeBridgeInfo,
  type BridgeInfo,
  type HelloParams,
  type HelloResult,
  type ProgressUpdate,
  type RpcRequest,
} from '@eve-cut/core/bridge';

import type { PremiereAdapter } from '../premiere/adapter.js';

export const DEFAULT_BRIDGE_PORT = 47615;

const DEFAULT_HELLO_TIMEOUT_MS = 2_000;
const PANEL_VERSION = '0.1.0';

export interface BridgeContext {
  requestId: number;
  progress(update: ProgressUpdate): void;
}

export type BridgeHandler = (params: unknown, context: BridgeContext) => unknown | Promise<unknown>;

export interface BridgeServerOptions {
  adapter: PremiereAdapter;
  /** Defaults to `%APPDATA%\eve-cut\bridge.json`; tests point it at a temp folder. */
  bridgeFile?: string;
  /** Defaults to 47615; falls back to any free port when it is taken. */
  port?: number;
  helloTimeoutMs?: number;
}

export interface BridgeServer {
  readonly port: number;
  readonly token: string;
  readonly bridgeFile: string;
  register(name: string, handler: BridgeHandler): void;
  close(): Promise<void>;
}

/**
 * Servidor da ponte: só em 127.0.0.1, com token novo a cada abertura e `hello` obrigatório.
 *
 * Fica no painel, e não no mcp-server, porque o Node do CEP consegue escutar uma porta (T4). O
 * servidor não conhece o Premiere: fala com o `PremiereAdapter` recebido.
 */
export async function startBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
  const bridgeFile = options.bridgeFile ?? bridgeFilePath();
  const token = randomBytes(32).toString('hex');
  const helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;

  const handlers = new Map<string, BridgeHandler>();
  handlers.set('premiere.status', () => options.adapter.status());

  const wss = await listen(options.port ?? DEFAULT_BRIDGE_PORT);
  const port = serverPort(wss);

  const info: BridgeInfo = {
    port,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  writeBridgeInfo(info, bridgeFile);

  wss.on('connection', (socket) => {
    let authorized = false;
    const helloTimer = setTimeout(() => {
      socket.close(1008, 'hello timeout');
    }, helloTimeoutMs);

    socket.on('close', () => clearTimeout(helloTimer));

    socket.on('message', (data) => {
      void handleMessage(socket, data.toString()).catch((error: unknown) => {
        sendError(socket, null, BRIDGE_ERRORS.internal, errorMessage(error));
        socket.close(1011, 'internal error');
      });
    });

    async function handleMessage(socket: WebSocket, raw: string): Promise<void> {
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        socket.close(1007, 'invalid json');
        return;
      }

      if (!authorized) {
        if (!isHelloRequest(message, token)) {
          const id = isRpcRequest(message) ? message.id : null;
          sendError(socket, id, BRIDGE_ERRORS.unauthorized, 'Hello ausente ou token inválido');
          socket.close(1008, 'unauthorized');
          return;
        }

        authorized = true;
        clearTimeout(helloTimer);
        const hello: HelloResult = { ok: true, version: PANEL_VERSION };
        send(socket, { jsonrpc: JSON_RPC_VERSION, id: message.id, result: hello });
        return;
      }

      // Client notifications are not part of the protocol today.
      if (!isRpcRequest(message)) return;

      const handler = handlers.get(message.method);
      if (!handler) {
        sendError(
          socket,
          message.id,
          BRIDGE_ERRORS.methodNotFound,
          `Método desconhecido: ${message.method}`,
        );
        return;
      }

      const context: BridgeContext = {
        requestId: message.id,
        progress: (update) => {
          send(socket, {
            jsonrpc: JSON_RPC_VERSION,
            method: 'progress',
            params: { requestId: message.id, ...update },
          });
        },
      };

      try {
        const result = await handler(message.params ?? null, context);
        send(socket, { jsonrpc: JSON_RPC_VERSION, id: message.id, result });
      } catch (error) {
        sendError(socket, message.id, BRIDGE_ERRORS.internal, errorMessage(error));
      }
    }
  });

  let closed = false;

  return {
    port,
    token,
    bridgeFile,
    register(name, handler) {
      handlers.set(name, handler);
    },
    async close() {
      if (closed) return;
      closed = true;

      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      removeBridgeFile(bridgeFile, token);
    },
  };
}

async function listen(port: number): Promise<WebSocketServer> {
  try {
    return await listenAt(port);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    // Another panel (or another program) owns the default port: take any free one.
    return listenAt(0);
  }
}

function listenAt(port: number): Promise<WebSocketServer> {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    // Browsers always send Origin; Node clients (mcp-server, scripts) do not. Refusing Origin keeps
    // a web page from talking to the bridge even if it gets hold of the token file.
    verifyClient: (info: { origin: string }) => !info.origin,
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      wss.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      wss.off('error', onError);
      resolve(wss);
    };

    wss.once('error', onError);
    wss.once('listening', onListening);
  });
}

function serverPort(wss: WebSocketServer): number {
  const address = wss.address();
  if (address === null || typeof address === 'string') {
    throw new Error('A ponte subiu sem uma porta TCP');
  }
  return address.port;
}

function isHelloRequest(
  message: unknown,
  token: string,
): message is RpcRequest & { params: HelloParams } {
  if (!isRpcRequest(message) || message.method !== 'hello') return false;

  const params = message.params as Partial<HelloParams> | null | undefined;
  return (
    typeof params === 'object' &&
    params !== null &&
    typeof params.token === 'string' &&
    params.token === token &&
    typeof params.client === 'string'
  );
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, id: number | null, code: number, message: string): void {
  send(socket, { jsonrpc: JSON_RPC_VERSION, id, error: { code, message } });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function removeBridgeFile(filePath: string, token: string): void {
  try {
    const current = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<BridgeInfo>;
    if (current.token === token) unlinkSync(filePath);
  } catch {
    // Already gone, or a newer panel replaced it: nothing to clean up.
  }
}
