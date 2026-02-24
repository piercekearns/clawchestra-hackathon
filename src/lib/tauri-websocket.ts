/**
 * Tauri WebSocket service for OpenClaw gateway streaming
 *
 * Uses @tauri-apps/plugin-websocket which bypasses browser CORS restrictions
 * and works with the tauri://localhost origin.
 *
 * Includes a connection state machine with automatic reconnection
 * and Zustand bridge for UI state propagation.
 */

import WebSocket, { type Message as TauriWsMessage } from '@tauri-apps/plugin-websocket';
import { Channel, invoke } from '@tauri-apps/api/core';
import type { ChatConnectionState } from '../components/chat/types';
import { useDashboardStore } from './store';
import { getOpenClawGatewayConfig } from './tauri';

const WS_KEEPALIVE_INTERVAL_MS = 20_000;  // Ping every 20s to prevent idle drops
const OPENCLAW_CONNECT_CHALLENGE_TIMEOUT_MS = 2_000;
const OPENCLAW_CLIENT_ID = 'openclaw-control-ui';
const OPENCLAW_CLIENT_VERSION = '0.1.0';
const OPENCLAW_CLIENT_MODE = 'webchat';
const OPENCLAW_CLIENT_ROLE = 'operator';
const OPENCLAW_CLIENT_SCOPES = [
  'operator.read',
  'operator.write',
  'operator.admin',
  'chat.send',
  'chat.history',
];

type GatewayConfigSnapshot = {
  wsUrl: string;
  sessionKey: string;
  token?: string;
};

let lastKnownGatewayConfig: GatewayConfigSnapshot | null = null;

function shouldRefreshGatewayConfig(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('connect challenge') ||
    normalized.includes('token mismatch') ||
    normalized.includes('unauthorized') ||
    normalized.includes('auth token') ||
    normalized.includes('clock')
  );
}

function resolveGatewayConfigSnapshot(
  wsUrl: string,
  sessionKey: string,
  token?: string,
): GatewayConfigSnapshot {
  if (
    lastKnownGatewayConfig &&
    lastKnownGatewayConfig.wsUrl === wsUrl &&
    lastKnownGatewayConfig.sessionKey === sessionKey
  ) {
    if (lastKnownGatewayConfig.token && lastKnownGatewayConfig.token !== token) {
      return lastKnownGatewayConfig;
    }
  }

  return { wsUrl, sessionKey, token };
}

export interface OpenClawMessage {
  type: string;
  payload?: unknown;
  id?: string;
}

export interface ChatDelta {
  sessionKey: string;
  runId: string;
  state: 'delta' | 'final' | 'error' | 'aborted';
  message?: unknown;
  errorMessage?: string;
}

interface GatewayConnectChallengePayload {
  nonce?: string;
}

interface GatewayDeviceAuthProof {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}

async function getOpenClawWsDeviceAuth(params: {
  nonce: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token?: string;
}): Promise<GatewayDeviceAuthProof> {
  return invoke<GatewayDeviceAuthProof>('get_openclaw_ws_device_auth', {
    nonce: params.nonce,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: params.role,
    scopes: params.scopes,
    token: params.token ?? null,
  });
}

type MessageHandler = (event: string, payload: unknown) => void;

type TauriSocketConnection = {
  socket: Awaited<ReturnType<typeof WebSocket.connect>>;
  removeListener: () => void;
};

async function connectTauriSocketWithEarlyListener(
  url: string,
  headers: Record<string, string>,
  onMessage: (message: TauriWsMessage) => void,
): Promise<TauriSocketConnection> {
  const listeners = new Set<(message: TauriWsMessage) => void>();
  listeners.add(onMessage);

  const channel = new Channel<TauriWsMessage>();
  channel.onmessage = (message) => {
    listeners.forEach((listener) => {
      listener(message);
    });
  };

  const id = await invoke<number>('plugin:websocket|connect', {
    url,
    onMessage: channel,
    config: {
      headers: Object.entries(headers),
    },
  });

  const socket = new WebSocket(id, listeners);
  return {
    socket,
    removeListener: () => {
      listeners.delete(onMessage);
    },
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function shouldRetryWithDeviceChallenge(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes('missing scope') ||
    message.includes('scope') ||
    message.includes('challenge') ||
    message.includes('nonce') ||
    message.includes('device') ||
    message.includes('auth')
  );
}

export class TauriOpenClawConnection {
  private ws: Awaited<ReturnType<typeof WebSocket.connect>> | null = null;
  private removeWsListener: (() => void) | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private requestCallbacks: Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private messageIdCounter = 0;
  private sessionKey: string;
  private token?: string;
  private connectChallengeNonce: string | null = null;
  private connectChallengeWaiters = new Set<{
    resolve: (nonce: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // State machine fields
  private _state: ChatConnectionState = 'disconnected';
  private stateListeners = new Set<(state: ChatConnectionState) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectAttempts = 5;
  private disposed = false;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastSocketActivityAt = 0;

  constructor(private wsUrl: string, sessionKey: string, token?: string) {
    this.sessionKey = sessionKey;
    this.token = token;
  }

  get state(): ChatConnectionState { return this._state; }

  private setState(next: ChatConnectionState): void {
    if (this._state === next) return;
    this._state = next;
    this.stateListeners.forEach(fn => {
      try { fn(next); } catch (e) { console.warn('[TauriWS] State listener error:', e); }
    });
  }

  onStateChange(listener: (s: ChatConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private markSocketActivity(): void {
    this.lastSocketActivityAt = Date.now();
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.markSocketActivity();

    this.keepaliveTimer = setInterval(() => {
      if (this.disposed) return;
      if (!this.ws || this._state !== 'connected') return;

      // Keepalive via a lightweight, already-authorized RPC.
      // Using `ping` requires additional scopes in many gateway configs.
      const pingId = `ping-${Date.now()}`;
      this.ws
        .send(
          JSON.stringify({
            type: 'req',
            id: pingId,
            method: 'chat.history',
            params: { sessionKey: this.sessionKey, limit: 1 },
          }),
        )
        .then(() => {
          // Outbound ping success is a valid liveness signal. Rely on
          // ping send failures/Close frames for reconnect, rather than
          // forcing reconnects purely on inbound silence during long turns.
          this.markSocketActivity();
          console.log('[TauriWS] Keepalive history probe sent');
        })
        .catch((err) => {
          console.warn('[TauriWS] Keepalive ping failed, forcing reconnect:', err);
          this.forceReconnect('keepalive ping failed');
        });
    }, WS_KEEPALIVE_INTERVAL_MS);
  }

  private forceReconnect(reason: string): void {
    if (this.disposed) return;
    if (this.reconnectTimer) return;

    console.warn(`[TauriWS] Force reconnect: ${reason}`);
    this.stopKeepalive();
    this.rejectPendingCallbacks(`WebSocket reconnect: ${reason}`);
    this.clearConnectChallengeState(new Error(`WebSocket reconnect: ${reason}`));

    const active = this.ws;
    this.ws = null;

    if (active) {
      active.disconnect().catch((err) => {
        console.warn('[TauriWS] Force reconnect disconnect error:', err);
      });
    }

    this.scheduleReconnect();
  }

  private clearConnectChallengeState(error?: Error): void {
    this.connectChallengeNonce = null;
    if (this.connectChallengeWaiters.size === 0) return;

    const pending = Array.from(this.connectChallengeWaiters);
    this.connectChallengeWaiters.clear();
    pending.forEach((waiter) => {
      clearTimeout(waiter.timer);
      if (error) {
        waiter.reject(error);
      }
    });
  }

  private waitForConnectChallenge(timeoutMs = OPENCLAW_CONNECT_CHALLENGE_TIMEOUT_MS): Promise<string> {
    if (this.connectChallengeNonce) {
      return Promise.resolve(this.connectChallengeNonce);
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.connectChallengeWaiters.delete(waiter);
          reject(new Error('Timed out waiting for gateway connect challenge'));
        }, timeoutMs),
      };
      this.connectChallengeWaiters.add(waiter);
    });
  }

  private extractChallengeNonce(payload: unknown): string | null {
    const record = payload as GatewayConnectChallengePayload | null;
    const nonce = typeof record?.nonce === 'string' ? record.nonce.trim() : '';
    if (nonce) return nonce;

    const object = payload as Record<string, unknown> | null;
    const nested = object?.payload ?? object?.params ?? object?.data;
    if (typeof nested === 'object' && nested !== null) {
      const nestedNonce = typeof (nested as Record<string, unknown>).nonce === 'string'
        ? (nested as Record<string, unknown>).nonce as string
        : '';
      if (nestedNonce.trim()) return nestedNonce.trim();
    }

    return null;
  }

  private handleConnectChallengeEvent(payload: unknown): void {
    const nonce = this.extractChallengeNonce(payload);
    if (!nonce) return;

    this.connectChallengeNonce = nonce;
    if (this.connectChallengeWaiters.size === 0) return;

    const pending = Array.from(this.connectChallengeWaiters);
    this.connectChallengeWaiters.clear();
    pending.forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.resolve(nonce);
    });
  }

  private async sendConnect(deviceProof?: GatewayDeviceAuthProof): Promise<void> {
    await this.request<{ ok?: boolean; error?: { message?: string } }>('connect', {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: OPENCLAW_CLIENT_ID,
        version: OPENCLAW_CLIENT_VERSION,
        platform: 'tauri',
        mode: OPENCLAW_CLIENT_MODE,
      },
      role: OPENCLAW_CLIENT_ROLE,
      scopes: OPENCLAW_CLIENT_SCOPES,
      auth: this.token ? { token: this.token } : undefined,
      ...(deviceProof ? { device: deviceProof } : {}),
      userAgent: 'Pipeline-Dashboard/1.0',
      locale: 'en-US',
    });
  }

  private async verifyGatewayScopes(): Promise<void> {
    await this.request('sessions.list', {
      search: this.sessionKey,
      limit: 1,
      includeGlobal: false,
      includeUnknown: true,
    });
  }

  private handleSocketMessage(msg: TauriWsMessage): void {
    if (msg.type === 'Close') {
      console.warn('[TauriWS] Server sent Close frame');
      this.stopKeepalive();
      this.removeWsListener?.();
      this.removeWsListener = null;
      this.ws = null;
      this.rejectPendingCallbacks('WebSocket closed');
      this.clearConnectChallengeState(new Error('WebSocket closed'));
      this.scheduleReconnect();
      return;
    }

    this.markSocketActivity();

    if (msg.type === 'Text' && typeof msg.data === 'string') {
      this.handleMessage(msg.data);
      return;
    }

    if (msg.type === 'Binary' && Array.isArray(msg.data)) {
      try {
        const text = new TextDecoder().decode(new Uint8Array(msg.data));
        if (text) {
          this.handleMessage(text);
        }
      } catch (error) {
        console.warn('[TauriWS] Failed to decode binary message:', error);
      }
      return;
    }
  }

  async connect(): Promise<void> {
    const connectUrl = this.wsUrl;
    console.log('[TauriWS] Connecting to:', connectUrl);
    this.setState('connecting');
    this.clearConnectChallengeState();

    try {
      const { socket, removeListener } = await connectTauriSocketWithEarlyListener(
        connectUrl,
        {
          Origin: 'tauri://localhost',
          'User-Agent': 'Pipeline-Dashboard/1.0',
        },
        (msg) => this.handleSocketMessage(msg),
      );
      this.ws = socket;
      this.removeWsListener = removeListener;
    } catch (err) {
      console.error('[TauriWS] Connection failed:', err);
      throw err;
    }

    try {
      const connectNonce = await this.waitForConnectChallenge();
      const deviceProof = await getOpenClawWsDeviceAuth({
        nonce: connectNonce,
        clientId: OPENCLAW_CLIENT_ID,
        clientMode: OPENCLAW_CLIENT_MODE,
        role: OPENCLAW_CLIENT_ROLE,
        scopes: OPENCLAW_CLIENT_SCOPES,
        token: this.token,
      });
      await this.sendConnect(deviceProof);
      await this.verifyGatewayScopes();
    } catch (error) {
      if (!shouldRetryWithDeviceChallenge(error)) {
        this.forceReconnect(`handshake failed: ${toErrorMessage(error)}`);
        throw error;
      }

      // Some gateway builds don't emit challenge immediately; fall back to auth-only connect.
      try {
        await this.sendConnect();
        await this.verifyGatewayScopes();
      } catch (fallbackError) {
        if (this.connectChallengeNonce && shouldRetryWithDeviceChallenge(fallbackError)) {
          try {
            const deviceProof = await getOpenClawWsDeviceAuth({
              nonce: this.connectChallengeNonce,
              clientId: OPENCLAW_CLIENT_ID,
              clientMode: OPENCLAW_CLIENT_MODE,
              role: OPENCLAW_CLIENT_ROLE,
              scopes: OPENCLAW_CLIENT_SCOPES,
              token: this.token,
            });
            await this.sendConnect(deviceProof);
            await this.verifyGatewayScopes();
            // Recovered with device-auth challenge; continue with normal connected flow.
          } catch {
            // Fall through to normal reconnect/error path.
          }
        }
        this.forceReconnect(`handshake failed: ${toErrorMessage(fallbackError)}`);
        throw fallbackError;
      }
    }

    this.setState('connected');
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.startKeepalive();
    console.log('[TauriWS] Connected and authenticated');
  }

  private handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw) as Record<string, unknown>;
      const type = message.type as string;
      const id = message.id as string | undefined;
      
      // Log all incoming WS messages for diagnostics
      if (type !== 'event') {
        console.log(`[TauriWS] Message: type=${type}, id=${id ?? 'none'}`);
      }

      // Handle RPC responses (type: 'res' or 'err')
      if (id && this.requestCallbacks.has(id)) {
        const callbacks = this.requestCallbacks.get(id)!;
        this.requestCallbacks.delete(id);

        if (type === 'err' || message.ok === false) {
          // Handle error as string, object with .message, or nested object
          const rawError = message.error;
          let errorMsg = 'Unknown error';
          if (typeof rawError === 'string') {
            errorMsg = rawError;
          } else if (typeof rawError === 'object' && rawError !== null) {
            const errorObj = rawError as Record<string, unknown>;
            if (typeof errorObj.message === 'string') errorMsg = errorObj.message;
            else if (typeof errorObj.error === 'string') errorMsg = errorObj.error;
          }
          callbacks.reject(new Error(errorMsg));
        } else {
          callbacks.resolve(message.result ?? message.payload);
        }
        return;
      }

      // Handle events (type: 'event')
      if (type === 'event') {
        const eventName = message.event as string;
        const eventData = message.payload ?? message.params ?? message.data;
        if (eventName === 'connect.challenge') {
          this.handleConnectChallengeEvent(eventData);
        }
        const chatState = typeof eventData === 'object' && eventData !== null
          ? (eventData as Record<string, unknown>).state
          : undefined;
        console.log(`[TauriWS] Event received: ${eventName}, state=${chatState ?? '?'}, handlers=${this.handlers.size}`);
        if (eventName) {
          this.handlers.forEach((handler) => {
            handler(eventName, eventData);
          });
        }
        return;
      }

      // Tolerate alternate challenge message envelopes across gateway builds.
      if (
        type === 'connect.challenge' ||
        type === 'challenge' ||
        (message.event as string | undefined) === 'connect.challenge'
      ) {
        this.handleConnectChallengeEvent(message.payload ?? message.params ?? message.data ?? message);
      }
    } catch (e) {
      console.error('[TauriWS] Failed to parse message:', e);
    }
  }

  /**
   * Wait for the connection to reach 'connected' state.
   * Resolves immediately if already connected. Rejects on timeout or terminal state.
   */
  private waitForConnection(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this._state === 'connected') { resolve(); return; }

      const timeout = setTimeout(() => {
        unsub();
        reject(new Error(`Connection wait timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      const unsub = this.onStateChange((state) => {
        if (state === 'connected') {
          clearTimeout(timeout);
          unsub();
          resolve();
        } else if (state === 'error' || (state === 'disconnected' && this.disposed)) {
          clearTimeout(timeout);
          unsub();
          reject(new Error(`Connection failed: ${state}`));
        }
        // 'reconnecting' / 'connecting' / 'disconnected' (non-disposed) — keep waiting
      });
    });
  }

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    // If WS is null but we're reconnecting/connecting, wait up to 15s
    if (!this.ws) {
      if (this._state === 'reconnecting' || this._state === 'connecting') {
        console.log(`[TauriWS] request(${method}): ws null, state=${this._state} — waiting for reconnection`);
        await this.waitForConnection(15000);
      }
      if (!this.ws) {
        throw new Error('WebSocket not connected');
      }
    }

    const id = `req-${++this.messageIdCounter}-${Date.now()}`;
    const message = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestCallbacks.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      this.requestCallbacks.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
        timeout,
      });

      this.ws!.send(JSON.stringify(message)).catch((err) => {
        this.requestCallbacks.delete(id);
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  handlerCount(): number {
    return this.handlers.size;
  }

  private rejectPendingCallbacks(reason: string): void {
    const pending = new Map(this.requestCallbacks);
    this.requestCallbacks.clear();
    for (const [, { reject, timeout }] of pending) {
      clearTimeout(timeout);
      try { reject(new Error(reason)); } catch (e) { console.warn('[TauriWS] Reject error:', e); }
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectAttempt >= this.maxReconnectAttempts) {
      if (!this.disposed) this.setState('error');
      return;
    }
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt++;
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => void this.attemptReconnect(), delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.disposed) return;
    this.reconnectTimer = null;
    try {
      if (this.ws) {
        try { await this.ws.disconnect(); } catch (e) { console.warn('[TauriWS] Pre-reconnect disconnect error:', e); }
        this.ws = null;
      }
      await this.connect();
    } catch {
      this.scheduleReconnect();
    }
  }

  retryManually(): void {
    if (this.disposed) {
      // Reset disposed state — allows retry after clean disconnect
      this.disposed = false;
    }
    this.reconnectAttempt = 0;
    this.scheduleReconnect();
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.stopKeepalive();
    this.clearConnectChallengeState(new Error('Connection disposed'));
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setState('disconnected');  // Notify listeners BEFORE clearing them
    this.rejectPendingCallbacks('Connection disposed');
    if (this.ws) {
      this.removeWsListener?.();
      this.removeWsListener = null;
      await this.ws.disconnect();
      this.ws = null;
    }
    this.handlers.clear();
    this.stateListeners.clear();
  }

  get connected(): boolean {
    return this._state === 'connected' && this.ws !== null;
  }
}

// Zustand bridge — wires connection state changes to the store
function wireConnectionStateToStore(connection: TauriOpenClawConnection): void {
  const { setWsConnectionState, setGatewayConnected } = useDashboardStore.getState();
  connection.onStateChange((state) => {
    setWsConnectionState(state);
    setGatewayConnected(state === 'connected');
  });
}

// Singleton connection
let connectionInstance: TauriOpenClawConnection | null = null;
let connectionPromise: Promise<TauriOpenClawConnection> | null = null;
let connectionConfigKey: string | null = null;

function getConnectionConfigKey(wsUrl: string, sessionKey: string, token?: string): string {
  return JSON.stringify({
    wsUrl,
    sessionKey,
    token: token ?? null,
  });
}

export async function getTauriOpenClawConnection(
  wsUrl: string,
  sessionKey: string,
  token?: string,
): Promise<TauriOpenClawConnection> {
  const resolved = resolveGatewayConfigSnapshot(wsUrl, sessionKey, token);
  const requestedConfigKey = getConnectionConfigKey(
    resolved.wsUrl,
    resolved.sessionKey,
    resolved.token,
  );

  // Reuse existing connection if connected or reconnecting (don't create duplicates)
  if (connectionInstance) {
    const state = connectionInstance.state;
    if (
      connectionConfigKey === requestedConfigKey &&
      (state === 'connected' || state === 'reconnecting' || state === 'connecting')
    ) {
      return connectionInstance;
    }
  }

  // Avoid multiple concurrent connection attempts
  if (connectionPromise && connectionConfigKey === requestedConfigKey) {
    return connectionPromise;
  }
  if (connectionPromise && connectionConfigKey !== requestedConfigKey) {
    try {
      await connectionPromise;
    } catch {
      // ignore failed previous attempt
    } finally {
      connectionPromise = null;
    }
  }

  // Existing connection is for different parameters; force a clean reconnect.
  if (connectionInstance) {
    try {
      await connectionInstance.disconnect();
    } catch {
      // ignore disconnect failures and continue with a fresh connection
    }
    connectionInstance = null;
  }

  connectionConfigKey = requestedConfigKey;
  connectionPromise = (async () => {
    const attemptConfig = (config: GatewayConfigSnapshot) => {
      connectionInstance = new TauriOpenClawConnection(
        config.wsUrl,
        config.sessionKey,
        config.token,
      );
      wireConnectionStateToStore(connectionInstance); // Wire BEFORE connect so all transitions are captured
      return connectionInstance.connect();
    };

    try {
      await attemptConfig(resolved);
      lastKnownGatewayConfig = resolved;
      return connectionInstance!;
    } catch (error) {
      if (!shouldRefreshGatewayConfig(error)) {
        throw error;
      }

      try {
        const refreshed = await getOpenClawGatewayConfig();
        const refreshedSnapshot: GatewayConfigSnapshot = {
          wsUrl: refreshed.wsUrl,
          sessionKey: refreshed.sessionKey,
          token: refreshed.token,
        };
        const refreshedKey = getConnectionConfigKey(
          refreshedSnapshot.wsUrl,
          refreshedSnapshot.sessionKey,
          refreshedSnapshot.token,
        );

        if (refreshedKey !== requestedConfigKey) {
          const staleConnection = connectionInstance as TauriOpenClawConnection | null;
          try {
            if (staleConnection) {
              await staleConnection.disconnect();
            }
          } catch {
            // ignore disconnect failures
          }
          connectionConfigKey = refreshedKey;
          await attemptConfig(refreshedSnapshot);
          lastKnownGatewayConfig = refreshedSnapshot;
          return connectionInstance!;
        }
      } catch (refreshError) {
        console.warn('[TauriWS] Refreshing gateway config failed:', refreshError);
      }

      throw error;
    }
  })();

  try {
    return await connectionPromise;
  } finally {
    connectionPromise = null;
  }
}

export function closeTauriOpenClawConnection(): void {
  if (connectionInstance) {
    connectionInstance.disconnect();
    connectionInstance = null;
  }
  connectionConfigKey = null;
}

export function getConnectionInstance(): TauriOpenClawConnection | null {
  return connectionInstance;
}
