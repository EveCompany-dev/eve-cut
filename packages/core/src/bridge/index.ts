export { BridgeClient, BridgeError } from './client.js';
export type { BridgeClientOptions, CallOptions } from './client.js';
export {
  appDataDir,
  bridgeFilePath,
  readBridgeInfo,
  writeBridgeInfo,
  type BridgeInfo,
} from './paths.js';
export {
  BRIDGE_ERRORS,
  JSON_RPC_VERSION,
  isProgressNotification,
  isRpcRequest,
  isRpcResponse,
  type BridgeErrorCode,
  type HelloParams,
  type HelloResult,
  type ProgressParams,
  type ProgressUpdate,
  type RpcError,
  type RpcNotification,
  type RpcRequest,
  type RpcResponse,
} from './protocol.js';
