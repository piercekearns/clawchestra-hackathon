/**
 * Tauri WebSocket service for OpenClaw gateway streaming
 *
 * Uses @tauri-apps/plugin-websocket which bypasses browser CORS restrictions
 * and works with the tauri://localhost origin.
 *
 * Includes a connection state machine with automatic reconnection
 * and Zustand bridge for UI state propagation.
 */

import WebSocket from '@tauri-apps/plugin-websocket';
import type { ChatConnectionState } from '../components/chat/types';
import { useDashboardStore } from './store';

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

type MessageHandler = (event: string, payload: unknown) => void;

export class TauriOpenClawConnection {
  private ws: Awaited<ReturnType<typeof WebSocket.connect>> | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private requestCallbacks: Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private messageIdCounter = 0;
  private sessionKey: string;
  private token?: string;

  // State machine fields
  private _state: ChatConnectionState = 'disconnected';
  private stateListeners = new Set<(state: ChatConnectionState) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectAttempts = 5;
  private disposed = false;

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

  async connect(): Promise<void> {
    const connectUrl = this.wsUrl;
    console.log('[TauriWS] Connecting to:', connectUrl);
    this.setState('connecting');

    try {
      this.ws = await WebSocket.connect(connectUrl, {
        headers: {
          'Origin': 'tauri://localhost',
          'User-Agent': 'Pipeline-Dashboard/1.0',
        },
      });
    } catch (err) {
      console.error('[TauriWS] Connection failed:', err);
      throw err;
    }

    this.ws.addListener((msg) => {
      if (msg.type === 'Close') {
        console.warn('[TauriWS] Server sent Close frame');
        this.ws = null;
        this.rejectPendingCallbacks('WebSocket closed');
        this.setState('disconnected');
        this.scheduleReconnect();
        return;
      }
      if (msg.type === 'Text' && typeof msg.data === 'string') {
        this.handleMessage(msg.data);
      }
    });

    // WORKAROUND: Tauri WebSocket plugin has a race condition - the connection ID
    // is returned before the async task inserts it into the ConnectionManager.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send connect message with auth (required by OpenClaw gateway protocol)
    await this.request<{ ok?: boolean; error?: { message?: string } }>('connect', {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui',
        version: '0.1.0',
        platform: 'tauri',
        mode: 'webchat',
      },
      role: 'operator',
      scopes: ['operator.write', 'chat.send', 'chat.history'],
      auth: this.token ? { token: this.token } : undefined,
      userAgent: 'Pipeline-Dashboard/1.0',
      locale: 'en-US',
    });

    this.setState('connected');
    this.reconnectAttempt = 0;
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
          const errorMsg = (message.error as { message?: string })?.message ?? 'Unknown error';
          callbacks.reject(new Error(errorMsg));
        } else {
          callbacks.resolve(message.result ?? message.payload);
        }
        return;
      }

      // Handle events (type: 'event')
      if (type === 'event') {
        const eventName = message.event as string;
        const eventData = message.payload;
        const chatState = typeof eventData === 'object' && eventData !== null
          ? (eventData as Record<string, unknown>).state
          : undefined;
        console.log(`[TauriWS] Event received: ${eventName}, state=${chatState ?? '?'}, handlers=${this.handlers.size}`);
        if (eventName) {
          this.handlers.forEach((handler) => {
            handler(eventName, eventData);
          });
        }
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
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt++;
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => void this.attemptReconnect(), delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.disposed) return;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setState('disconnected');  // Notify listeners BEFORE clearing them
    this.rejectPendingCallbacks('Connection disposed');
    if (this.ws) {
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
  const requestedConfigKey = getConnectionConfigKey(wsUrl, sessionKey, token);

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
    connectionInstance = new TauriOpenClawConnection(wsUrl, sessionKey, token);
    wireConnectionStateToStore(connectionInstance); // Wire BEFORE connect so all transitions are captured
    await connectionInstance.connect();  // setState('connecting') → setState('connected')
    return connectionInstance;
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
