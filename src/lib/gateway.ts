import {
  checkOpenClawGatewayConnection,
  getOpenClawGatewayConfig,
  sendOpenClawMessage,
} from './tauri';
import type { ChatConnectionState } from '../components/chat/types';
import { useDashboardStore } from './store';

export type SystemBubbleKind = 'completion' | 'failure' | 'compaction' | 'decision' | 'info';

export interface SystemBubbleMeta {
  kind: SystemBubbleKind;
  title: string;
  details?: Record<string, string>;
  actions?: string[];
  runId?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  _id?: string;
  systemMeta?: SystemBubbleMeta;
}

export interface SendResult {
  messages: ChatMessage[];
  lastContent: string; // For backward compatibility / streaming display
}

export interface GatewayImageAttachment {
  name: string;
  mediaType: string;
  dataUrl: string;
}

export type GatewayTransport =
  | { mode: 'http-openai'; baseUrl?: string }
  | { mode: 'openclaw-ws'; wsUrl: string; token?: string; sessionKey?: string }
  | { mode: 'tauri-openclaw'; sessionKey?: string }
  | { mode: 'tauri-ws'; wsUrl: string; token?: string; sessionKey?: string };

interface GatewayOptions {
  attachments?: GatewayImageAttachment[];
  transport?: GatewayTransport;
  onStreamDelta?: (content: string) => void;
  onActivityChange?: (state: 'idle' | 'typing' | 'working') => void;
}

interface ChatCompletionMessagePartText {
  type: 'text';
  text: string;
}

interface ChatCompletionMessagePartImage {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

interface ChatCompletionMessage {
  role: ChatMessage['role'];
  content:
    | string
    | Array<ChatCompletionMessagePartText | ChatCompletionMessagePartImage>;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface OpenClawReqMessage {
  type: 'req';
  id: string;
  method: string;
  params: unknown;
}

interface OpenClawResMessage {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

interface OpenClawEventMessage {
  type: 'event';
  event: string;
  payload?: unknown;
}

interface OpenClawConnection {
  request: (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>;
  subscribe: (listener: (event: string, payload: unknown) => void) => () => void;
  close: () => void;
}

export const DEFAULT_SESSION_KEY = 'agent:main:pipeline-dashboard';
const DEFAULT_HTTP_GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:18789';
const OPENCLAW_CONNECT_TIMEOUT_MS = 12000;
const OPENCLAW_REQUEST_TIMEOUT_MS = 20000;
const OPENCLAW_CHAT_TIMEOUT_MS = 300000; // 5 minutes for long operations (sub-agents, complex tool use)
const OPENCLAW_CLIENT_ID = 'openclaw-control-ui';
const OPENCLAW_SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing'];

let cachedOpenClawTransportPromise: Promise<GatewayTransport | null> | null = null;

interface AnnounceMetadata {
  label?: string;
  runtime?: string;
  status?: 'started' | 'running' | 'ok' | 'error' | 'timeout';
  tokens?: string;
  sessionKey?: string;
  runId?: string;
}

export type SystemEventKind = 'compaction' | 'error' | 'announce';

export interface SystemEvent {
  kind: SystemEventKind;
  sessionKey?: string;
  runId?: string;
  label?: string;
  message?: string;
  status?: string;
  runtime?: string;
  tokens?: string;
  raw?: Record<string, unknown>;
}

type SystemEventListener = (event: SystemEvent) => void;

let systemEventUnsubscribe: (() => void) | null = null;
const systemEventListeners = new Set<SystemEventListener>();
const ACTIVE_SEND_DEDUP_WINDOW_MS = 120_000;
let activeSendRun: { runId: string; startedAt: number } | null = null;
const TOOL_ACTIVITY_STATES = new Set([
  'tool_use',
  'tool_result',
  'tool_call',
  'reading',
  'writing',
  'searching',
  'executing',
  'reasoning',
  'thinking',
]);
const TYPING_ACTIVITY_STATES = new Set(['content', 'delta', 'streaming']);
const TERMINAL_ACTIVITY_STATES = new Set(['final', 'error', 'aborted']);

function isChatCompletionResponse(data: unknown): data is ChatCompletionResponse {
  if (typeof data !== 'object' || data === null) return false;

  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.choices) || record.choices.length === 0) return false;

  const first = record.choices[0] as Record<string, unknown>;
  if (typeof first.message !== 'object' || first.message === null) return false;

  const message = first.message as Record<string, unknown>;
  return typeof message.content === 'string';
}

function isModelListResponse(data: unknown): data is { data: Array<Record<string, unknown>> } {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return Array.isArray(record.data);
}

function getRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.code === 'string') return record.code;
  }

  return 'Unknown gateway error';
}

function mapOpenClawConnectionError(error: unknown): Error {
  const message = normalizeErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes('origin not allowed')) {
    return new Error(
      'OpenClaw rejected this app origin. Add `tauri://localhost` and `http://tauri.localhost` to `gateway.controlUi.allowedOrigins`, then restart OpenClaw.',
    );
  }

  if (lower.includes('unauthorized') || lower.includes('invalid token')) {
    return new Error(
      'OpenClaw authentication failed. Verify `~/.openclaw/openclaw.json` gateway token and restart the gateway.',
    );
  }

  return new Error(message);
}

function normalizeAnnounceStatus(
  rawStatus: unknown,
  messageText: string,
): AnnounceMetadata['status'] {
  const normalized = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (['start', 'started', 'queued'].includes(normalized)) return 'started';
  if (['running', 'in_progress'].includes(normalized)) return 'running';
  if (['ok', 'success', 'completed', 'complete', 'finished'].includes(normalized)) return 'ok';
  if (['error', 'failed', 'failure'].includes(normalized)) return 'error';
  if (['timeout', 'timed_out', 'timed-out'].includes(normalized)) return 'timeout';

  if (/(timed?\s*out)/i.test(messageText)) return 'timeout';
  if (/(failed|error)/i.test(messageText)) return 'error';
  if (/(completed|finished|succeeded)/i.test(messageText)) return 'ok';
  return undefined;
}

export function parseAnnounceMetadata(
  eventPayload: Record<string, unknown>,
  fromEventBus: boolean = false,
): AnnounceMetadata | null {
  const messageText = typeof eventPayload.message === 'string' ? eventPayload.message : '';

  if (
    eventPayload.announce === true ||
    eventPayload.subagentResult !== undefined ||
    eventPayload.state === 'announce'
  ) {
    return {
      label: typeof eventPayload.label === 'string' ? eventPayload.label : undefined,
      runtime: typeof eventPayload.runtime === 'string' ? eventPayload.runtime : undefined,
      status: normalizeAnnounceStatus(eventPayload.status, messageText),
      tokens: typeof eventPayload.tokens === 'string' ? eventPayload.tokens : undefined,
      sessionKey: typeof eventPayload.sessionKey === 'string' ? eventPayload.sessionKey : undefined,
      runId: typeof eventPayload.runId === 'string' ? eventPayload.runId : undefined,
    };
  }

  if (fromEventBus) {
    const isAnnounce =
      /(?:sub-?agent|task|background job)\s+(?:completed|finished|failed|timed?\s*out)/i.test(
        messageText,
      );

    if (isAnnounce) {
      return {
        status: normalizeAnnounceStatus(undefined, messageText),
        runId: typeof eventPayload.runId === 'string' ? eventPayload.runId : undefined,
      };
    }
  }

  return null;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part !== 'object' || part === null) return '';
        const record = part as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        if (record.type === 'text' && typeof record.content === 'string') return record.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof content === 'object' && content !== null) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (record.content !== undefined) return extractText(record.content);
  }

  return '';
}

function toOpenAIMessagePayload(
  messages: ChatMessage[],
  attachments: GatewayImageAttachment[] = [],
): ChatCompletionMessage[] {
  if (attachments.length === 0) {
    return messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  const lastUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === 'user')?.index;

  if (lastUserIndex === undefined) {
    return messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  return messages.map((message, index) => {
    if (index !== lastUserIndex) {
      return {
        role: message.role,
        content: message.content,
      };
    }

    const content: ChatCompletionMessage['content'] = [
      { type: 'text', text: message.content },
      ...attachments.map((attachment) => ({
        type: 'image_url' as const,
        image_url: { url: attachment.dataUrl },
      })),
    ];

    return {
      role: message.role,
      content,
    };
  });
}

function toOpenClawAttachments(attachments: GatewayImageAttachment[]): Array<{
  type: 'image';
  mimeType: string;
  content: string;
}> {
  return attachments.map((attachment) => {
    const parsed = /^data:([^;]+);base64,(.+)$/i.exec(attachment.dataUrl);
    return {
      type: 'image',
      mimeType: parsed?.[1] ?? attachment.mediaType ?? 'application/octet-stream',
      content: parsed?.[2] ?? attachment.dataUrl,
    };
  });
}

function latestUserContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user' && messages[i].content.trim()) {
      return messages[i].content.trim();
    }
  }

  return messages[messages.length - 1]?.content?.trim() ?? '';
}

async function getDefaultOpenClawTransport(): Promise<GatewayTransport | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;

  if (!cachedOpenClawTransportPromise) {
    cachedOpenClawTransportPromise = (async () => {
      try {
        const config = await getOpenClawGatewayConfig();
        
        // Use Tauri WebSocket for streaming support
        console.log('[Gateway] Using tauri-ws transport');
        return {
          mode: 'tauri-ws',
          wsUrl: config.wsUrl,
          token: config.token,
          sessionKey: config.sessionKey,
        } as GatewayTransport;
      } catch {
        return null;
      }
    })();
  }

  return cachedOpenClawTransportPromise;
}

async function resolveTransport(explicit?: GatewayTransport): Promise<GatewayTransport> {
  if (explicit) return explicit;

  const openclaw = await getDefaultOpenClawTransport();
  if (openclaw) return openclaw;

  return { mode: 'http-openai', baseUrl: DEFAULT_HTTP_GATEWAY_URL };
}

export function markActiveSendRun(runId: string): void {
  activeSendRun = { runId, startedAt: Date.now() };
}

export function clearActiveSendRun(runId?: string): void {
  if (!activeSendRun) return;
  if (!runId || activeSendRun.runId === runId) {
    activeSendRun = null;
  }
}

function shouldSuppressForActiveSend(runId?: string): boolean {
  if (!runId || !activeSendRun) return false;
  if (activeSendRun.runId !== runId) return false;
  return Date.now() - activeSendRun.startedAt <= ACTIVE_SEND_DEDUP_WINDOW_MS;
}

function emit(event: SystemEvent): void {
  for (const listener of systemEventListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[Gateway] System event listener error:', error);
    }
  }
}

export function subscribeSystemEvents(listener: SystemEventListener): () => void {
  systemEventListeners.add(listener);
  return () => systemEventListeners.delete(listener);
}

export async function wireSystemEventBus(): Promise<void> {
  if (systemEventUnsubscribe) {
    systemEventUnsubscribe();
    systemEventUnsubscribe = null;
  }

  const { getConnectionInstance } = await import('./tauri-websocket');
  const connection = getConnectionInstance();
  if (!connection) return;

  systemEventUnsubscribe = connection.subscribe((eventName: string, payload: unknown) => {
    if (eventName !== 'chat') return;

    const chat = (typeof payload === 'object' && payload !== null
      ? payload
      : {}) as Record<string, unknown>;
    const state = typeof chat.state === 'string' ? chat.state : '';
    const sessionKey = typeof chat.sessionKey === 'string' ? chat.sessionKey : undefined;
    const runId = typeof chat.runId === 'string' ? chat.runId : undefined;
    const announce = parseAnnounceMetadata(chat, true);

    if (
      shouldSuppressForActiveSend(runId) &&
      (Boolean(announce) || state === 'error' || state === 'final')
    ) {
      return;
    }

    if (state === 'compacted' || state === 'compacting' || state === 'compaction_complete') {
      emit({ kind: 'compaction', sessionKey, runId, message: 'Conversation compacted' });
    }

    if (state === 'error') {
      emit({
        kind: 'error',
        sessionKey,
        runId,
        message: typeof chat.errorMessage === 'string' ? chat.errorMessage : 'Unknown error',
        label: typeof chat.label === 'string' ? chat.label : undefined,
      });
    }

    if (announce) {
      const messageText =
        typeof chat.message === 'string' ? chat.message : extractText(chat.message);
      emit({
        kind: 'announce',
        sessionKey: announce.sessionKey ?? sessionKey,
        runId: announce.runId ?? runId,
        label: announce.label,
        status: announce.status,
        runtime: announce.runtime,
        tokens: announce.tokens,
        message: messageText || undefined,
        raw: chat,
      });
    }
  });
}

export function teardownSystemEventBus(): void {
  if (systemEventUnsubscribe) {
    systemEventUnsubscribe();
    systemEventUnsubscribe = null;
  }
  systemEventListeners.clear();
}

async function sendViaOpenAIHttp(
  messages: ChatMessage[],
  attachments: GatewayImageAttachment[],
  transport: GatewayTransport,
): Promise<string> {
  const baseUrl =
    transport.mode === 'http-openai' ? transport.baseUrl ?? DEFAULT_HTTP_GATEWAY_URL : DEFAULT_HTTP_GATEWAY_URL;
  const payloadMessages = toOpenAIMessagePayload(messages, attachments);

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: payloadMessages }),
  });

  if (!response.ok) {
    throw new Error(`Gateway error: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Gateway returned non-JSON response. Check OpenClaw API endpoint.');
  }

  const data: unknown = await response.json();
  if (!isChatCompletionResponse(data)) {
    throw new Error('Unexpected response shape from gateway');
  }

  return data.choices[0].message.content;
}

async function openOpenClawConnection(transport: GatewayTransport): Promise<OpenClawConnection> {
  if (transport.mode !== 'openclaw-ws') {
    throw new Error('OpenClaw connection requires ws transport');
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(transport.wsUrl);
    const pending = new Map<
      string,
      {
        resolve: (payload: unknown) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
      }
    >();
    const subscribers = new Set<(event: string, payload: unknown) => void>();
    let settled = false;

    const closeAndReject = (reason: unknown) => {
      if (!settled) {
        settled = true;
        reject(mapOpenClawConnectionError(reason));
      }

      for (const [, entry] of pending) {
        clearTimeout(entry.timeout);
        entry.reject(new Error('Gateway connection closed'));
      }
      pending.clear();

      try {
        socket.close();
      } catch {
        // ignore close failures
      }
    };

    const request = (method: string, params: unknown, timeoutMs = OPENCLAW_REQUEST_TIMEOUT_MS) =>
      new Promise<unknown>((resolveRequest, rejectRequest) => {
        if (socket.readyState !== WebSocket.OPEN) {
          rejectRequest(new Error('Gateway socket is not open'));
          return;
        }

        const id = getRequestId();
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectRequest(new Error(`Gateway request timed out (${method})`));
        }, timeoutMs);

        pending.set(id, {
          resolve: (payload) => {
            clearTimeout(timeout);
            resolveRequest(payload);
          },
          reject: (error) => {
            clearTimeout(timeout);
            rejectRequest(error);
          },
          timeout,
        });

        const message: OpenClawReqMessage = {
          type: 'req',
          id,
          method,
          params,
        };

        socket.send(JSON.stringify(message));
      });

    socket.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data ?? ''));
      } catch {
        return;
      }

      const message = parsed as Record<string, unknown>;
      if (message.type === 'res') {
        const response = message as unknown as OpenClawResMessage;
        const current = pending.get(response.id);
        if (!current) return;
        pending.delete(response.id);

        if (response.ok) {
          current.resolve(response.payload);
        } else {
          current.reject(mapOpenClawConnectionError(response.error ?? new Error('Request failed')));
        }
        return;
      }

      if (message.type === 'event') {
        const gatewayEvent = message as unknown as OpenClawEventMessage;
        for (const subscriber of subscribers) {
          subscriber(gatewayEvent.event, gatewayEvent.payload);
        }
      }
    });

    socket.addEventListener('error', () => {
      closeAndReject(new Error('Failed to connect to OpenClaw gateway'));
    });

    socket.addEventListener('close', (event) => {
      if (!settled) {
        closeAndReject(new Error(`Gateway closed (${event.code})`));
      }
    });

    socket.addEventListener('open', async () => {
      try {
        await request(
          'connect',
          {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: OPENCLAW_CLIENT_ID,
              version: 'pipeline-dashboard',
              platform: 'tauri',
              mode: 'webchat',
            },
            role: 'operator',
            scopes: OPENCLAW_SCOPES,
            auth: transport.token ? { token: transport.token } : undefined,
            userAgent: 'pipeline-dashboard',
            locale: 'en-US',
          },
          OPENCLAW_CONNECT_TIMEOUT_MS,
        );

        settled = true;
        resolve({
          request,
          subscribe: (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
          },
          close: () => socket.close(),
        });
      } catch (error) {
        closeAndReject(error);
      }
    });
  });
}

async function waitForOpenClawRun(
  connection: OpenClawConnection,
  sessionKey: string,
  runId: string,
  onStreamDelta?: (content: string) => void,
): Promise<string> {
  let streamedText = '';

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for OpenClaw response'));
    }, OPENCLAW_CHAT_TIMEOUT_MS);

    const unsubscribe = connection.subscribe((eventName, payload) => {
      if (eventName !== 'chat') return;

      const chat = (typeof payload === 'object' && payload !== null
        ? payload
        : {}) as Record<string, unknown>;

      if (typeof chat.sessionKey === 'string' && chat.sessionKey !== sessionKey) return;
      if (typeof chat.runId === 'string' && chat.runId !== runId) return;

      const state = typeof chat.state === 'string' ? chat.state : '';

      if (state === 'delta') {
        const deltaText = extractText(chat.message);
        if (deltaText && deltaText.length >= streamedText.length) {
          streamedText = deltaText;
          // Call the streaming callback if provided
          if (onStreamDelta) {
            onStreamDelta(streamedText);
          }
        }
        return;
      }

      if (state === 'error') {
        clearTimeout(timeout);
        unsubscribe();
        reject(new Error(typeof chat.errorMessage === 'string' ? chat.errorMessage : 'OpenClaw chat error'));
        return;
      }

      if (state === 'aborted') {
        clearTimeout(timeout);
        unsubscribe();
        reject(new Error('OpenClaw chat aborted'));
        return;
      }

      if (state === 'final') {
        // Extract final content if present - the final event may contain the complete message
        const finalText = extractText(chat.message);
        if (finalText && finalText.length >= streamedText.length) {
          streamedText = finalText;
          if (onStreamDelta) {
            onStreamDelta(streamedText);
          }
        }
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });

  if (streamedText.trim()) return streamedText.trim();

  const history = (await connection.request('chat.history', {
    sessionKey,
    limit: 20,
  })) as Record<string, unknown>;
  const messages = Array.isArray(history.messages) ? history.messages : [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as Record<string, unknown>;
    if (message.role !== 'assistant') continue;
    const text = extractText(message.content);
    if (text.trim()) return text.trim();
  }

  return '';
}

async function sendViaOpenClawWs(
  messageText: string,
  attachments: GatewayImageAttachment[],
  transport: GatewayTransport,
  onStreamDelta?: (content: string) => void,
): Promise<string> {
  if (transport.mode !== 'openclaw-ws') {
    throw new Error('OpenClaw transport is not configured');
  }

  const connection = await openOpenClawConnection(transport);
  const sessionKey = transport.sessionKey?.trim() || DEFAULT_SESSION_KEY;
  const runId = getRequestId();

  try {
    await connection.request('chat.send', {
      sessionKey,
      message: messageText,
      deliver: false,
      idempotencyKey: runId,
      attachments: attachments.length > 0 ? toOpenClawAttachments(attachments) : undefined,
    });

    return await waitForOpenClawRun(connection, sessionKey, runId, onStreamDelta);
  } finally {
    connection.close();
  }
}

async function sendViaTauriOpenClaw(
  messageText: string,
  attachments: GatewayImageAttachment[],
  transport: GatewayTransport,
): Promise<string> {
  if (transport.mode !== 'tauri-openclaw') {
    throw new Error('Tauri OpenClaw transport is not configured');
  }

  const converted = toOpenClawAttachments(attachments);
  const mappedAttachments = converted.map((attachment, index) => ({
    name: attachments[index]?.name,
    mimeType: attachment.mimeType,
    content: attachment.content,
  }));

  return sendOpenClawMessage({
    message: messageText,
    attachments: mappedAttachments,
    sessionKey: transport.sessionKey,
  });
}

function setAgentActivity(
  next: 'idle' | 'typing' | 'working',
  onActivityChange?: (state: 'idle' | 'typing' | 'working') => void,
): void {
  useDashboardStore.getState().setAgentActivity(next);
  if (onActivityChange) onActivityChange(next);
}

async function sendViaTauriWs(
  messageText: string,
  attachments: GatewayImageAttachment[],
  transport: GatewayTransport,
  onStreamDelta?: (content: string) => void,
  onActivityChange?: (state: 'idle' | 'typing' | 'working') => void,
): Promise<SendResult> {
  if (transport.mode !== 'tauri-ws') {
    throw new Error('Tauri WebSocket transport is not configured');
  }

  const { getTauriOpenClawConnection } = await import('./tauri-websocket');
  const connection = await getTauriOpenClawConnection(
    transport.wsUrl,
    transport.sessionKey || DEFAULT_SESSION_KEY,
    transport.token,
  );

  const sessionKey = transport.sessionKey?.trim() || DEFAULT_SESSION_KEY;
  const runId = getRequestId();
  let streamedText = '';

  try {
    markActiveSendRun(runId);
    setAgentActivity('working', onActivityChange);

    // Subscribe to events BEFORE sending so we never miss early deltas.
    // The gateway may start emitting events as soon as chat.send is acknowledged,
    // and if we subscribe after, fast responses can be completely lost.
    await new Promise<void>((resolve, reject) => {
      let completed = false;
      let finalDebounceTimer: ReturnType<typeof setTimeout> | null = null;
      let sawFinal = false;
      let idleTimeout: ReturnType<typeof setTimeout> | null = null;
      let unsubscribeState: (() => void) | null = null;

      const cancelFinalDebounce = () => {
        if (finalDebounceTimer) {
          clearTimeout(finalDebounceTimer);
          finalDebounceTimer = null;
        }
      };

      const resetIdleTimeout = () => {
        // Don't idle-timeout during an active send. The activity label
        // in App.tsx already falls back to "Working..." while chatSending
        // is true, so we only need this timeout as a safety net for truly
        // orphaned sends (e.g. missed final event). 5 minutes matches
        // OPENCLAW_CHAT_TIMEOUT_MS.
        if (idleTimeout) clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
          setAgentActivity('idle', onActivityChange);
        }, 5 * 60 * 1000);
      };

      const startFinalDebounce = () => {
        cancelFinalDebounce();
        finalDebounceTimer = setTimeout(() => {
          cleanup();
          resolve();
        }, 2000);
      };

      const cleanup = () => {
        if (completed) return;
        completed = true;
        clearTimeout(safetyTimeout);
        clearInterval(pollInterval);
        cancelFinalDebounce();
        if (idleTimeout) {
          clearTimeout(idleTimeout);
          idleTimeout = null;
        }
        if (unsubscribeState) {
          unsubscribeState();
          unsubscribeState = null;
        }
        unsubscribe();
      };

      const safetyTimeout = setTimeout(() => {
        console.warn('[Gateway] Safety timeout after 30 minutes');
        cleanup();
        resolve();
      }, 30 * 60 * 1000);

      let lastEventTime = Date.now();
      let resubscribeCount = 0;

      // Watch for WS connection state changes during send.
      // If connection drops and reconnects, re-subscribe to events so we
      // don't lose streaming deltas.
      unsubscribeState = connection.onStateChange((wsState) => {
        if (completed) return;
        if (wsState === 'disconnected' || wsState === 'reconnecting') {
          console.warn('[Gateway] WS connection lost during active send, state:', wsState);
          // Keep activity visible so user knows we're aware
          setAgentActivity('working', onActivityChange);
        } else if (wsState === 'connected' && resubscribeCount < 3) {
          // Connection restored — re-subscribe to pick up remaining events
          console.log('[Gateway] WS reconnected during send, re-subscribing (attempt', resubscribeCount + 1, ')');
          resubscribeCount++;
          unsubscribe();
          unsubscribe = connection.subscribe(eventHandler);
          // Reset event timer so poll doesn't fire immediately
          lastEventTime = Date.now();
        }
      });

      // Record when the send started so the poll can ignore older messages
      const sendStartedAt = Date.now();

      const pollInterval = setInterval(async () => {
        if (completed) return;

        const timeSinceLastEvent = Date.now() - lastEventTime;
        if (timeSinceLastEvent < 10000) {
          return;
        }

        try {
          const pollHistory = (await connection.request('chat.history', {
            sessionKey,
            limit: 5,
          })) as { messages?: Array<Record<string, unknown>> };

          const messages = pollHistory.messages ?? [];

          // Find the latest assistant message that arrived AFTER we sent our request.
          // Without this check, the poll resolves with a previous response when
          // the agent is doing tool calls and hasn't sent any text yet.
          const latestAssistant = messages.find((m) => {
            if (m.role !== 'assistant') return false;
            const ts = typeof m.timestamp === 'number' ? m.timestamp : 0;
            return ts > sendStartedAt;
          });

          if (latestAssistant) {
            const content = extractText(latestAssistant.content);
            if (content && content.length > streamedText.length) {
              streamedText = content;
              if (onStreamDelta) {
                onStreamDelta(streamedText);
              }
            }

            if (content) {
              cleanup();
              resolve();
            }
          }
        } catch (error) {
          console.warn('[Gateway] Poll failed:', error);
        }
      }, 10000);

      const stateLabels: Record<string, string> = {
        compacting: 'Compacting conversation...',
        compacted: 'Compacting conversation...',
      };

      // Track whether we've crossed a tool-call boundary since the last content block.
      // When the agent sends text → tool calls → more text, the second text block's
      // delta content restarts from zero length. Without this tracking, the length
      // check silently drops the new block (it's shorter than what we accumulated).
      let sawToolSinceLastContent = false;
      let contentBlockOffset = 0; // Byte offset where the current content block starts within streamedText

      const eventHandler = (eventName: string, payload: unknown) => {
        if (completed) return;

        lastEventTime = Date.now();
        resetIdleTimeout();

        if (eventName !== 'chat') return;

        const chat = (typeof payload === 'object' && payload !== null
          ? payload
          : {}) as Record<string, unknown>;

        if (typeof chat.sessionKey === 'string' && chat.sessionKey !== sessionKey) return;
        if (typeof chat.runId === 'string' && chat.runId !== runId) return;

        const state = typeof chat.state === 'string' ? chat.state : '';

        if (state && stateLabels[state]) {
          setAgentActivity('working', onActivityChange);
        }

        if (TOOL_ACTIVITY_STATES.has(state) && sawFinal) {
          cancelFinalDebounce();
        }

        if (TYPING_ACTIVITY_STATES.has(state)) {
          setAgentActivity('typing', onActivityChange);
        } else if (TOOL_ACTIVITY_STATES.has(state)) {
          setAgentActivity('working', onActivityChange);
          sawToolSinceLastContent = true;
        } else if (TERMINAL_ACTIVITY_STATES.has(state)) {
          setAgentActivity('idle', onActivityChange);
        }

        const announce = parseAnnounceMetadata(chat, true);
        if (announce) {
          const messageText =
            typeof chat.message === 'string' ? chat.message : extractText(chat.message);
          emit({
            kind: 'announce',
            sessionKey: announce.sessionKey ?? sessionKey,
            runId: announce.runId ?? runId,
            label: announce.label,
            status: announce.status,
            runtime: announce.runtime,
            tokens: announce.tokens,
            message: messageText || undefined,
            raw: chat,
          });
        }

        if (state === 'delta' || state === 'content' || state === 'streaming') {
          const deltaText = extractText(chat.message);
          if (deltaText) {
            if (sawToolSinceLastContent && deltaText.length < streamedText.length) {
              // New content block after tool calls — append with separator.
              contentBlockOffset = streamedText.length + 2; // +2 for '\n\n'
              streamedText = streamedText + '\n\n' + deltaText;
              sawToolSinceLastContent = false;
              console.log(`[Gateway] New content block after tools, offset=${contentBlockOffset}, total=${streamedText.length}`);
            } else if (contentBlockOffset > 0 && deltaText.length < streamedText.length) {
              // Cumulative delta within a post-tool content block.
              streamedText = streamedText.slice(0, contentBlockOffset) + deltaText;
            } else if (deltaText.length >= streamedText.length) {
              // Normal cumulative delta within current content block.
              streamedText = deltaText;
            } else {
              // Out-of-order / shorter delta — log for diagnostics
              console.warn(`[Gateway] Dropped delta: deltaLen=${deltaText.length}, streamedLen=${streamedText.length}, offset=${contentBlockOffset}, sawTool=${sawToolSinceLastContent}`);
            }

            if (onStreamDelta) {
              onStreamDelta(streamedText);
            }
          }
          return;
        }

        if (state === 'error') {
          cleanup();
          clearActiveSendRun(runId);
          reject(new Error(typeof chat.errorMessage === 'string' ? chat.errorMessage : 'OpenClaw chat error'));
          return;
        }

        if (state === 'aborted') {
          cleanup();
          clearActiveSendRun(runId);
          reject(new Error('OpenClaw chat aborted'));
          return;
        }

        if (state === 'final') {
          const finalText = extractText(chat.message);
          console.log(`[Gateway] Final event: finalLen=${finalText?.length ?? 0}, streamedLen=${streamedText.length}`);
          if (finalText && finalText.length >= streamedText.length) {
            streamedText = finalText;
            if (onStreamDelta) {
              onStreamDelta(streamedText);
            }
          }
          sawFinal = true;
          clearActiveSendRun(runId);
          startFinalDebounce();
        }
      };

      let unsubscribe = connection.subscribe(eventHandler);

      // Now that events are subscribed, send the message.
      console.log('[Gateway] Sending chat.send via tauri-ws, connection.connected:', connection.connected);
      connection.request('chat.send', {
        sessionKey,
        message: messageText,
        deliver: false,
        idempotencyKey: runId,
        attachments: attachments.length > 0 ? toOpenClawAttachments(attachments) : undefined,
      }).then(() => {
        console.log('[Gateway] chat.send succeeded');
      }).catch((err) => {
        console.error('[Gateway] chat.send failed:', err);
        cleanup();
        clearActiveSendRun(runId);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

    await new Promise((r) => setTimeout(r, 50));

    const historyAfter = (await connection.request('chat.history', {
      sessionKey,
      limit: 100,
    })) as { messages?: Array<Record<string, unknown>> };

    const allMessages = historyAfter.messages ?? [];

    // History is chronological (oldest → newest).
    // Walk backwards from newest to find our user message, collecting
    // all assistant messages that came AFTER it (i.e. the response).
    const assistantMessages: ChatMessage[] = [];

    // Find the user message index (scan from the end)
    let userMessageIndex = -1;
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msg = allMessages[i];
      if (msg.role === 'user') {
        const userContent = extractText(msg.content);
        if (userContent.includes(messageText.slice(0, 50))) {
          userMessageIndex = i;
          break;
        }
      }
    }

    // Collect all assistant messages after the user message (in chronological order)
    if (userMessageIndex >= 0) {
      for (let i = userMessageIndex + 1; i < allMessages.length; i++) {
        const msg = allMessages[i];
        // Log raw content format for diagnostics
        const contentType = Array.isArray(msg.content)
          ? `array[${msg.content.length}]`
          : typeof msg.content;
        console.log(`[Gateway] History msg[${i}] role=${msg.role}, contentType=${contentType}, raw preview:`, 
          typeof msg.content === 'string' 
            ? msg.content.slice(0, 120) 
            : Array.isArray(msg.content) 
              ? msg.content.slice(0, 3).map((b: Record<string, unknown>) => ({ type: b.type, len: typeof b.text === 'string' ? b.text.length : '?' }))
              : '(object)');
        if (msg.role === 'assistant') {
          const content = extractText(msg.content);
          if (content.trim()) {
            assistantMessages.push({
              role: 'assistant',
              content: content.trim(),
              timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
            });
          }
        }
      }
    }

    // History is the source of truth for final messages.
    // Streaming was only for the live preview — it can be truncated if
    // deltas stopped arriving (WS hiccup, timing issues).
    // Only fall back to streaming if history extraction found nothing.
    const historyTotalLength = assistantMessages.reduce((sum, m) => sum + m.content.length, 0);
    console.log(`[Gateway] Post-send: history found ${assistantMessages.length} messages (${historyTotalLength} chars), streamed ${streamedText.trim().length} chars`);
    console.log(`[Gateway] Streamed text (${streamedText.trim().length} chars) preview: "${streamedText.trim().slice(0, 100)}..."`);
    console.log(`[Gateway] Streamed text TAIL: "...${streamedText.trim().slice(-100)}"`);
    if (assistantMessages.length > 0) {
      for (let i = 0; i < assistantMessages.length; i++) {
        console.log(`[Gateway] History msg[${i}]: ${assistantMessages[i].content.length} chars`);
        console.log(`[Gateway]   HEAD: "${assistantMessages[i].content.slice(0, 100)}..."`);
        console.log(`[Gateway]   TAIL: "...${assistantMessages[i].content.slice(-100)}"`);
      }
    }

    // If streaming accumulated MORE text than history returned, prefer the
    // streamed version. This happens when history returns only the final text
    // block of a multi-tool-call response (flattened), while streaming correctly
    // accumulated all content blocks with separators.
    const streamedTrimmed = streamedText.trim();
    if (streamedTrimmed && streamedTrimmed.length > historyTotalLength) {
      console.log(`[Gateway] Streamed content (${streamedTrimmed.length} chars) is longer than history (${historyTotalLength} chars) — using streamed as source of truth`);
      // Replace history messages with the complete streamed content
      assistantMessages.length = 0;
      assistantMessages.push({
        role: 'assistant',
        content: streamedTrimmed,
        timestamp: Date.now(),
      });
    } else if (assistantMessages.length === 0 && streamedTrimmed) {
      console.log('[Gateway] No history messages found, falling back to streamed content');
      assistantMessages.push({
        role: 'assistant',
        content: streamedTrimmed,
        timestamp: Date.now(),
      });
    }

    setAgentActivity('idle', onActivityChange);
    clearActiveSendRun(runId);

    return {
      messages: assistantMessages,
      lastContent: assistantMessages.length > 0
        ? assistantMessages[assistantMessages.length - 1].content
        : streamedText.trim(),
    };
  } catch (error) {
    setAgentActivity('idle', onActivityChange);
    clearActiveSendRun(runId);
    throw error;
  } finally {
    clearActiveSendRun(runId);
  }
}

export async function sendMessage(messages: ChatMessage[], options?: GatewayOptions): Promise<SendResult> {
  const transport = await resolveTransport(options?.transport);
  const attachments = options?.attachments ?? [];
  const messageText = latestUserContent(messages);
  const onStreamDelta = options?.onStreamDelta;
  const onActivityChange = options?.onActivityChange;

  if (transport.mode === 'tauri-ws') {
    if (!messageText) throw new Error('No message content to send');
    return sendViaTauriWs(messageText, attachments, transport, onStreamDelta, onActivityChange);
  }

  if (transport.mode === 'tauri-openclaw') {
    if (!messageText) throw new Error('No message content to send');
    // Note: Tauri CLI transport doesn't support streaming or multiple messages
    const content = await sendViaTauriOpenClaw(messageText, attachments, transport);
    return {
      messages: [{ role: 'assistant', content, timestamp: Date.now() }],
      lastContent: content,
    };
  }

  if (transport.mode === 'openclaw-ws') {
    if (!messageText) throw new Error('No message content to send');
    const content = await sendViaOpenClawWs(messageText, attachments, transport, onStreamDelta);
    return {
      messages: [{ role: 'assistant', content, timestamp: Date.now() }],
      lastContent: content,
    };
  }

  const content = await sendViaOpenAIHttp(messages, attachments, transport);
  return {
    messages: [{ role: 'assistant', content, timestamp: Date.now() }],
    lastContent: content,
  };
}

export async function sendMessageWithContext(
  messages: ChatMessage[],
  context: { view: string; selectedProject?: string },
  options?: GatewayOptions,
): Promise<SendResult> {
  const transport = await resolveTransport(options?.transport);
  const attachments = options?.attachments ?? [];
  const onStreamDelta = options?.onStreamDelta;
  const onActivityChange = options?.onActivityChange;
  const contextMessage = context.selectedProject
    ? `User is viewing project: ${context.selectedProject}`
    : `User is viewing: ${context.view}`;

  if (transport.mode === 'tauri-ws') {
    const userText = latestUserContent(messages);
    if (!userText) throw new Error('No message content to send');

    const composed = `${contextMessage}\n\n${userText}`;
    return sendViaTauriWs(composed, attachments, transport, onStreamDelta, onActivityChange);
  }

  if (transport.mode === 'tauri-openclaw') {
    const userText = latestUserContent(messages);
    if (!userText) throw new Error('No message content to send');

    const composed = `${contextMessage}\n\n${userText}`;
    // Note: Tauri CLI transport doesn't support streaming or multiple messages
    const content = await sendViaTauriOpenClaw(composed, attachments, transport);
    return {
      messages: [{ role: 'assistant', content, timestamp: Date.now() }],
      lastContent: content,
    };
  }

  if (transport.mode === 'openclaw-ws') {
    const userText = latestUserContent(messages);
    if (!userText) throw new Error('No message content to send');

    const composed = `${contextMessage}\n\n${userText}`;
    const content = await sendViaOpenClawWs(composed, attachments, transport, onStreamDelta);
    return {
      messages: [{ role: 'assistant', content, timestamp: Date.now() }],
      lastContent: content,
    };
  }

  const wrappedMessages: ChatMessage[] = [
    { role: 'system', content: contextMessage },
    ...messages,
  ];

  const content = await sendViaOpenAIHttp(wrappedMessages, attachments, transport);
  return {
    messages: [{ role: 'assistant', content, timestamp: Date.now() }],
    lastContent: content,
  };
}

export async function checkGatewayConnection(options?: { transport?: GatewayTransport }): Promise<boolean> {
  const transport = await resolveTransport(options?.transport);

  if (transport.mode === 'tauri-ws') {
    try {
      console.log('[Gateway] Checking tauri-ws connection:', transport.wsUrl);
      const { getTauriOpenClawConnection } = await import('./tauri-websocket');
      await getTauriOpenClawConnection(
        transport.wsUrl,
        transport.sessionKey || DEFAULT_SESSION_KEY,
        transport.token,
      );
      console.log('[Gateway] tauri-ws connection OK');
      return true;
    } catch (err) {
      console.error('[Gateway] tauri-ws connection failed:', err);
      return false;
    }
  }

  if (transport.mode === 'tauri-openclaw') {
    try {
      return checkOpenClawGatewayConnection();
    } catch {
      return false;
    }
  }

  if (transport.mode === 'openclaw-ws') {
    try {
      const connection = await openOpenClawConnection(transport);
      connection.close();
      return true;
    } catch {
      return false;
    }
  }

  try {
    const baseUrl = transport.baseUrl ?? DEFAULT_HTTP_GATEWAY_URL;
    const response = await fetch(`${baseUrl}/v1/models`, { method: 'GET' });
    if (!response.ok) return false;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) return false;
    const data: unknown = await response.json();
    return isModelListResponse(data);
  } catch {
    return false;
  }
}

export function retryGatewayConnection(): void {
  import('./tauri-websocket').then(({ getConnectionInstance }) => {
    const instance = getConnectionInstance();
    if (instance) {
      instance.retryManually();
    } else {
      void checkGatewayConnection();
    }
  });
}

export function subscribeConnectionState(
  listener: (state: ChatConnectionState) => void,
): () => void {
  let prev = useDashboardStore.getState().wsConnectionState;
  listener(prev);

  return useDashboardStore.subscribe((state) => {
    if (state.wsConnectionState === prev) return;
    prev = state.wsConnectionState;
    if (prev === 'disconnected' || prev === 'error') {
      useDashboardStore.getState().setAgentActivity('idle');
    }
    listener(prev);
  });
}

export async function pollProcessSessions(
  sessionKeys: string[],
  transportOverride?: GatewayTransport,
): Promise<Array<{ sessionKey: string; exitCode: number; error?: string }>> {
  const failures: Array<{ sessionKey: string; exitCode: number; error?: string }> = [];
  const transport = await resolveTransport(transportOverride);
  if (transport.mode !== 'tauri-ws') return failures;

  const { getTauriOpenClawConnection } = await import('./tauri-websocket');
  const connection = await getTauriOpenClawConnection(
    transport.wsUrl,
    transport.sessionKey || DEFAULT_SESSION_KEY,
    transport.token,
  );

  for (const sessionKey of sessionKeys) {
    try {
      const result = await connection.request<{ exitCode?: number; error?: string }>('process', {
        action: 'poll',
        sessionKey,
      });

      if (result?.exitCode !== undefined && result.exitCode !== 0) {
        failures.push({
          sessionKey,
          exitCode: result.exitCode,
          error: typeof result.error === 'string' ? result.error : undefined,
        });
      }
    } catch {
      // Ignore poll transport failures.
    }
  }

  return failures;
}
