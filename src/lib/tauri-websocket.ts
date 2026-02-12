/**
 * Tauri WebSocket service for OpenClaw gateway streaming
 * 
 * Uses @tauri-apps/plugin-websocket which bypasses browser CORS restrictions
 * and works with the tauri://localhost origin.
 */

import WebSocket from '@tauri-apps/plugin-websocket';

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
  private requestCallbacks: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private messageIdCounter = 0;
  private sessionKey: string;
  private token?: string;

  constructor(private wsUrl: string, sessionKey: string, token?: string) {
    this.sessionKey = sessionKey;
    this.token = token;
  }

  async connect(): Promise<void> {
    // Connect without token in URL - auth is sent in connect message
    const connectUrl = this.wsUrl;
    console.log('[TauriWS] Connecting to:', connectUrl);
    console.log('[TauriWS] WebSocket plugin available:', typeof WebSocket, typeof WebSocket.connect);

    try {
      console.log('[TauriWS] Calling WebSocket.connect with config...');
      // Use tauri://localhost origin - this is in the allowedOrigins list
      this.ws = await WebSocket.connect(connectUrl, {
        headers: {
          'Origin': 'tauri://localhost',
          'User-Agent': 'Pipeline-Dashboard/1.0',
        },
      });
      console.log('[TauriWS] WebSocket.connect returned:', this.ws);
      console.log('[TauriWS] WebSocket object keys:', this.ws ? Object.keys(this.ws) : 'null');
      console.log('[TauriWS] WebSocket object JSON:', JSON.stringify(this.ws));
      // The plugin returns an object with an `id` property that's needed for send
      const wsAny = this.ws as unknown as Record<string, unknown>;
      console.log('[TauriWS] ws.id:', wsAny.id, 'type:', typeof wsAny.id);
      for (const key of Object.keys(wsAny)) {
        console.log(`[TauriWS] ws.${key}:`, typeof wsAny[key], wsAny[key]);
      }
    } catch (err) {
      console.error('[TauriWS] Connection failed:', err);
      console.error('[TauriWS] Error type:', typeof err);
      console.error('[TauriWS] Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
      throw err;
    }
    
    console.log('[TauriWS] Adding message listener...');
    this.ws.addListener((msg) => {
      console.log('[TauriWS] Received message:', msg.type, typeof msg.data === 'string' ? msg.data.slice(0, 200) : msg.data);
      if (msg.type === 'Close') {
        console.error('[TauriWS] Server sent Close frame!', msg);
      }
      if (msg.type === 'Text' && typeof msg.data === 'string') {
        this.handleMessage(msg.data);
      }
    });
    console.log('[TauriWS] Listener added');

    // WORKAROUND: Tauri WebSocket plugin has a race condition - the connection ID
    // is returned before the async task inserts it into the ConnectionManager.
    // Wait longer to let the spawn complete before sending.
    console.log('[TauriWS] Waiting for connection to stabilize (500ms)...');
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('[TauriWS] Connection stabilized, ws id:', (this.ws as unknown as { id?: unknown })?.id);

    // Send connect message with auth (required by OpenClaw gateway protocol)
    console.log('[TauriWS] Sending connect handshake...');
    const connectResult = await this.request<{ ok?: boolean; error?: { message?: string } }>('connect', {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui',  // Must match the expected client ID
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
    console.log('[TauriWS] Connect response:', connectResult);
    console.log('[TauriWS] Connected and authenticated');
  }

  private handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw) as Record<string, unknown>;
      const type = message.type as string;
      const id = message.id as string | undefined;
      
      // Handle RPC responses (type: 'res' or 'err')
      if (id && this.requestCallbacks.has(id)) {
        const callbacks = this.requestCallbacks.get(id)!;
        this.requestCallbacks.delete(id);
        
        // Check for error response (type: 'err' OR ok: false)
        if (type === 'err' || message.ok === false) {
          const errorMsg = (message.error as { message?: string })?.message ?? 'Unknown error';
          console.error('[TauriWS] Request failed:', id, errorMsg);
          callbacks.reject(new Error(errorMsg));
        } else {
          callbacks.resolve(message.result ?? message.payload);
        }
        return;
      }

      // Handle events (type: 'event')
      if (type === 'event') {
        const eventName = message.event as string;
        const eventData = message.payload;  // Fixed: payload not data
        if (eventName) {
          this.handlers.forEach((handler) => {
            handler(eventName, eventData);
          });
        }
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  }

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws) {
      throw new Error('WebSocket not connected');
    }

    const id = `req-${++this.messageIdCounter}-${Date.now()}`;
    
    // Match the format expected by OpenClaw gateway
    const message = {
      type: 'req',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestCallbacks.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      this.requestCallbacks.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          console.log('[TauriWS] Request resolved:', method, v);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timeout);
          console.error('[TauriWS] Request rejected:', method, e);
          reject(e);
        },
      });

      console.log('[TauriWS] Sending request:', method, JSON.stringify(message).slice(0, 500));
      console.log('[TauriWS] ws object before send:', this.ws, 'id:', (this.ws as unknown as { id?: unknown })?.id);
      this.ws!.send(JSON.stringify(message)).then(() => {
        console.log('[TauriWS] Send succeeded for:', method);
      }).catch((err) => {
        console.error('[TauriWS] Send failed:', err);
        console.error('[TauriWS] Send error type:', typeof err, 'keys:', err ? Object.keys(err) : 'none');
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

  async disconnect(): Promise<void> {
    if (this.ws) {
      await this.ws.disconnect();
      this.ws = null;
    }
    this.handlers.clear();
    this.requestCallbacks.clear();
  }

  get connected(): boolean {
    return this.ws !== null;
  }
}

// Singleton connection
let connectionInstance: TauriOpenClawConnection | null = null;
let connectionPromise: Promise<TauriOpenClawConnection> | null = null;

export async function getTauriOpenClawConnection(
  wsUrl: string,
  sessionKey: string,
  token?: string,
): Promise<TauriOpenClawConnection> {
  // Reuse existing connection if available
  if (connectionInstance?.connected) {
    console.log('[TauriWS] Reusing existing connection, ws.id:', (connectionInstance as unknown as { ws?: { id?: unknown } }).ws?.id);
    return connectionInstance;
  }
  console.log('[TauriWS] Creating new connection (existing:', !!connectionInstance, 'connected:', connectionInstance?.connected, ')');

  // Avoid multiple concurrent connection attempts
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    connectionInstance = new TauriOpenClawConnection(wsUrl, sessionKey, token);
    await connectionInstance.connect();
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
}
