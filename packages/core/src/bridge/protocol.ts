/** JSON-RPC 2.0 with the eve-cut specifics: one `hello` first, then methods and progress events. */

export const JSON_RPC_VERSION = '2.0';

/**
 * Error codes. The project ones live in the JSON-RPC server range (-32000..-32099) so the client can
 * tell "wrong token" from "slow method" without parsing messages.
 */
export const BRIDGE_ERRORS = {
  connectionClosed: -32000,
  unauthorized: -32001,
  timeout: -32002,
  methodNotFound: -32601,
  internal: -32603,
} as const;

export type BridgeErrorCode = (typeof BRIDGE_ERRORS)[keyof typeof BRIDGE_ERRORS];

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface RpcRequest {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: number;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: number;
  result?: unknown;
  error?: RpcError;
}

export interface RpcNotification {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: unknown;
}

/** Params of the mandatory first request. */
export interface HelloParams {
  token: string;
  /** Who is connected, e.g. "mcp-server/0.1.0". Only for logs. */
  client: string;
}

export interface HelloResult {
  ok: true;
  version: string;
}

/** Payload of a `progress` notification: long operations report how far they are. */
export interface ProgressParams {
  requestId: number;
  done: number;
  total: number;
  label: string;
}

export type ProgressUpdate = Omit<ProgressParams, 'requestId'>;

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RpcRequest>;
  return (
    message.jsonrpc === JSON_RPC_VERSION &&
    typeof message.id === 'number' &&
    typeof message.method === 'string'
  );
}

export function isRpcResponse(value: unknown): value is RpcResponse {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RpcResponse>;
  return message.jsonrpc === JSON_RPC_VERSION && typeof message.id === 'number';
}

export function isProgressNotification(
  value: unknown,
): value is RpcNotification & { params: ProgressParams } {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RpcNotification>;
  if (message.jsonrpc !== JSON_RPC_VERSION || message.method !== 'progress') return false;
  const params = message.params as Partial<ProgressParams> | null | undefined;
  return (
    typeof params === 'object' &&
    params !== null &&
    typeof params.requestId === 'number' &&
    typeof params.done === 'number' &&
    typeof params.total === 'number'
  );
}
