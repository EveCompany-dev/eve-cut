import WebSocket from 'ws';

import { bridgeFilePath, readBridgeInfo, type BridgeInfo } from './paths.js';
import {
  BRIDGE_ERRORS,
  JSON_RPC_VERSION,
  isProgressNotification,
  isRpcResponse,
  type HelloParams,
  type ProgressParams,
} from './protocol.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const HELLO_TIMEOUT_MS = 5_000;

export interface BridgeClientOptions {
  /** Defaults to `%APPDATA%\eve-cut\bridge.json`. */
  bridgeFile?: string;
  /** Sent in `hello` for logs, e.g. "mcp-server/0.1.0". */
  clientName?: string;
}

export interface CallOptions {
  timeoutMs?: number;
  onProgress?: (progress: ProgressParams) => void;
}

export class BridgeError extends Error {
  readonly code: number;
  /** True when the request reached the socket before it failed, so the panel may have run it. */
  readonly sent: boolean;

  constructor(code: number, message: string, sent = false) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.sent = sent;
  }
}

interface Pending {
  socket: WebSocket;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  onProgress?: (progress: ProgressParams) => void;
}

/**
 * Client of the panel bridge.
 *
 * Reads bridge.json on every connection, so a panel restart (new token, possibly a new port) is
 * picked up automatically. A call that never reached the panel is retried once on a fresh socket;
 * one that was already sent is not, because the panel may have run it (applied captions, cut).
 */
export class BridgeClient {
  private readonly bridgeFile: string;
  private readonly clientName: string;
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(options: BridgeClientOptions = {}) {
    this.bridgeFile = options.bridgeFile ?? bridgeFilePath();
    this.clientName = options.clientName ?? 'eve-cut/0.1.0';
  }

  async call<T>(method: string, params: unknown = null, options: CallOptions = {}): Promise<T> {
    try {
      await this.connect();
      return await this.request<T>(method, params, options);
    } catch (error) {
      if (
        !(error instanceof BridgeError) ||
        error.code !== BRIDGE_ERRORS.connectionClosed ||
        error.sent
      ) {
        throw error;
      }

      // The panel may have restarted under us: one reconnect with the new token, then one retry.
      this.disconnect();
      await this.connect();
      return this.request<T>(method, params, options);
    }
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.disconnect();
    if (!socket) return;

    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
    });
  }

  private disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;

    this.failPending(new BridgeError(BRIDGE_ERRORS.connectionClosed, 'Ponte desconectada', true), socket);
    if (socket.readyState === WebSocket.OPEN) socket.close();
  }

  private async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;

    const attempt = this.open();
    this.connecting = attempt;
    try {
      await attempt;
    } finally {
      if (this.connecting === attempt) this.connecting = null;
    }
  }

  private async open(): Promise<void> {
    let info: BridgeInfo;
    try {
      info = readBridgeInfo(this.bridgeFile);
    } catch (error) {
      throw new BridgeError(
        BRIDGE_ERRORS.connectionClosed,
        error instanceof Error ? error.message : String(error),
      );
    }

    const socket = await this.openSocket(info);
    this.socket = socket;

    const hello: HelloParams = { token: info.token, client: this.clientName };
    try {
      await this.request('hello', hello, { timeoutMs: HELLO_TIMEOUT_MS });
    } catch (error) {
      if (this.socket === socket) this.socket = null;
      socket.terminate();
      // hello has no side effects: a connection lost during it can always be retried.
      if (error instanceof BridgeError && error.code === BRIDGE_ERRORS.connectionClosed) {
        throw new BridgeError(error.code, error.message);
      }
      throw error;
    }
  }

  private openSocket(info: BridgeInfo): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${info.port}`);

      const failBeforeOpen = (error: Error) => {
        reject(
          new BridgeError(
            BRIDGE_ERRORS.connectionClosed,
            `Não consegui falar com a ponte: ${error.message}`,
          ),
        );
      };

      socket.once('error', failBeforeOpen);
      socket.once('open', () => {
        socket.off('error', failBeforeOpen);
        this.attach(socket);
        resolve(socket);
      });
    });
  }

  private attach(socket: WebSocket): void {
    socket.on('message', (data) => this.handleMessage(data.toString()));
    // ws emits 'error' right before 'close'; the close handler reports the failure to the callers.
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      // Only this socket's requests: an old socket closing late must not fail calls on the new one.
      this.failPending(
        new BridgeError(BRIDGE_ERRORS.connectionClosed, 'O painel fechou a ponte', true),
        socket,
      );
    });
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (isProgressNotification(message)) {
      this.pending.get(message.params.requestId)?.onProgress?.(message.params);
      return;
    }
    if (!isRpcResponse(message)) return;

    const pending = this.pending.get(message.id);
    if (!pending) return;

    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new BridgeError(message.error.code, message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  private request<T>(method: string, params: unknown, options: CallOptions): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new BridgeError(BRIDGE_ERRORS.connectionClosed, 'Ponte desconectada'));
    }

    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(BRIDGE_ERRORS.timeout, `Tempo esgotado esperando ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        socket,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        onProgress: options.onProgress,
      });

      socket.send(JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id, method, params }), (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(
          new BridgeError(
            BRIDGE_ERRORS.connectionClosed,
            `Não consegui enviar ${method}: ${error.message}`,
          ),
        );
      });
    });
  }

  private failPending(error: Error, socket: WebSocket): void {
    for (const [id, pending] of this.pending) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}
