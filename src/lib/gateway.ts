import {
  chatPendingTurnRemove,
  chatPendingTurnSave,
  chatPendingTurnsLoad,
  chatRecoveryCursorAdvance,
  chatRecoveryCursorGet,
  checkOpenClawGatewayConnection,
  getOpenClawSessionsList,
  getOpenClawGatewayConfig,
  isTauriRuntime,
  sendOpenClawMessage,
} from './tauri';
import type { ChatConnectionState } from '../components/chat/types';
import { useDashboardStore } from './store';
import { CHAT_RELIABILITY_FLAGS } from './chat-reliability-flags';
import {
  normalizeChatContentForMatch,
  stripAssistantControlDirectives,
  unwrapGatewayContextWrappedUserContent,
} from './chat-normalization';
import { TurnLifecycleEngine } from './chat-turn-engine';

export type SystemBubbleKind = 'completion' | 'failure' | 'compaction' | 'decision' | 'info';

export type SystemBubbleAction =
  | string
  | { label: string; actionId: string; payload?: Record<string, unknown> };

export interface SystemBubbleMeta {
  kind: SystemBubbleKind;
  title: string;
  details?: Record<string, string>;
  actions?: SystemBubbleAction[];
  runId?: string;
  loading?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  _id?: string;
  systemMeta?: SystemBubbleMeta;
}

export interface UsageSnapshot {
  used: number;
  max: number;
  percent: number;
}

export interface SendResult {
  messages: ChatMessage[];
  lastContent: string; // For backward compatibility / streaming display
  runtimeModel?: string | null;
  runtimeProvider?: string | null;
  runtimeSource?: 'run' | 'session';
  usage?: UsageSnapshot | null;
  /** True when the run was terminated by a user-initiated chat.abort. */
  aborted?: boolean;
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
  /** Override the default session key for scoped chat sessions (hub chats). */
  sessionKey?: string;
  onStreamDelta?: (content: string) => void;
  onActivityChange?: (state: 'idle' | 'typing' | 'working' | 'compacting') => void;
  idempotencyKey?: string;
  /** Skip the global turn registry for scoped/independent chat sessions. */
  skipTurnTracking?: boolean;
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

export const DEFAULT_SESSION_KEY = 'agent:main:clawchestra';
const OPENCLAW_SESSION_KEY_OVERRIDE_STORAGE_KEY = 'clawchestra.openclaw.session_key_override';
const OPENCLAW_SESSION_KEY_RECOVERY_SUFFIX = ':recovery:';
const DEFAULT_HTTP_GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:18789';
const OPENCLAW_CONNECT_TIMEOUT_MS = 12000;
const OPENCLAW_REQUEST_TIMEOUT_MS = 20000;
const OPENCLAW_CHAT_TIMEOUT_MS = 300000; // 5 minutes for long operations (sub-agents, complex tool use)
const OPENCLAW_WS_SERVER_MAX_PAYLOAD_BYTES = 512 * 1024;
const OPENCLAW_WS_PAYLOAD_HEADROOM_BYTES = 16 * 1024;
const OPENCLAW_WS_CLIENT_PAYLOAD_BUDGET_BYTES =
  OPENCLAW_WS_SERVER_MAX_PAYLOAD_BYTES - OPENCLAW_WS_PAYLOAD_HEADROOM_BYTES;
const FINAL_NO_CONTENT_TIMEOUT_MS = 45000;
const FINAL_NO_CONTENT_ACTIVITY_GRACE_MS = 15000;
const FINAL_STABILITY_POLLS = 2;
const FINAL_SETTLE_WINDOW_MS = 15000;
const FINAL_SETTLE_POLL_MS = 2000;
const FINAL_SETTLE_STABLE_POLLS = 2;
const NO_FINAL_RESOLVE_MIN_SEND_AGE_MS = 45000;
const NO_FINAL_RESOLVE_MIN_QUIET_MS = 25000;
const NO_FINAL_STABILITY_POLLS = 4;
const NO_FINAL_MAX_WAIT_MS = 120000;
const NO_FINAL_RECENT_ACTIVITY_GRACE_MS = 30000;
const NO_FINAL_FORCE_RESOLVE_MS = 180000;
const NO_EVENTS_AFTER_SEND_TIMEOUT_MS = 180000;
const ACTIVE_RUN_NO_FINAL_TIMEOUT_MS = 12 * 60_000;
const UNACKED_SEND_CONFIRM_TIMEOUT_MS = 20_000;
const UNSCOPED_AGENT_PROGRESS_GRACE_MS = 15_000;
const BACKFILL_POLL_FAST_MS = 1000;
const BACKFILL_POLL_MEDIUM_MS = 2000;
const BACKFILL_POLL_SLOW_MS = 5000;
const BACKFILL_POLL_MAX_MS = 15000;
const BACKFILL_JITTER_RATIO = 0.2;
const TURN_PERSIST_THROTTLE_MS = 1500;
const GATEWAY_DEBUG_STORAGE_KEY = 'clawchestra.gateway.debug';
const GATEWAY_DEBUG_AUTO_STORAGE_KEY = 'clawchestra.gateway.debug.auto';
let gatewayDebugAutoRemaining = readGatewayDebugAutoFlag() ? 2 : 0;
const OPENCLAW_CLIENT_ID = 'openclaw-control-ui';

function readGatewayDebugStorageFlag(): boolean {
  try {
    return typeof localStorage !== 'undefined' &&
      localStorage.getItem(GATEWAY_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readGatewayDebugAutoFlag(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    const existing = sessionStorage.getItem(GATEWAY_DEBUG_AUTO_STORAGE_KEY);
    if (existing === null) {
      sessionStorage.setItem(GATEWAY_DEBUG_AUTO_STORAGE_KEY, '1');
      return true;
    }
    return existing === '1';
  } catch {
    return false;
  }
}

function disableGatewayDebugAuto(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(GATEWAY_DEBUG_AUTO_STORAGE_KEY, '0');
  } catch {
    // Ignore storage failures.
  }
}

function isGatewayVerboseDebugEnabled(): boolean {
  return (
    import.meta.env.DEV ||
    import.meta.env.VITE_GATEWAY_DEBUG === '1' ||
    readGatewayDebugStorageFlag()
  );
}

function isGatewayDebugLogEnabled(): boolean {
  return isGatewayVerboseDebugEnabled() || gatewayDebugAutoRemaining > 0;
}

function consumeGatewayDebugAuto(): void {
  if (gatewayDebugAutoRemaining <= 0) return;
  gatewayDebugAutoRemaining -= 1;
  if (gatewayDebugAutoRemaining <= 0) {
    disableGatewayDebugAuto();
  }
}

const OPENCLAW_SCOPES = [
  'operator.read',
  'operator.write',
  'operator.admin',
  'operator.approvals',
  'operator.pairing',
  'chat.send',
  'chat.history',
];
const TURN_TERMINAL_RETENTION_MS = 60_000;
const LEGACY_TERMINAL_TURN_STATUSES = new Set([
  'completed',
  'failed',
  'timed_out',
  'timeout',
  'aborted',
  'cancelled',
  'canceled',
  'error',
  'terminal',
]);
const LEGACY_ACTIVE_TURN_STATUS_MAP: Record<string, Extract<TurnStatus, 'queued' | 'running' | 'awaiting_output'>> = {
  queued: 'queued',
  queue: 'queued',
  pending: 'queued',
  sending: 'running',
  sent: 'running',
  running: 'running',
  streaming: 'running',
  working: 'running',
  typing: 'running',
  awaiting_output: 'awaiting_output',
  awaiting_first_visible_output: 'awaiting_output',
  awaiting_settle: 'awaiting_output',
  settling: 'awaiting_output',
};

let cachedOpenClawTransportPromise: Promise<GatewayTransport | null> | null = null;
let pendingTurnMigrationNotice: string | null = null;
let cachedSessionKeyOverride: string | null | undefined;

interface AnnounceMetadata {
  label?: string;
  runtime?: string;
  status?: 'started' | 'running' | 'ok' | 'error' | 'timeout';
  tokens?: string;
  sessionKey?: string;
  runId?: string;
}

export type SystemEventKind = 'compaction' | 'error' | 'announce' | 'usage';

export interface SystemEvent {
  kind: SystemEventKind;
  sessionKey?: string;
  runId?: string;
  compactionState?: 'compacting' | 'compacted' | 'compaction_complete';
  label?: string;
  message?: string;
  status?: string;
  runtime?: string;
  tokens?: string;
  usage?: UsageSnapshot;
  raw?: Record<string, unknown>;
}

type SystemEventListener = (event: SystemEvent) => void;

export type TurnStatus =
  | 'queued'
  | 'running'
  | 'awaiting_output'
  | 'completed'
  | 'failed'
  | 'timed_out';

export interface PendingTurn {
  turnToken: string;
  sessionKey: string;
  runId?: string;
  status: TurnStatus;
  submittedAt: number;
  lastSignalAt: number;
  completedAt?: number;
  hasAssistantOutput: boolean;
  completionReason?: string;
}

type TurnRegistryListener = (turns: PendingTurn[]) => void;

let systemEventUnsubscribe: (() => void) | null = null;
const systemEventListeners = new Set<SystemEventListener>();
const turnRegistry = new Map<string, PendingTurn>();
const turnRegistryListeners = new Set<TurnRegistryListener>();
const turnLastPersistAt = new Map<string, number>();
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

interface ProcessPollSnapshot {
  terminal: boolean;
  exitCode?: number;
  error?: string;
}

type ProcessPollCapability =
  | 'unknown'
  | 'available'
  | 'unavailable_scope'
  | 'unavailable_transient'
  | 'unavailable_degraded';

function parseProcessPollSnapshot(result: unknown): ProcessPollSnapshot {
  const terminalStatuses = new Set([
    'completed',
    'complete',
    'finished',
    'done',
    'terminated',
    'exited',
    'failed',
    'failure',
    'error',
    'aborted',
    'cancelled',
    'canceled',
    'timeout',
    'timed_out',
    'timed-out',
  ]);
  const failureStatuses = new Set([
    'failed',
    'failure',
    'error',
    'aborted',
    'cancelled',
    'canceled',
    'timeout',
    'timed_out',
    'timed-out',
  ]);

  const fromRecord = (
    candidate: Record<string, unknown> | undefined,
  ): ProcessPollSnapshot | null => {
    if (!candidate) return null;

    const directExitCode =
      typeof candidate.exitCode === 'number' && Number.isFinite(candidate.exitCode)
        ? candidate.exitCode
        : typeof candidate.exit_code === 'number' && Number.isFinite(candidate.exit_code)
          ? candidate.exit_code
          : undefined;

    const error =
      typeof candidate.error === 'string' && candidate.error.trim().length > 0
        ? candidate.error
        : typeof candidate.errorMessage === 'string' && candidate.errorMessage.trim().length > 0
          ? candidate.errorMessage
          : undefined;

    const state =
      typeof candidate.state === 'string' ? candidate.state.toLowerCase() : undefined;
    const status =
      typeof candidate.status === 'string' ? candidate.status.toLowerCase() : undefined;

    const terminalByBoolean =
      candidate.completed === true || candidate.done === true || candidate.finished === true;
    const terminalByStatus =
      (state ? terminalStatuses.has(state) : false) ||
      (status ? terminalStatuses.has(status) : false);

    if (directExitCode !== undefined) {
      return {
        terminal: true,
        exitCode: directExitCode,
        ...(error ? { error } : {}),
      };
    }

    if (terminalByBoolean || terminalByStatus) {
      const failed =
        Boolean(error) ||
        (state ? failureStatuses.has(state) : false) ||
        (status ? failureStatuses.has(status) : false);
      return {
        terminal: true,
        exitCode: failed ? 1 : 0,
        ...(error ? { error } : {}),
      };
    }

    return null;
  };

  if (!result || typeof result !== 'object') {
    return { terminal: false };
  }

  const record = result as Record<string, unknown>;
  const direct = fromRecord(record);
  if (direct) return direct;

  const payload =
    record.payload && typeof record.payload === 'object'
      ? fromRecord(record.payload as Record<string, unknown>)
      : null;
  if (payload) return payload;

  const processObj =
    record.process && typeof record.process === 'object'
      ? fromRecord(record.process as Record<string, unknown>)
      : null;
  if (processObj) return processObj;

  return { terminal: false };
}

function estimateChatSendFrameBytes(params: Record<string, unknown>): number {
  // Match the WebSocket RPC envelope shape used in TauriOpenClawConnection.request().
  const probeMessage = {
    type: 'req',
    id: 'req-999999-9999999999999',
    method: 'chat.send',
    params,
  };
  return new TextEncoder().encode(JSON.stringify(probeMessage)).length;
}

function formatKiB(bytes: number): string {
  return `${Math.ceil(bytes / 1024)}KB`;
}

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
    // Some WS responses carry the message in .error (string or nested object)
    if (typeof record.error === 'string') return record.error;
    if (typeof record.error === 'object' && record.error !== null) {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === 'string') return nested.message;
    }
    if (typeof record.code === 'string') return record.code;
  }

  return 'Unknown gateway error';
}

function readSessionKeyOverride(): string | null {
  if (cachedSessionKeyOverride !== undefined) return cachedSessionKeyOverride;
  if (typeof window === 'undefined') {
    cachedSessionKeyOverride = null;
    return null;
  }

  try {
    const stored = window.localStorage.getItem(OPENCLAW_SESSION_KEY_OVERRIDE_STORAGE_KEY);
    cachedSessionKeyOverride = stored?.trim() || null;
    return cachedSessionKeyOverride;
  } catch {
    cachedSessionKeyOverride = null;
    return null;
  }
}

function writeSessionKeyOverride(sessionKey: string | null): void {
  const normalized = sessionKey?.trim() || null;
  cachedSessionKeyOverride = normalized;

  if (typeof window === 'undefined') return;
  try {
    if (normalized) {
      window.localStorage.setItem(OPENCLAW_SESSION_KEY_OVERRIDE_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(OPENCLAW_SESSION_KEY_OVERRIDE_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable in some runtimes.
  }
}

function normalizeSessionKeyForRecovery(baseSessionKey: string): string {
  const normalized = baseSessionKey.trim();
  if (!normalized) return DEFAULT_SESSION_KEY;
  const recoverySuffixIndex = normalized.indexOf(OPENCLAW_SESSION_KEY_RECOVERY_SUFFIX);
  if (recoverySuffixIndex <= 0) return normalized;
  return normalized.slice(0, recoverySuffixIndex);
}

export function getResolvedDefaultSessionKey(): string {
  return readSessionKeyOverride() ?? DEFAULT_SESSION_KEY;
}

/**
 * Abort the active run via OpenClaw's `chat.abort` RPC.
 * Uses the shared TauriOpenClawConnection singleton — no new connection needed.
 * Throws if no connection exists or the RPC fails.
 */
export async function abortActiveRun(
  sessionKey?: string,
): Promise<{ aborted: boolean; runIds: string[] }> {
  const { getConnectionInstance } = await import('./tauri-websocket');
  const connection = getConnectionInstance();
  if (!connection) throw new Error('No gateway connection');

  const key = sessionKey?.trim() || getResolvedDefaultSessionKey();
  console.log('[gateway] chat.abort → sessionKey:', key);

  const result = await connection.request<{ aborted?: boolean; runIds?: string[] }>(
    'chat.abort',
    { sessionKey: key },
  );
  console.log('[gateway] chat.abort response:', JSON.stringify(result));
  return {
    aborted: result?.aborted ?? false,
    runIds: Array.isArray(result?.runIds) ? result.runIds : [],
  };
}

function buildRecoverySessionKey(baseSessionKey: string): string {
  const root = normalizeSessionKeyForRecovery(baseSessionKey);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return `${root}${OPENCLAW_SESSION_KEY_RECOVERY_SUFFIX}${stamp}`;
}

function rotateSessionKeyForRecovery(baseSessionKey: string): string {
  const nextSessionKey = buildRecoverySessionKey(baseSessionKey);
  writeSessionKeyOverride(nextSessionKey);
  cachedOpenClawTransportPromise = null;
  return nextSessionKey;
}

function shouldAutoRecoverFromSendError(error: unknown): boolean {
  const lower = normalizeErrorMessage(error).toLowerCase();
  return (
    lower.includes('413 failed to parse request') ||
    lower.includes('context overflow') ||
    lower.includes('prompt too large for the model') ||
    lower.includes('payload too large')
  );
}

function withRetryIdempotencyKey(idempotencyKey?: string): string | undefined {
  const base = idempotencyKey?.trim();
  if (!base) return undefined;
  return `${base}:retry`;
}

function classifyProcessPollCapability(
  error: unknown,
  failureCount: number,
  failureThreshold: number,
): ProcessPollCapability {
  const normalizedError = normalizeErrorMessage(error).toLowerCase();
  const isScopeError =
    normalizedError.includes('missing scope') ||
    normalizedError.includes('operator.admin');

  if (isScopeError) return 'unavailable_scope';
  if (failureCount >= failureThreshold) return 'unavailable_degraded';
  return 'unavailable_transient';
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

function isFatalSendAckError(error: unknown): boolean {
  const lower = normalizeErrorMessage(error).toLowerCase();
  return (
    lower.includes('missing scope') ||
    lower.includes('operator.read') ||
    lower.includes('operator.write') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid token')
  );
}

function mapSendAckError(error: unknown): Error {
  const message = normalizeErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes('missing scope')) {
    return new Error(
      'OpenClaw websocket scopes are insufficient (require operator.read/operator.write). Repair local device pairing or gateway auth scopes, then retry.',
    );
  }

  if (lower.includes('unauthorized') || lower.includes('invalid token')) {
    return new Error(
      'OpenClaw websocket authentication failed. Verify `~/.openclaw/openclaw.json` gateway token and restart the gateway.',
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

function snapshotTurnRegistry(): PendingTurn[] {
  return [...turnRegistry.values()].sort((a, b) => a.submittedAt - b.submittedAt);
}

function emitTurnRegistry(): void {
  const snapshot = snapshotTurnRegistry();
  for (const listener of turnRegistryListeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('[Gateway] Turn registry listener error:', error);
    }
  }
}

function persistPendingTurn(turn: PendingTurn, force: boolean = false): void {
  if (!isTauriRuntime()) return;
  const now = Date.now();
  const lastPersist = turnLastPersistAt.get(turn.turnToken) ?? 0;
  if (!force && now - lastPersist < TURN_PERSIST_THROTTLE_MS) {
    return;
  }
  turnLastPersistAt.set(turn.turnToken, now);
  void chatPendingTurnSave({
    turnToken: turn.turnToken,
    sessionKey: turn.sessionKey,
    runId: turn.runId,
    status: turn.status,
    submittedAt: turn.submittedAt,
    lastSignalAt: turn.lastSignalAt,
    completedAt: turn.completedAt,
    hasAssistantOutput: turn.hasAssistantOutput,
    completionReason: turn.completionReason,
  }).catch((error) => {
    console.warn('[Gateway] Failed to persist pending turn:', error);
  });
}

function removePersistedPendingTurn(turnToken: string): void {
  if (!isTauriRuntime()) return;
  turnLastPersistAt.delete(turnToken);
  void chatPendingTurnRemove(turnToken).catch((error) => {
    console.warn('[Gateway] Failed to remove pending turn:', error);
  });
}

function isTurnActive(status: TurnStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'awaiting_output';
}

function upsertTurn(
  turnToken: string,
  updates: Partial<PendingTurn> & Pick<PendingTurn, 'sessionKey'>,
): PendingTurn {
  const current = turnRegistry.get(turnToken);
  const base: PendingTurn = current ?? {
    turnToken,
    sessionKey: updates.sessionKey,
    status: 'queued',
    submittedAt: Date.now(),
    lastSignalAt: Date.now(),
    hasAssistantOutput: false,
  };

  const next: PendingTurn = {
    ...base,
    ...updates,
    turnToken,
    sessionKey: updates.sessionKey || base.sessionKey,
    lastSignalAt: updates.lastSignalAt ?? Date.now(),
  };

  turnRegistry.set(turnToken, next);
  if (isTurnActive(next.status)) {
    const forcePersist =
      !current ||
      current.status !== next.status ||
      current.runId !== next.runId ||
      current.hasAssistantOutput !== next.hasAssistantOutput ||
      current.completionReason !== next.completionReason;
    persistPendingTurn(next, forcePersist);
  }
  emitTurnRegistry();
  return next;
}

function touchTurnSignal(turnToken: string): void {
  const current = turnRegistry.get(turnToken);
  if (!current) return;
  const nextTurn: PendingTurn = {
    ...current,
    lastSignalAt: Date.now(),
  };
  turnRegistry.set(turnToken, nextTurn);
  persistPendingTurn(nextTurn);
  emitTurnRegistry();
}

function finalizeTurn(
  turnToken: string,
  status: Extract<TurnStatus, 'completed' | 'failed' | 'timed_out'>,
  updates?: Partial<PendingTurn>,
): void {
  const current = turnRegistry.get(turnToken);
  if (!current) return;

  const finalized: PendingTurn = {
    ...current,
    ...updates,
    status,
    completedAt: Date.now(),
    lastSignalAt: Date.now(),
  };
  turnRegistry.set(turnToken, finalized);
  console.log('[Gateway][terminal]', {
    sendId: turnToken,
    sessionKey: finalized.sessionKey,
    runId: finalized.runId ?? null,
    status: finalized.status,
    reason: finalized.completionReason ?? `terminal_${status}`,
    hasAssistantOutput: finalized.hasAssistantOutput,
  });
  removePersistedPendingTurn(turnToken);
  emitTurnRegistry();

  setTimeout(() => {
    const latest = turnRegistry.get(turnToken);
    if (!latest) return;
    if (!latest.completedAt) return;
    if (Date.now() - latest.completedAt < TURN_TERMINAL_RETENTION_MS) return;
    turnRegistry.delete(turnToken);
    emitTurnRegistry();
  }, TURN_TERMINAL_RETENTION_MS + 250);
}

function getBackfillPollIntervalMs(submittedAt: number): number {
  const age = Date.now() - submittedAt;
  const base =
    age < 30_000
      ? BACKFILL_POLL_FAST_MS
      : age < 120_000
        ? BACKFILL_POLL_MEDIUM_MS
        : age < 10 * 60_000
          ? BACKFILL_POLL_SLOW_MS
          : BACKFILL_POLL_MAX_MS;

  const jitterWindow = Math.round(base * BACKFILL_JITTER_RATIO);
  const jittered = base + Math.round((Math.random() * 2 - 1) * jitterWindow);
  return Math.max(250, jittered);
}

// Hydration uses a shorter window than active-run timeout. At startup,
// we have no WS connection confirming the run is alive, so stale turns
// should expire quickly (2 min) rather than waiting the full 12 min.
const HYDRATION_STALE_MS = 2 * 60_000;

function isPendingTurnExpiredForHydration(turn: {
  status: TurnStatus;
  lastSignalAt: number;
}, now: number): boolean {
  if (!isTurnActive(turn.status)) return false;
  return now - turn.lastSignalAt > HYDRATION_STALE_MS;
}

function normalizeHydratedTurnStatus(
  status: string,
): {
  normalizedStatus: TurnStatus | null;
  migrated: boolean;
  terminalized: boolean;
} {
  const normalized = status.trim().toLowerCase();
  const mapped = LEGACY_ACTIVE_TURN_STATUS_MAP[normalized];
  if (mapped) {
    return {
      normalizedStatus: mapped,
      migrated: mapped !== normalized,
      terminalized: false,
    };
  }

  if (LEGACY_TERMINAL_TURN_STATUSES.has(normalized)) {
    return {
      normalizedStatus: null,
      migrated: false,
      terminalized: true,
    };
  }

  return {
    normalizedStatus: null,
    migrated: false,
    terminalized: true,
  };
}

export function consumePendingTurnMigrationNotice(): string | null {
  const notice = pendingTurnMigrationNotice;
  pendingTurnMigrationNotice = null;
  return notice;
}

export function getActiveTurnCount(): number {
  let count = 0;
  for (const turn of turnRegistry.values()) {
    if (isTurnActive(turn.status)) count += 1;
  }
  return count;
}

export function subscribeTurnRegistry(listener: TurnRegistryListener): () => void {
  turnRegistryListeners.add(listener);
  listener(snapshotTurnRegistry());
  return () => {
    turnRegistryListeners.delete(listener);
  };
}

export function finalizeActiveTurnsForSession(
  sessionKey: string,
  reason: string = 'session_terminal_probe',
): void {
  if (!sessionKey) return;
  for (const [turnToken, turn] of [...turnRegistry.entries()]) {
    if (!isTurnActive(turn.status)) continue;
    if (turn.sessionKey !== sessionKey) continue;
    const terminalStatus: Extract<TurnStatus, 'completed' | 'timed_out'> =
      turn.hasAssistantOutput ? 'completed' : 'timed_out';
    finalizeTurn(turnToken, terminalStatus, {
      sessionKey,
      runId: turn.runId,
      hasAssistantOutput: turn.hasAssistantOutput,
      completionReason: reason,
    });
  }
}

export async function hydratePendingTurns(sessionKey?: string): Promise<PendingTurn[]> {
  if (!isTauriRuntime()) return snapshotTurnRegistry();

  try {
    const persisted = await chatPendingTurnsLoad(sessionKey);
    turnRegistry.clear();
    turnLastPersistAt.clear();
    const now = Date.now();
    let migratedCount = 0;
    let terminalizedCount = 0;
    let expiredCount = 0;

    for (const turn of persisted) {
      const statusMapping = normalizeHydratedTurnStatus(turn.status);
      if (!statusMapping.normalizedStatus) {
        terminalizedCount += 1;
        removePersistedPendingTurn(turn.turnToken);
        continue;
      }

      if (statusMapping.migrated) {
        migratedCount += 1;
      }

      if (
        isPendingTurnExpiredForHydration(
          {
            status: statusMapping.normalizedStatus,
            lastSignalAt: turn.lastSignalAt,
          },
          now,
        )
      ) {
        expiredCount += 1;
        removePersistedPendingTurn(turn.turnToken);
        continue;
      }

      turnRegistry.set(turn.turnToken, {
        turnToken: turn.turnToken,
        sessionKey: turn.sessionKey,
        runId: turn.runId,
        status: statusMapping.normalizedStatus,
        submittedAt: turn.submittedAt,
        lastSignalAt: turn.lastSignalAt,
        completedAt: turn.completedAt,
        hasAssistantOutput: turn.hasAssistantOutput,
        completionReason:
          turn.completionReason ??
          (statusMapping.migrated ? `migrated_${turn.status.toLowerCase()}` : undefined),
      });
    }

    if (terminalizedCount > 0) {
      const noteParts: string[] = [];
      if (terminalizedCount > 0) noteParts.push(`terminalized ${terminalizedCount} incompatible turn(s)`);
      if (migratedCount > 0) noteParts.push(`migrated ${migratedCount} legacy turn(s)`);
      if (expiredCount > 0) noteParts.push(`cleared ${expiredCount} stale turn(s)`);
      pendingTurnMigrationNotice = `Recovered pending chat state: ${noteParts.join(', ')}.`;
    } else {
      pendingTurnMigrationNotice = null;
    }

    emitTurnRegistry();

    if (
      (terminalizedCount > 0 || expiredCount > 0) &&
      sessionKey &&
      CHAT_RELIABILITY_FLAGS.chat.recovery_cursoring
    ) {
      const survivingActive = [...turnRegistry.values()].some((t) => isTurnActive(t.status));
      if (!survivingActive) {
        try {
          await chatRecoveryCursorAdvance(sessionKey, now);
        } catch (cursorError) {
          console.warn('[Gateway] Failed to advance recovery cursor after hydration:', cursorError);
        }
      }
    }
  } catch (error) {
    console.warn('[Gateway] Failed to hydrate pending turns:', error);
  }

  return snapshotTurnRegistry();
}

function extractText(content: unknown, depth: number = 0): string {
  if (depth > 8) return '';
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part !== 'object' || part === null) return '';
        const record = part as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        if (typeof record.delta === 'string') return record.delta;
        if (typeof record.message === 'string') return record.message;
        if (record.type === 'text' && typeof record.content === 'string') return record.content;
        if (record.content !== undefined) return extractText(record.content, depth + 1);
        if (record.delta !== undefined) return extractText(record.delta, depth + 1);
        if (record.message !== undefined) return extractText(record.message, depth + 1);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof content === 'object' && content !== null) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.delta === 'string') return record.delta;
    if (typeof record.message === 'string') return record.message;
    if (record.content !== undefined) return extractText(record.content, depth + 1);
    if (record.delta !== undefined) return extractText(record.delta, depth + 1);
    if (record.message !== undefined) return extractText(record.message, depth + 1);
    if (record.output !== undefined) return extractText(record.output, depth + 1);
    if (record.data !== undefined) return extractText(record.data, depth + 1);
  }

  return '';
}

function extractChatEventMessageText(chat: Record<string, unknown>): string {
  const directCandidates: unknown[] = [
    chat.message,
    chat.delta,
    chat.content,
    chat.text,
    chat.output,
    chat.final,
  ];
  for (const candidate of directCandidates) {
    const text = extractText(candidate).trim();
    if (text.length > 0) return text;
  }

  const payloadRecord = extractOptionalRecord(chat.payload);
  if (payloadRecord) {
    const payloadCandidates: unknown[] = [
      payloadRecord.message,
      payloadRecord.delta,
      payloadRecord.content,
      payloadRecord.text,
      payloadRecord.output,
      payloadRecord.final,
    ];
    for (const candidate of payloadCandidates) {
      const text = extractText(candidate).trim();
      if (text.length > 0) return text;
    }
  }

  return '';
}

type GatewayHistoryMessage = Record<string, unknown>;

function isHistoryMessage(value: unknown): value is GatewayHistoryMessage {
  return typeof value === 'object' && value !== null;
}

function getHistoryMessageId(message: GatewayHistoryMessage): string | undefined {
  return typeof message.id === 'string' && message.id.trim().length > 0 ? message.id : undefined;
}

function getHistoryMessageTimestamp(message: GatewayHistoryMessage): number | undefined {
  if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) {
    return message.timestamp;
  }
  if (typeof message.timestamp === 'string') {
    const trimmed = message.timestamp.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
    const epoch = Date.parse(trimmed);
    if (Number.isFinite(epoch)) return epoch;
  }
  return undefined;
}

function getHistoryMessageRunId(message: GatewayHistoryMessage): string | undefined {
  return typeof message.runId === 'string' && message.runId.trim().length > 0
    ? message.runId
    : undefined;
}

function isNoReplySentinel(content: string): boolean {
  const compact = content.replace(/[\s_-]+/g, '').trim().toUpperCase();
  return compact === 'NOREPLY';
}

/** Detect partial NO_REPLY or HEARTBEAT sentinel fragments in streaming deltas.
 *  Pre-.26 OpenClaw may leak these before server-side suppression was added. */
function isStreamingSentinelFragment(content: string): boolean {
  const trimmed = content.trim().toUpperCase();
  if (!trimmed) return false;
  // Match partial NO_REPLY build-up and full sentinel
  if ('NO_REPLY'.startsWith(trimmed) || trimmed === 'NO_REPLY') return true;
  // Match HEARTBEAT_ prefixed sentinels
  if (trimmed.startsWith('HEARTBEAT_') || 'HEARTBEAT_'.startsWith(trimmed)) return true;
  return false;
}

function collectInternalNoReplyRunIds(messages: GatewayHistoryMessage[]): Set<string> {
  const runIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const runId = getHistoryMessageRunId(message);
    if (!runId) continue;
    const content = stripAssistantControlDirectives(extractText(message.content)).trim();
    if (!content) continue;
    if (!isNoReplySentinel(content)) continue;
    runIds.add(runId);
  }
  return runIds;
}

function shouldSuppressNoReplyRunAssistantMessage(
  message: GatewayHistoryMessage,
  noReplyRunIds: Set<string>,
): boolean {
  if (message.role !== 'assistant') return false;
  const content = stripAssistantControlDirectives(extractText(message.content)).trim();
  if (content && isNoReplySentinel(content)) return true;
  const runId = getHistoryMessageRunId(message);
  return Boolean(runId && noReplyRunIds.has(runId));
}

type RecoveryCursorSnapshot = {
  sessionKey: string;
  lastMessageId?: string;
  lastTimestamp: number;
};

const RECOVERY_CURSOR_FALLBACK_WINDOW_MS = 90_000;

function applyRecoveryCursorFilter(
  messages: GatewayHistoryMessage[],
  cursor: RecoveryCursorSnapshot | null,
): GatewayHistoryMessage[] {
  const chronological = toChronologicalHistory(messages);
  if (!cursor || !CHAT_RELIABILITY_FLAGS.chat.recovery_cursoring) {
    return chronological;
  }

  if (cursor.lastMessageId) {
    const cursorIndex = chronological.findIndex((message) => {
      const id = getHistoryMessageId(message);
      const timestamp = getHistoryMessageTimestamp(message);
      return id === cursor.lastMessageId && timestamp === cursor.lastTimestamp;
    });
    if (cursorIndex >= 0) {
      const afterCursor = chronological.slice(cursorIndex + 1);
      if (afterCursor.length > 0) return afterCursor;
    }
  }

  const newer = chronological.filter((message) => {
    const timestamp = getHistoryMessageTimestamp(message);
    if (timestamp === undefined) return false;
    return timestamp > cursor.lastTimestamp;
  });
  if (newer.length > 0) return newer;

  const lowerBound = cursor.lastTimestamp - RECOVERY_CURSOR_FALLBACK_WINDOW_MS;
  return chronological.filter((message) => {
    const timestamp = getHistoryMessageTimestamp(message);
    if (timestamp === undefined) return false;
    if (cursor.lastMessageId) {
      const id = getHistoryMessageId(message);
      if (id === cursor.lastMessageId && timestamp === cursor.lastTimestamp) {
        return false;
      }
    }
    return timestamp >= lowerBound;
  });
}

function toChronologicalHistory(
  messages: GatewayHistoryMessage[],
): GatewayHistoryMessage[] {
  if (messages.length < 2) return [...messages];

  const firstTimestamp = messages.find((message) => getHistoryMessageTimestamp(message) !== undefined);
  const lastTimestamp = [...messages]
    .reverse()
    .find((message) => getHistoryMessageTimestamp(message) !== undefined);

  const first = firstTimestamp ? getHistoryMessageTimestamp(firstTimestamp) : undefined;
  const last = lastTimestamp ? getHistoryMessageTimestamp(lastTimestamp) : undefined;

  if (first !== undefined && last !== undefined && first > last) {
    return [...messages].reverse();
  }

  return [...messages];
}

function extractUsageFromHistory(
  messages: GatewayHistoryMessage[],
  expectedRunId?: string,
): UsageSnapshot | null {
  const chronological = toChronologicalHistory(messages);
  for (let index = chronological.length - 1; index >= 0; index -= 1) {
    const message = chronological[index];
    if (message.role !== 'assistant') continue;
    const messageRunId = getHistoryMessageRunId(message);
    if (expectedRunId && messageRunId && messageRunId !== expectedRunId) {
      continue;
    }
    const usage = extractUsageSnapshot(message);
    if (usage) return usage;
  }
  return null;
}

type CompactionState = 'compacting' | 'compacted' | 'compaction_complete';

function resolveCompactionPresentation(
  state: CompactionState,
  semanticStatesEnabled: boolean,
): { title: string; loading: boolean; status: 'In progress' | 'Complete' } {
  const inProgress = semanticStatesEnabled && state === 'compacting';
  return {
    title: inProgress ? 'Compacting conversation...' : 'Conversation compacted',
    loading: inProgress,
    status: inProgress ? 'In progress' : 'Complete',
  };
}

function extractAssistantMessagesFromHistory(
  rawMessages: GatewayHistoryMessage[],
  options: {
    baselineIds: Set<string>;
    minTimestamp: number;
  },
): ChatMessage[] {
  const chronological = toChronologicalHistory(rawMessages);
  const seen = new Set<string>();
  const assistantMessages: ChatMessage[] = [];

  for (const message of chronological) {
    if (message.role !== 'assistant') continue;

    const id = getHistoryMessageId(message);
    const timestamp = getHistoryMessageTimestamp(message);

    if (id && options.baselineIds.has(id)) continue;
    if (timestamp !== undefined && timestamp < options.minTimestamp) continue;

    const content = stripAssistantControlDirectives(extractText(message.content)).trim();
    if (!content) continue;

    const dedupeKey = id ?? `${timestamp ?? 'na'}:${content}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    assistantMessages.push({
      role: 'assistant',
      content,
      timestamp: timestamp ?? stableSyntheticTimestamp('assistant', content),
      ...(id ? { _id: id } : {}),
    });
  }

  return collapseAssistantMessages(assistantMessages);
}

function normalizeTextForMatch(text: string): string {
  return normalizeChatContentForMatch(text);
}

const ASSISTANT_HISTORY_COLLAPSE_WINDOW_MS = 90_000;

function assistantMessagesOverlap(a: ChatMessage, b: ChatMessage): boolean {
  const aNorm = normalizeTextForMatch(a.content);
  const bNorm = normalizeTextForMatch(b.content);
  if (!aNorm || !bNorm) return false;
  return (
    aNorm === bNorm ||
    aNorm.startsWith(bNorm) ||
    bNorm.startsWith(aNorm)
  );
}

function assistantRunLooksProgressive(run: ChatMessage[], incoming: ChatMessage): boolean {
  const incomingNorm = normalizeTextForMatch(incoming.content);
  if (!incomingNorm) return false;
  return run.every((message) => {
    const norm = normalizeTextForMatch(message.content);
    if (!norm) return false;
    return incomingNorm.startsWith(norm) || norm.startsWith(incomingNorm);
  });
}

function choosePreferredAssistantMessage(a: ChatMessage, b: ChatMessage): ChatMessage {
  const aNormLength = normalizeTextForMatch(a.content).length;
  const bNormLength = normalizeTextForMatch(b.content).length;
  const preferB =
    bNormLength > aNormLength ||
    (bNormLength === aNormLength && (b.timestamp ?? 0) >= (a.timestamp ?? 0));

  if (preferB) {
    return {
      ...b,
      ...(b._id ? {} : a._id ? { _id: a._id } : {}),
    };
  }

  return {
    ...a,
    ...(a._id ? {} : b._id ? { _id: b._id } : {}),
  };
}

function collapseAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const collapsed: ChatMessage[] = [];

  for (const message of messages) {
    if (collapsed.length === 0) {
      collapsed.push(message);
      continue;
    }

    const last = collapsed[collapsed.length - 1];
    const withinPairWindow =
      Math.abs((message.timestamp ?? 0) - (last.timestamp ?? 0)) <= ASSISTANT_HISTORY_COLLAPSE_WINDOW_MS;
    if (last.role === 'assistant' && message.role === 'assistant' && withinPairWindow) {
      if (assistantMessagesOverlap(last, message)) {
        collapsed[collapsed.length - 1] = choosePreferredAssistantMessage(last, message);
        continue;
      }
    }

    if (message.role === 'assistant' && collapsed.length >= 2) {
      let runStart = collapsed.length;
      for (let i = collapsed.length - 1; i >= 0; i -= 1) {
        if (collapsed[i].role !== 'assistant') break;
        runStart = i;
      }

      if (runStart < collapsed.length - 1) {
        const run = collapsed.slice(runStart);
        const newestRunTs = run.reduce((latest, item) => Math.max(latest, item.timestamp ?? 0), 0);
        if (
          Math.abs((message.timestamp ?? 0) - newestRunTs) <= ASSISTANT_HISTORY_COLLAPSE_WINDOW_MS &&
          assistantRunLooksProgressive(run, message)
        ) {
          while (collapsed.length > runStart) {
            collapsed.pop();
          }
          const anchor = run[run.length - 1] ?? message;
          collapsed.push(choosePreferredAssistantMessage(anchor, message));
          continue;
        }
      }
    }

    collapsed.push(message);
  }

  return collapsed;
}

function stableSyntheticTimestamp(role: string, content: string): number {
  let hash = 2166136261;
  const input = `${role}:${content}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 1_700_000_000_000 + (hash >>> 0);
}

function likelyNeedsFinalSettlePass(messages: ChatMessage[]): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1]?.content?.trim() ?? '';
  if (!last) return true;

  // Unclosed code blocks often indicate truncated output.
  const codeFenceCount = (last.match(/```/g) ?? []).length;
  if (codeFenceCount % 2 === 1) return true;

  if (last.endsWith(':') || last.endsWith(',') || last.endsWith(';') || last.endsWith('...')) {
    return true;
  }

  // For longer replies, lack of terminal punctuation is suspicious.
  if (last.length > 220 && !/[.!?]$/.test(last)) {
    return true;
  }

  return false;
}

function isMessageNewForTurn(
  message: GatewayHistoryMessage,
  options: { baselineIds: Set<string>; minTimestamp: number },
): boolean {
  const id = getHistoryMessageId(message);
  if (id) return !options.baselineIds.has(id);
  const timestamp = getHistoryMessageTimestamp(message);
  return timestamp !== undefined && timestamp >= options.minTimestamp;
}

function hasMatchingUserTurnInHistory(
  chronological: GatewayHistoryMessage[],
  options: {
    baselineIds: Set<string>;
    minTimestamp: number;
    expectedUserText?: string;
  },
): boolean {
  const normalizedExpected =
    typeof options.expectedUserText === 'string' && options.expectedUserText.trim().length > 0
      ? normalizeTextForMatch(
          unwrapGatewayContextWrappedUserContent(options.expectedUserText) ??
            options.expectedUserText,
        )
      : '';
  if (!normalizedExpected) return false;

  for (const message of chronological) {
    if (message.role !== 'user') continue;
    if (isSyntheticSystemExecUserMessage(message)) continue;
    if (!isMessageNewForTurn(message, options)) continue;

    const rawContent = extractText(message.content);
    const normalizedContent = normalizeTextForMatch(
      unwrapGatewayContextWrappedUserContent(rawContent) ?? rawContent,
    );
    if (normalizedContent === normalizedExpected) {
      return true;
    }
  }

  return false;
}

function isSyntheticSystemExecUserMessage(message: GatewayHistoryMessage): boolean {
  if (message.role !== 'user') return false;
  const content = extractText(message.content).trim();
  return /^System:\s*\[[^\]]+\]\s*Exec\b/i.test(content);
}

function findUserAnchorIndex(
  chronological: GatewayHistoryMessage[],
  options: {
    baselineIds: Set<string>;
    minTimestamp: number;
    expectedUserText?: string;
    expectedRunId?: string;
  },
): number {
  const normalizedExpected =
    typeof options.expectedUserText === 'string' && options.expectedUserText.trim().length > 0
      ? normalizeTextForMatch(
          unwrapGatewayContextWrappedUserContent(options.expectedUserText) ??
            options.expectedUserText,
        )
      : '';

  for (let index = 0; index < chronological.length; index += 1) {
    const message = chronological[index];
    if (message.role !== 'user') continue;
    if (isSyntheticSystemExecUserMessage(message)) continue;
    if (!isMessageNewForTurn(message, options)) continue;

    if (!normalizedExpected) return index;

    const rawContent = extractText(message.content);
    const content = normalizeTextForMatch(
      unwrapGatewayContextWrappedUserContent(rawContent) ?? rawContent,
    );
    if (content === normalizedExpected) {
      return index;
    }
  }

  if (!normalizedExpected) return -1;

  // Fallback for wrapped/normalized gateway content: anchor to first new user turn.
  for (let index = 0; index < chronological.length; index += 1) {
    const message = chronological[index];
    if (message.role !== 'user') continue;
    if (isSyntheticSystemExecUserMessage(message)) continue;
    if (!isMessageNewForTurn(message, options)) continue;
    return index;
  }

  return -1;
}

function extractAssistantMessagesForTurn(
  rawMessages: GatewayHistoryMessage[],
  options: {
    baselineIds: Set<string>;
    minTimestamp: number;
    expectedUserText?: string;
    expectedRunId?: string;
  },
): ChatMessage[] {
  const chronological = toChronologicalHistory(rawMessages);
  const anchorIndex = findUserAnchorIndex(chronological, options);
  if (anchorIndex < 0) {
    return extractAssistantMessagesFromHistory(rawMessages, options);
  }

  const seen = new Set<string>();
  const assistantMessages: ChatMessage[] = [];

  for (let index = anchorIndex + 1; index < chronological.length; index += 1) {
    const message = chronological[index];

    if (message.role === 'user') {
      if (isSyntheticSystemExecUserMessage(message)) {
        continue;
      }
      break;
    }
    if (message.role !== 'assistant') continue;

    const id = getHistoryMessageId(message);
    const timestamp = getHistoryMessageTimestamp(message);
    const messageRunId = getHistoryMessageRunId(message);
    if (options.expectedRunId && messageRunId && messageRunId !== options.expectedRunId) {
      continue;
    }
    const shouldIncludeForTurn =
      (id !== undefined && !options.baselineIds.has(id)) ||
      (timestamp !== undefined && timestamp >= options.minTimestamp) ||
      (id === undefined && timestamp === undefined);
    if (!shouldIncludeForTurn) continue;

    const content = stripAssistantControlDirectives(extractText(message.content)).trim();
    if (!content) continue;

    const dedupeKey = id ?? `${timestamp ?? 'na'}:${content}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    assistantMessages.push({
      role: 'assistant',
      content,
      timestamp: timestamp ?? stableSyntheticTimestamp('assistant', content),
      ...(id ? { _id: id } : {}),
    });
  }

  return collapseAssistantMessages(assistantMessages);
}

function normalizeHistoryRole(role: unknown): ChatMessage['role'] | null {
  return role === 'assistant' || role === 'user' || role === 'system'
    ? role
    : null;
}

export async function recoverRecentSessionMessages(options?: {
  transport?: GatewayTransport;
  limit?: number;
  sessionKey?: string;
}): Promise<ChatMessage[]> {
  const transport = await resolveTransport(options?.transport);
  const limit = options?.limit ?? 200;

  if (transport.mode !== 'tauri-ws') {
    return [];
  }

  const { getTauriOpenClawConnection, getConnectionInstance } = await import('./tauri-websocket');
  const sessionKey = options?.sessionKey?.trim() || transport.sessionKey?.trim() || DEFAULT_SESSION_KEY;
  let recoveryCursor: RecoveryCursorSnapshot | null = null;
  if (CHAT_RELIABILITY_FLAGS.chat.recovery_cursoring) {
    try {
      const cursor = await chatRecoveryCursorGet(sessionKey);
      if (cursor) {
        recoveryCursor = {
          sessionKey: cursor.sessionKey,
          lastMessageId: cursor.lastMessageId,
          lastTimestamp: cursor.lastTimestamp,
        };
      }
    } catch (error) {
      console.warn('[Gateway] Failed to load recovery cursor:', error);
    }
  }
  // Reuse existing singleton to avoid disconnecting active sends (same issue as fetchSessionModel).
  const connection = getConnectionInstance() ?? await getTauriOpenClawConnection(
    transport.wsUrl,
    sessionKey,
    transport.token,
  );

  const history = (await connection.request('chat.history', {
    sessionKey,
    limit,
  })) as { messages?: unknown[] };

  const rawMessages = Array.isArray(history.messages)
    ? history.messages.filter(isHistoryMessage)
    : [];
  const noReplyRunIds = collectInternalNoReplyRunIds(rawMessages);

  const chronological = applyRecoveryCursorFilter(rawMessages, recoveryCursor);
  const seen = new Set<string>();
  const recovered: ChatMessage[] = [];

  for (const message of chronological) {
    const role = normalizeHistoryRole(message.role);
    if (!role) continue;

    if (shouldSuppressNoReplyRunAssistantMessage(message, noReplyRunIds)) {
      continue;
    }

    if (role === 'user' && isSyntheticSystemExecUserMessage(message)) {
      continue;
    }

    let content = extractText(message.content);
    if (role === 'user') {
      const unwrapped = unwrapGatewayContextWrappedUserContent(content);
      if (unwrapped) {
        content = unwrapped;
      }
    }
    if (role === 'assistant') {
      content = stripAssistantControlDirectives(content);
    }
    content = content.trim();
    if (!content) continue;

    const id = getHistoryMessageId(message);
    const timestamp =
      getHistoryMessageTimestamp(message) ?? stableSyntheticTimestamp(role, content);
    const dedupeKey = id ?? `${role}:${timestamp}:${content}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const normalized = content.toLowerCase();
    if (
      role === 'system' &&
      (normalized === 'compaction' ||
        normalized === 'conversation compacted' ||
        normalized === 'compacting conversation...')
    ) {
      const compactionState: CompactionState =
        normalized === 'compacting conversation...' || normalized === 'compaction'
          ? 'compacting'
          : 'compacted';
      const presentation = resolveCompactionPresentation(
        compactionState,
        CHAT_RELIABILITY_FLAGS.chat.compaction_semantic_states,
      );
      recovered.push({
        role,
        content: '',
        timestamp,
        ...(id ? { _id: id } : {}),
        systemMeta: {
          kind: 'compaction',
          title: presentation.title,
          details: {
            Note: 'Older messages were summarized to free context space',
            Status: presentation.status,
          },
          loading: presentation.loading,
        },
      });
      continue;
    }

    recovered.push({
      role,
      content,
      timestamp,
      ...(id ? { _id: id } : {}),
    });
  }

  recovered.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  return recovered;
}

function extractOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function extractOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractRecordKeys(value: unknown): string[] {
  const record = extractOptionalRecord(value);
  return record ? Object.keys(record) : [];
}

function summarizeUsagePayload(value: unknown): Record<string, unknown> | null {
  const record = extractOptionalRecord(value);
  if (!record) return null;
  const summary: Record<string, unknown> = {
    keys: Object.keys(record),
  };
  const payloadRecord = extractOptionalRecord(record.payload);
  if (payloadRecord) {
    summary.payloadKeys = Object.keys(payloadRecord);
  }
  const usageRecord = extractOptionalRecord(record.usage ?? record.contextUsage ?? record.stats);
  if (usageRecord) {
    summary.usageKeys = Object.keys(usageRecord);
  }
  return summary;
}

function extractOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function extractNumberFromRecord(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = extractOptionalNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function clampUsagePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function extractUsageFromRecord(record: Record<string, unknown>): UsageSnapshot | null {
  const used = extractNumberFromRecord(record, [
    'used',
    'usedTokens',
    'used_tokens',
    'totalTokens',
    'total_tokens',
    'tokensUsed',
    'tokenUsage',
    'contextTokens',
    'context_tokens',
    'contextUsed',
    'context_used_tokens',
  ]);
  const max = extractNumberFromRecord(record, [
    'max',
    'maxTokens',
    'max_tokens',
    'contextWindow',
    'context_window',
    'contextLength',
    'context_length',
    'contextLimit',
    'context_limit',
    'tokenLimit',
    'limitTokens',
  ]);
  const percent = extractNumberFromRecord(record, [
    'percent',
    'usagePercent',
    'contextPercent',
    'context_percent',
    'contextUsagePercent',
    'context_usage_percent',
  ]);

  if (used === null || max === null || max <= 0) return null;

  const resolvedPercent = clampUsagePercent(percent ?? (used / max) * 100);
  return { used, max, percent: resolvedPercent };
}

function extractUsageSnapshot(payload: unknown): UsageSnapshot | null {
  const record = extractOptionalRecord(payload);
  if (!record) return null;

  const direct = extractUsageFromRecord(record);
  if (direct) return direct;

  const nestedCandidates = [
    record.usage,
    record.contextUsage,
    record.context_window,
    record.contextWindow,
    record.context,
    record.stats,
    record.meta,
    record.data,
    record.payload,
    record.output,
  ];

  for (const candidate of nestedCandidates) {
    const nestedRecord = extractOptionalRecord(candidate);
    if (!nestedRecord) continue;
    const nested = extractUsageFromRecord(nestedRecord);
    if (nested) return nested;
  }

  return null;
}

function extractRuntimeModelProvider(
  payload: unknown,
): { model: string | null; provider: string | null } {
  const record = extractOptionalRecord(payload);
  if (!record) {
    return { model: null, provider: null };
  }

  const model =
    extractOptionalString(record.model) ??
    extractOptionalString(record.modelId) ??
    extractOptionalString(record.modelName) ??
    extractOptionalString(record.resolvedModel);
  const provider =
    extractOptionalString(record.provider) ??
    extractOptionalString(record.modelProvider) ??
    extractOptionalString(record.resolvedProvider);

  if (model || provider) {
    return { model: model ?? null, provider: provider ?? null };
  }

  const nestedCandidates = [record.payload, record.meta, record.data, record.output];
  for (const candidate of nestedCandidates) {
    const nested = extractRuntimeModelProvider(candidate);
    if (nested.model || nested.provider) {
      return nested;
    }
  }

  return { model: null, provider: null };
}

export interface SessionModelSnapshot {
  sessionKey: string;
  model: string | null;
  provider: string | null;
  source: 'exact' | 'defaults' | 'unknown';
  updatedAt: number | null;
}

function toSessionModelSnapshot(
  payload: unknown,
  sessionKey: string,
  allowDefaultsFallback: boolean,
): SessionModelSnapshot {
  const record = extractOptionalRecord(payload);
  const defaultsRecord = extractOptionalRecord(record?.defaults);
  const sessionsRaw = Array.isArray(record?.sessions) ? record?.sessions ?? [] : [];
  const sessions = sessionsRaw
    .map((entry) => extractOptionalRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  const exactMatch =
    sessions.find((entry) => extractOptionalString(entry.key) === sessionKey) ?? null;

  if (exactMatch) {
    const model =
      extractOptionalString(exactMatch.model) ??
      (allowDefaultsFallback ? extractOptionalString(defaultsRecord?.model) : null);
    const provider =
      extractOptionalString(exactMatch.modelProvider) ??
      (allowDefaultsFallback ? extractOptionalString(defaultsRecord?.modelProvider) : null);
    const updatedAt = typeof exactMatch.updatedAt === 'number' ? exactMatch.updatedAt : null;
    return {
      sessionKey,
      model,
      provider,
      source: 'exact',
      updatedAt,
    };
  }

  if (allowDefaultsFallback) {
    return {
      sessionKey,
      model: extractOptionalString(defaultsRecord?.model),
      provider: extractOptionalString(defaultsRecord?.modelProvider),
      source: 'defaults',
      updatedAt: null,
    };
  }

  return {
    sessionKey,
    model: null,
    provider: null,
    source: 'unknown',
    updatedAt: null,
  };
}

function matchSessionEntry(entry: Record<string, unknown>, sessionKey: string): boolean {
  const key = extractOptionalString(entry.key);
  if (key && key === sessionKey) return true;
  const sessionId = extractOptionalString(entry.sessionId);
  return Boolean(sessionId && sessionId === sessionKey);
}

function toSessionUsageSnapshot(payload: unknown, sessionKey: string): UsageSnapshot | null {
  const record = extractOptionalRecord(payload);
  const defaultsRecord = extractOptionalRecord(record?.defaults);
  const sessionsRaw = Array.isArray(record?.sessions) ? record?.sessions ?? [] : [];
  const sessions = sessionsRaw
    .map((entry) => extractOptionalRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  const exactMatch = sessions.find((entry) => matchSessionEntry(entry, sessionKey)) ?? null;
  if (!exactMatch) return null;

  const totalTokens = extractNumberFromRecord(exactMatch, [
    'totalTokens',
    'total_tokens',
    'total',
    'tokens',
  ]);
  const inputTokens = extractNumberFromRecord(exactMatch, [
    'inputTokens',
    'input_tokens',
    'promptTokens',
    'prompt_tokens',
  ]);
  const outputTokens = extractNumberFromRecord(exactMatch, [
    'outputTokens',
    'output_tokens',
    'completionTokens',
    'completion_tokens',
  ]);
  const usedTokens =
    totalTokens ??
    (inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null);

  const maxTokens =
    extractNumberFromRecord(exactMatch, [
      'contextTokens',
      'context_tokens',
      'contextWindow',
      'context_window',
      'maxTokens',
      'max_tokens',
    ]) ??
    extractNumberFromRecord(defaultsRecord ?? {}, [
      'contextTokens',
      'context_tokens',
      'contextWindow',
      'context_window',
      'maxTokens',
      'max_tokens',
    ]);

  if (usedTokens === null || maxTokens === null || maxTokens <= 0) return null;

  return {
    used: usedTokens,
    max: maxTokens,
    percent: clampUsagePercent((usedTokens / maxTokens) * 100),
  };
}

type OpenClawRequestFn = (method: string, params: Record<string, unknown>) => Promise<unknown>;

async function fetchSessionUsageFromSessionsList(
  request: OpenClawRequestFn,
  sessionKey: string,
): Promise<UsageSnapshot | null> {
  try {
    const payload = await request('sessions.list', {
      search: sessionKey,
      limit: 8,
      includeGlobal: true,
      includeUnknown: true,
    });
    return toSessionUsageSnapshot(payload, sessionKey);
  } catch (error) {
    console.warn('[Gateway] Failed to fetch session usage:', error);
    return null;
  }
}

async function fetchSessionModelViaTauriCli(
  sessionKey: string,
  allowDefaultsFallback: boolean,
): Promise<SessionModelSnapshot | null> {
  if (!isTauriRuntime()) return null;
  try {
    const payload = await getOpenClawSessionsList({
      search: sessionKey,
      limit: 8,
      includeGlobal: true,
      includeUnknown: true,
    });
    return toSessionModelSnapshot(payload, sessionKey, allowDefaultsFallback);
  } catch (error) {
    console.warn('[Gateway] Failed to fetch session model via Tauri CLI fallback:', error);
    return null;
  }
}

export async function fetchSessionModel(options?: {
  transport?: GatewayTransport;
  sessionKey?: string;
  allowDefaultsFallback?: boolean;
}): Promise<SessionModelSnapshot | null> {
  const transport = await resolveTransport(options?.transport);
  const transportSessionKey =
    'sessionKey' in transport ? transport.sessionKey?.trim() : undefined;
  const sessionKey = options?.sessionKey?.trim() || transportSessionKey || DEFAULT_SESSION_KEY;
  const allowDefaultsFallback = options?.allowDefaultsFallback ?? true;
  if (!sessionKey) return null;

  if (transport.mode === 'tauri-ws') {
    const { getTauriOpenClawConnection, getConnectionInstance } = await import('./tauri-websocket');
    try {
      // Reuse the existing singleton if available — calling getTauriOpenClawConnection
      // with a different sessionKey (e.g. scoped hub chat) would disconnect the shared
      // connection, destroying all active send handlers for every chat.
      const connection = getConnectionInstance() ?? await getTauriOpenClawConnection(
        transport.wsUrl,
        sessionKey,
        transport.token,
      );

      const payload = (await connection.request('sessions.list', {
        search: sessionKey,
        limit: 8,
        includeGlobal: true,
        includeUnknown: true,
      })) as unknown;
      return toSessionModelSnapshot(payload, sessionKey, allowDefaultsFallback);
    } catch (error) {
      console.warn('[Gateway] Failed to fetch session model:', error);
      return null;
    }
  }

  if (transport.mode === 'tauri-openclaw') {
    return fetchSessionModelViaTauriCli(sessionKey, allowDefaultsFallback);
  }

  if (transport.mode === 'openclaw-ws') {
    const connection = await openOpenClawConnection(transport);
    try {
      const payload = await connection.request('sessions.list', {
        search: sessionKey,
        limit: 8,
        includeGlobal: true,
        includeUnknown: true,
      });
      return toSessionModelSnapshot(payload, sessionKey, allowDefaultsFallback);
    } catch (error) {
      console.warn('[Gateway] Failed to fetch session model:', error);
      return null;
    } finally {
      connection.close();
    }
  }

  return null;
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

function composeContextWrappedUserMessage(contextMessage: string, userText: string): string {
  // Explicit marker makes history unwrapping deterministic even if transport
  // flattens newlines to spaces.
  return `${contextMessage}\n\nUser request:\n${userText}`;
}

async function getDefaultOpenClawTransport(): Promise<GatewayTransport | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;

  if (!cachedOpenClawTransportPromise) {
    cachedOpenClawTransportPromise = (async () => {
      try {
        const config = await getOpenClawGatewayConfig();
        const resolvedSessionKey = readSessionKeyOverride() ?? config.sessionKey;
        const wsTransport: GatewayTransport = {
          mode: 'tauri-ws',
          wsUrl: config.wsUrl,
          token: config.token,
          sessionKey: resolvedSessionKey,
        };

        console.log('[Gateway] Using tauri-ws transport');
        return wsTransport;
      } catch {
        return null;
      }
    })();
  }

  return cachedOpenClawTransportPromise;
}

async function resolveTransport(explicit?: GatewayTransport): Promise<GatewayTransport> {
  if (explicit) {
    if (explicit.mode === 'tauri-ws') {
      const explicitSessionKey = explicit.sessionKey?.trim();
      return {
        ...explicit,
        sessionKey: explicitSessionKey || getResolvedDefaultSessionKey(),
      };
    }

    if (explicit.mode === 'tauri-openclaw') {
      const explicitSessionKey = explicit.sessionKey?.trim();
      return {
        ...explicit,
        sessionKey: explicitSessionKey || getResolvedDefaultSessionKey(),
      };
    }

    return explicit;
  }

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
    const eventRecord = (typeof payload === 'object' && payload !== null
      ? payload
      : {}) as Record<string, unknown>;

    if (eventName === 'agent') {
      const sessionKey =
        typeof eventRecord.sessionKey === 'string' ? eventRecord.sessionKey : undefined;
      const runId = typeof eventRecord.runId === 'string' ? eventRecord.runId : undefined;
      const announce = parseAnnounceMetadata(eventRecord, true);

      // Only emit announce events for agent events that actually carry
      // announce metadata (sub-agent results, task completions, etc.).
      // Plain agent heartbeat/status events should NOT be emitted —
      // they carry sessionKeys from other sessions (e.g. agent:main)
      // that would be misidentified as active background sessions,
      // causing the activity indicator to stay on permanently.
      if (!announce) return;

      const messageText = extractChatEventMessageText(eventRecord);

      if (shouldSuppressForActiveSend(runId)) {
        return;
      }

      emit({
        kind: 'announce',
        sessionKey: announce.sessionKey ?? sessionKey,
        runId: announce.runId ?? runId,
        label:
          announce.label ??
          (typeof eventRecord.label === 'string' ? eventRecord.label : undefined),
        status: announce.status,
        runtime:
          announce.runtime ??
          (typeof eventRecord.runtime === 'string' ? eventRecord.runtime : undefined),
        tokens:
          announce.tokens ??
          (typeof eventRecord.tokens === 'string' ? eventRecord.tokens : undefined),
        message: messageText || undefined,
        raw: eventRecord,
      });
      return;
    }

    if (eventName !== 'chat') return;

    const state = typeof eventRecord.state === 'string' ? eventRecord.state : '';
    const sessionKey =
      typeof eventRecord.sessionKey === 'string' ? eventRecord.sessionKey : undefined;
    const runId = typeof eventRecord.runId === 'string' ? eventRecord.runId : undefined;
    const announce = parseAnnounceMetadata(eventRecord, true);

    if (
      shouldSuppressForActiveSend(runId) &&
      (Boolean(announce) || state === 'error' || state === 'final')
    ) {
      return;
    }

    if (state === 'compacted' || state === 'compacting' || state === 'compaction_complete') {
      const compactionState = state as CompactionState;
      const presentation = resolveCompactionPresentation(
        compactionState,
        CHAT_RELIABILITY_FLAGS.chat.compaction_semantic_states,
      );
      console.log('[Gateway][compaction-transition]', {
        runId,
        sessionKey,
        state: compactionState,
      });
      emit({
        kind: 'compaction',
        sessionKey,
        runId,
        compactionState,
        message: presentation.title,
      });
    }

    if (state === 'error' || state === 'error-stop') {
      const fallbackMessage = extractChatEventMessageText(eventRecord);
      emit({
        kind: 'error',
        sessionKey,
        runId,
        message:
          typeof eventRecord.errorMessage === 'string'
            ? eventRecord.errorMessage
            : fallbackMessage || 'Unknown error',
        label: typeof eventRecord.label === 'string' ? eventRecord.label : undefined,
      });
    }

    if (state === 'final') {
      const usage =
        extractUsageSnapshot(eventRecord) ??
        (eventRecord.payload !== undefined ? extractUsageSnapshot(eventRecord.payload) : null);
      if (usage) {
        emit({
          kind: 'usage',
          sessionKey,
          runId,
          usage,
          raw: eventRecord,
        });
      }
    }

    if (announce) {
      const messageText = extractChatEventMessageText(eventRecord);
      emit({
        kind: 'announce',
        sessionKey: announce.sessionKey ?? sessionKey,
        runId: announce.runId ?? runId,
        label: announce.label,
        status: announce.status,
        runtime: announce.runtime,
        tokens: announce.tokens,
        message: messageText || undefined,
        raw: eventRecord,
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

  return stripAssistantControlDirectives(data.choices[0].message.content);
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
              version: 'clawchestra',
              platform: 'tauri',
              mode: 'webchat',
            },
            role: 'operator',
            scopes: OPENCLAW_SCOPES,
            auth: transport.token ? { token: transport.token } : undefined,
            userAgent: 'clawchestra',
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
        const deltaText = stripAssistantControlDirectives(extractChatEventMessageText(chat));
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
        const finalText = stripAssistantControlDirectives(extractChatEventMessageText(chat));
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
    const text = stripAssistantControlDirectives(extractText(message.content));
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

  const response = await sendOpenClawMessage({
    message: messageText,
    attachments: mappedAttachments,
    sessionKey: transport.sessionKey,
  });
  return stripAssistantControlDirectives(response);
}

function setAgentActivity(
  next: 'idle' | 'typing' | 'working' | 'compacting',
  onActivityChange?: (state: 'idle' | 'typing' | 'working' | 'compacting') => void,
): void {
  useDashboardStore.getState().setAgentActivity(next);
  if (onActivityChange) onActivityChange(next);
}

async function sendViaTauriWs(
  messageText: string,
  attachments: GatewayImageAttachment[],
  transport: GatewayTransport,
  idempotencyKey?: string,
  onStreamDelta?: (content: string) => void,
  onActivityChange?: (state: 'idle' | 'typing' | 'working' | 'compacting') => void,
  recoveryAttempted: boolean = false,
  skipTurnTracking: boolean | undefined = false,
): Promise<SendResult> {
  if (transport.mode !== 'tauri-ws') {
    throw new Error('Tauri WebSocket transport is not configured');
  }

  const { getTauriOpenClawConnection, getConnectionInstance } = await import('./tauri-websocket');
  // For scoped hub chats, reuse the existing connection directly to avoid
  // config-key mismatches that would recycle the shared singleton.
  const existingConnection = skipTurnTracking ? getConnectionInstance() : null;
  const connection = existingConnection ?? await getTauriOpenClawConnection(
    transport.wsUrl,
    transport.sessionKey || DEFAULT_SESSION_KEY,
    transport.token,
  );

  const sessionKey = transport.sessionKey?.trim() || DEFAULT_SESSION_KEY;
  const turnToken = idempotencyKey?.trim() || getRequestId();
  const sendId = turnToken;
  const sendTag = `[Gateway][send:${sendId}]`;
  const logSend = (...args: unknown[]) => console.log(sendTag, ...args);
  const warnSend = (...args: unknown[]) => console.warn(sendTag, ...args);
  let runId = turnToken;
  let runtimeModel: string | null = null;
  let runtimeProvider: string | null = null;
  let runtimeSource: 'run' | 'session' | null = null;
  let runtimeUsage: UsageSnapshot | null = null;
  const sendRequestedAt = Date.now();
  const lifecycle = new TurnLifecycleEngine('queued', sendRequestedAt);
  const transitionLifecycle = (
    event:
      | 'send_started'
      | 'send_acknowledged'
      | 'stream_delta'
      | 'awaiting_output'
      | 'settling_start'
      | 'complete'
      | 'fail'
      | 'timeout',
    at?: number,
  ) => {
    const transition = lifecycle.transition(event, at);
    if (transition.changed) {
      logSend(`[lifecycle] ${transition.from} -> ${transition.to} via ${event}`);
    }
  };
  let streamedText = '';
  let sawFinalEvent = false;
  let sawFinalEventAt = 0;
  let resolvedWithoutFinal = false;
  let requiresFinalSettlePass = false;
  let sawRunOwnedProgress = false;
  let sawUnscopedAgentProgress = false;
  let sawRunOwnedContent = false;
  let sawAbortedEvent = false;
  let abortedEventAt = 0;
  let lastObservedRunActivityAt = sendRequestedAt;
  let terminalProcessFailureMessage: string | null = null;
  const baselineMessageIds = new Set<string>();

  // When skipTurnTracking is true (scoped hub chats), bypass the global turn registry
  // and agent activity to prevent cross-contamination with the main chat state.
  const _upsertTurn: typeof upsertTurn = skipTurnTracking
    ? ((_token: string, updates: Parameters<typeof upsertTurn>[1]) => ({ turnToken: _token, ...updates } as PendingTurn))
    : upsertTurn;
  const _markActiveSendRun = skipTurnTracking ? (_id: string) => {} : markActiveSendRun;
  const _clearActiveSendRun = skipTurnTracking ? (_id?: string) => {} : clearActiveSendRun;
  const _setAgentActivity: typeof setAgentActivity = skipTurnTracking
    ? ((_next, onAct) => { if (onAct) onAct(_next); })
    : setAgentActivity;

  _upsertTurn(turnToken, {
    sessionKey,
    runId,
    status: 'queued',
    submittedAt: sendRequestedAt,
    lastSignalAt: sendRequestedAt,
    hasAssistantOutput: false,
    completionReason: 'queued',
  });

  const captureRuntimeTruth = (payload: unknown, source: 'run' | 'session') => {
    const truth = extractRuntimeModelProvider(payload);
    if (!truth.model && !truth.provider) return;
    runtimeModel = truth.model;
    runtimeProvider = truth.provider;
    runtimeSource = source;
  };

  const captureRuntimeUsage = (payload: unknown) => {
    const usage = extractUsageSnapshot(payload);
    if (!usage) return;
    runtimeUsage = usage;
  };

  // Skip baseline history for scoped hub chats — they don't use recovery and
  // the extra request on the shared connection can race with the main chat.
  if (!skipTurnTracking) {
    try {
      const historyBefore = (await connection.request('chat.history', {
        sessionKey,
        limit: 200,
      })) as { messages?: unknown[] };

      const baselineMessages = Array.isArray(historyBefore.messages)
        ? historyBefore.messages.filter(isHistoryMessage)
        : [];

      for (const message of baselineMessages) {
        const id = getHistoryMessageId(message);
        if (id) baselineMessageIds.add(id);
      }
    } catch (error) {
      warnSend('Failed to load baseline history before send:', error);
    }
  }

  try {
    _markActiveSendRun(runId);
    transitionLifecycle('send_started');
    _upsertTurn(turnToken, {
      sessionKey,
      runId,
      status: 'running',
      completionReason: 'chat_send_started',
    });
    _setAgentActivity('working', onActivityChange);
    logSend('SEND START', { sessionKey, runId, connected: connection.connected });

    // Try to send the message. If the WS drops before the ack returns,
    // the request will reject — but the gateway may have already received
    // the message (sent on wire before disconnect). We MUST continue to
    // the polling phase regardless, because the response may still arrive.
    let sendAcked = false;
    try {
      const sendParams: Record<string, unknown> = {
        sessionKey,
        message: messageText,
        deliver: false,
        idempotencyKey: turnToken,
        attachments: attachments.length > 0 ? toOpenClawAttachments(attachments) : undefined,
      };
      const estimatedFrameBytes = estimateChatSendFrameBytes(sendParams);
      if (estimatedFrameBytes > OPENCLAW_WS_CLIENT_PAYLOAD_BUDGET_BYTES) {
        const attachmentHint =
          attachments.length > 0
            ? ` Remove some images or send them in smaller batches (${attachments.length} attached).`
            : '';
        throw new Error(
          `Message payload too large for gateway (${formatKiB(estimatedFrameBytes)} > ${formatKiB(
            OPENCLAW_WS_CLIENT_PAYLOAD_BUDGET_BYTES,
          )}).${attachmentHint}`,
        );
      }

      const sendResponse = (await connection.request('chat.send', sendParams)) as
        | Record<string, unknown>
        | undefined;
      sendAcked = true;
      captureRuntimeTruth(sendResponse, 'run');
      captureRuntimeUsage(sendResponse);
      const ackRunId = typeof sendResponse?.runId === 'string' ? sendResponse.runId : undefined;
      if (ackRunId && ackRunId !== runId) {
        runId = ackRunId;
        _markActiveSendRun(runId);
      }
      _upsertTurn(turnToken, {
        sessionKey,
        runId,
        status: 'running',
        completionReason: 'chat_send_acknowledged',
      });
      transitionLifecycle('send_acknowledged');
      logSend('chat.send acknowledged');
    } catch (sendErr) {
      if (isFatalSendAckError(sendErr)) {
        throw mapSendAckError(sendErr);
      }
      warnSend('[reason=failed_unacked_send] chat.send failed — will poll for response:', sendErr);
      _upsertTurn(turnToken, {
        sessionKey,
        runId,
        status: 'running',
        completionReason: 'chat_send_unacked_polling',
      });
      // Don't throw — fall through to polling. The message may have been
      // delivered before the connection dropped.
    }

    const minNewMessageTimestamp = sendAcked ? sendRequestedAt : sendRequestedAt - 5000;

    await new Promise<void>((resolve, reject) => {
      let completed = false;
      let sawFinal = false;
      let sawFinalAt = 0;
      let idleTimeout: ReturnType<typeof setTimeout> | null = null;
      let unsubscribeState: (() => void) | null = null;

      const ownsTerminalEvent = (eventRunId?: string): boolean => {
        return Boolean(eventRunId && eventRunId === runId);
      };

      const resetIdleTimeout = () => {
        touchTurnSignal(turnToken);
        if (idleTimeout) clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
          transitionLifecycle('awaiting_output');
          _upsertTurn(turnToken, {
            sessionKey,
            runId,
            status: 'awaiting_output',
            completionReason: 'idle_signal_gap_recovery',
          });
        }, 5 * 60 * 1000);
      };

      const clearSawFinal = (reason: string) => {
        if (!sawFinal) return;
        sawFinal = false;
        sawFinalEvent = false;
        sawFinalEventAt = 0;
        sawFinalAt = 0;
        logSend(`Final signal cleared due to ${reason}`);
      };

      const cleanup = (reason: string) => {
        if (completed) return;
        completed = true;
        logSend(
          `[reason=${reason}] CLEANUP streamedLen=${streamedText.length}, handlers=${connection.handlerCount?.() ?? '?'}`,
        );
        clearTimeout(safetyTimeout);
        clearInterval(pollInterval);
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
        warnSend('[reason=resolved_via_force_window] RESOLVE via safetyTimeout (30min)');
        cleanup('safetyTimeout');
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
          warnSend('WS connection lost during active send, state:', wsState);
          // Keep activity visible so user knows we're aware
          _setAgentActivity('working', onActivityChange);
        } else if (wsState === 'connected' && resubscribeCount < 3) {
          // Connection restored — re-subscribe to pick up remaining events
          logSend('WS reconnected during send, re-subscribing', {
            attempt: resubscribeCount + 1,
          });
          resubscribeCount++;
          unsubscribe();
          unsubscribe = connection.subscribe(eventHandler);
          // Reset event timer so poll doesn't fire immediately
          lastEventTime = Date.now();
        }
      });

      // Record when the send started so the poll can ignore older messages.
      // If the send wasn't acked, minNewMessageTimestamp already widens the
      // matching window.
      let lastPollSignature = '';
      let pollStableCount = 0; // How many consecutive polls returned the same length
      let noFinalBlockedLogged = false;
      let processPollCapability: ProcessPollCapability = 'unknown';
      let processPollFailCount = 0;
      const PROCESS_POLL_MAX_FAILURES = 3;
      let lastDeltaTime = 0; // Timestamp of most recent delta/state content event
      let lastContentSignalAt = 0; // Most recent timestamp where we extracted visible content

      // Aggressive poll fallback — events may not be delivered reliably
      // (WS drops, event subscription issues), so poll frequently.
      // Poll every 2s when send failed, 3s otherwise. Resolve after
      // 2 consecutive stable polls.
      const pollIntervalMs = sendAcked ? 3000 : 2000;
      const pollInterval = setInterval(async () => {
        if (completed) return;

        // If we recently extracted actual content from delta/final events, let
        // event-streaming drive updates and keep polling as backup only.
        // Do NOT gate on generic agent chatter, or polling can starve while
        // content remains invisible in the drawer.
        if (sendAcked && !sawFinal) {
          const timeSinceContentSignal = Date.now() - lastContentSignalAt;
          const hasRecentContentSignal =
            lastContentSignalAt > 0 && timeSinceContentSignal < 5000;
          if (hasRecentContentSignal) {
            return;
          }
        }

        try {
          const pollHistory = (await connection.request('chat.history', {
            sessionKey,
            limit: 30,
          })) as { messages?: unknown[] };

          const historyMessages = Array.isArray(pollHistory.messages)
            ? pollHistory.messages.filter(isHistoryMessage)
            : [];
          const chronologicalHistory = toChronologicalHistory(historyMessages);
          const hasAcceptedUserTurn = hasMatchingUserTurnInHistory(chronologicalHistory, {
            baselineIds: baselineMessageIds,
            minTimestamp: minNewMessageTimestamp,
            expectedUserText: messageText,
          });

          if (
            !sendAcked &&
            !hasAcceptedUserTurn &&
            !sawRunOwnedProgress &&
            !sawRunOwnedContent &&
            Date.now() - sendRequestedAt >= UNACKED_SEND_CONFIRM_TIMEOUT_MS
          ) {
            transitionLifecycle('fail');
            cleanup('unackedSendNoUserTurn');
            reject(
              new Error(
                'Message was not accepted (connection closed before acknowledgment). Please send again.',
              ),
            );
            return;
          }

          const assistantMessages = extractAssistantMessagesForTurn(historyMessages, {
            baselineIds: baselineMessageIds,
            minTimestamp: minNewMessageTimestamp,
            expectedUserText: messageText,
            expectedRunId: runId,
          });

          if (assistantMessages.length > 0) {
            const combined = assistantMessages.map((message) => message.content).join('\n\n').trim();
            const signature = assistantMessages
              .map((message) => message._id ?? `${message.timestamp ?? 'na'}:${message.content.length}`)
              .join('|');

            if (combined.length > 0 && combined.length >= streamedText.length) {
              const grew = combined.length > streamedText.length;
              streamedText = combined;
              lastContentSignalAt = Date.now();
              sawRunOwnedContent = true;
              _upsertTurn(turnToken, {
                sessionKey,
                runId,
                status: 'running',
                hasAssistantOutput: true,
                completionReason: 'history_poll_content',
              });
              if (grew) {
                transitionLifecycle('stream_delta');
              }
              if (onStreamDelta) onStreamDelta(streamedText);
            }

            pollStableCount = signature === lastPollSignature ? pollStableCount + 1 : 0;
            lastPollSignature = signature;

            // Content stability check. Two thresholds:
            // 1. With final event and no further activity: resolve quickly
            // 2. Without final event: require a quiet window plus stable polls.
            //    This avoids premature completion during active tool-use while
            //    still letting long turns settle if a terminal event is missed.
            const sendAgeMs = Date.now() - sendRequestedAt;
            const quietForMs = Date.now() - lastEventTime;
            const wsState = connection.state;
            const connectionUnstable =
              wsState === 'reconnecting' || wsState === 'disconnected' || wsState === 'error';
            const allowEarlyNoFinalByAge =
              !sawRunOwnedProgress &&
              sendAgeMs >= NO_FINAL_RESOLVE_MIN_SEND_AGE_MS;
            const allowMaxWaitNoFinal =
              sendAgeMs >= NO_FINAL_MAX_WAIT_MS &&
              Date.now() - lastObservedRunActivityAt >= NO_FINAL_RECENT_ACTIVITY_GRACE_MS;
            const canResolveWithoutFinal =
              !sawFinal &&
              combined.length > 0 &&
              (
                quietForMs >= NO_FINAL_RESOLVE_MIN_QUIET_MS ||
                allowMaxWaitNoFinal
              ) &&
              (
                connectionUnstable ||
                !sendAcked ||
                allowEarlyNoFinalByAge ||
                allowMaxWaitNoFinal
              );
            const noFinalLooksIncomplete = likelyNeedsFinalSettlePass(assistantMessages);
            const allowNoFinalResolve =
              canResolveWithoutFinal &&
              (!noFinalLooksIncomplete || sendAgeMs >= NO_FINAL_FORCE_RESOLVE_MS);
            if (
              canResolveWithoutFinal &&
              noFinalLooksIncomplete &&
              sendAgeMs < NO_FINAL_FORCE_RESOLVE_MS &&
              !noFinalBlockedLogged
            ) {
              noFinalBlockedLogged = true;
              logSend(
                `[reason=no_final_wait] No-final resolution blocked: content still looks incomplete (sendAge=${sendAgeMs}ms)`,
              );
            }

            const stabilityThreshold = sawFinal
              ? FINAL_STABILITY_POLLS
              : allowNoFinalResolve
                ? NO_FINAL_STABILITY_POLLS
                : Number.POSITIVE_INFINITY;
            if (sawFinal && combined.length > 0) {
              const needsFinalSettle = likelyNeedsFinalSettlePass(assistantMessages);
              if (!needsFinalSettle) {
                transitionLifecycle('settling_start');
                transitionLifecycle('complete');
                resolvedWithoutFinal = false;
                requiresFinalSettlePass = false;
                cleanup('finalFastPath');
                resolve();
                return;
              }
              requiresFinalSettlePass = true;
            }
            if (pollStableCount >= stabilityThreshold && combined.length > 0) {
              if (!sawFinal) {
                if (
                  processPollCapability === 'unavailable_scope' ||
                  processPollCapability === 'unavailable_degraded'
                ) {
                  if (sendAgeMs < NO_FINAL_FORCE_RESOLVE_MS) {
                    // No process polling capability yet (missing scope). Keep
                    // waiting until the force-resolve window to avoid truncation.
                    pollStableCount = 0;
                    return;
                  }
                } else {
                  try {
                    const processState = await connection.request<unknown>('process', {
                      action: 'poll',
                      sessionKey,
                    });
                    if (processPollCapability !== 'available') {
                      processPollCapability = 'available';
                      logSend('[reason=process_poll_available] process.poll capability available');
                    }
                    processPollFailCount = 0;
                    const processSnapshot = parseProcessPollSnapshot(processState);
                    if (
                      !processSnapshot.terminal &&
                      Date.now() - sendRequestedAt < ACTIVE_RUN_NO_FINAL_TIMEOUT_MS
                    ) {
                      // No terminal process state yet: keep waiting so we don't
                      // cut off long sub-agent runs that pause output between phases.
                      pollStableCount = 0;
                      return;
                    }
                    if (
                      processSnapshot.terminal &&
                      (processSnapshot.exitCode ?? 0) !== 0 &&
                      !terminalProcessFailureMessage
                    ) {
                      terminalProcessFailureMessage =
                        processSnapshot.error?.trim() ||
                        `Upstream process exited with code ${processSnapshot.exitCode ?? 1}.`;
                    }
                  } catch (error) {
                    processPollFailCount += 1;
                    const nextCapability = classifyProcessPollCapability(
                      error,
                      processPollFailCount,
                      PROCESS_POLL_MAX_FAILURES,
                    );
                    if (processPollCapability !== nextCapability) {
                      processPollCapability = nextCapability;
                      warnSend(
                        `[reason=process_poll_${nextCapability}] process.poll unavailable — using time-based no-final fallback`,
                        error,
                      );
                    } else {
                      warnSend(
                        `[reason=process_poll_${nextCapability}] process.poll check failed during no-final resolve — keeping alive:`,
                        error,
                      );
                    }

                    if (sendAgeMs < NO_FINAL_FORCE_RESOLVE_MS) {
                      pollStableCount = 0;
                      return;
                    }
                    warnSend(
                      '[reason=resolved_via_force_window] process.poll unavailable past force-resolve window — allowing no-final resolution',
                    );
                  }
                }
              }
              resolvedWithoutFinal = !sawFinal;
              if (sawFinal) {
                requiresFinalSettlePass = likelyNeedsFinalSettlePass(assistantMessages);
              }
              transitionLifecycle('settling_start');
              transitionLifecycle('complete');
              logSend(
                `[reason=resolved_via_poll_stability] Poll resolved: ${combined.length} chars, stable=${pollStableCount}/${stabilityThreshold}, sawFinal=${sawFinal}`,
              );
              cleanup('pollStability');
              resolve();
            }
          } else if (sawFinal && sawFinalAt > 0) {
            if (streamedText.trim().length > 0 && Date.now() - sawFinalAt >= 1500) {
              transitionLifecycle('settling_start');
              transitionLifecycle('complete');
              cleanup('finalWithStreamedContent');
              resolve();
              return;
            }
            const finalWithoutContentMs = Date.now() - sawFinalAt;
            const runActivityAgeMs = Date.now() - lastObservedRunActivityAt;
            if (runActivityAgeMs < FINAL_NO_CONTENT_ACTIVITY_GRACE_MS) {
              clearSawFinal('recent activity after final-without-content');
              return;
            }
            if (finalWithoutContentMs >= FINAL_NO_CONTENT_TIMEOUT_MS) {
              transitionLifecycle('fail');
              cleanup('finalWithoutContentTimeout');
              reject(new Error('No assistant response received from OpenClaw (run may have terminated).'));
            }
          }
        } catch (error) {
          warnSend('Poll failed:', error);
        }
      }, pollIntervalMs);

      const stateLabels: Record<CompactionState, string> = {
        compacting: resolveCompactionPresentation(
          'compacting',
          CHAT_RELIABILITY_FLAGS.chat.compaction_semantic_states,
        ).title,
        compacted: resolveCompactionPresentation(
          'compacted',
          CHAT_RELIABILITY_FLAGS.chat.compaction_semantic_states,
        ).title,
        compaction_complete: resolveCompactionPresentation(
          'compaction_complete',
          CHAT_RELIABILITY_FLAGS.chat.compaction_semantic_states,
        ).title,
      };

      // Track whether we've crossed a tool-call boundary since the last content block.
      // When the agent sends text → tool calls → more text, the second text block's
      // delta content restarts from zero length. Without this tracking, the length
      // check silently drops the new block (it's shorter than what we accumulated).
      let sawToolSinceLastContent = false;
      let contentBlockOffset = 0; // Byte offset where the current content block starts within streamedText

      const eventHandler = (eventName: string, payload: unknown) => {
        if (completed) return;

        // Agent events fire constantly during ALL processing — not just tool use.
        // Only treat them as tool-use indicators when content is NOT actively
        // streaming (no delta in last 3 seconds). This prevents every streaming
        // delta from being misidentified as a "new content block after tools."
        // Also: don't change the activity indicator during active streaming
        // (prevents Working/Typing flicker).
        if (eventName === 'agent') {
          const agentPayload = (typeof payload === 'object' && payload !== null
            ? payload
            : {}) as Record<string, unknown>;
          const agentSessionKey =
            typeof agentPayload.sessionKey === 'string' ? agentPayload.sessionKey : undefined;
          const agentRunId = typeof agentPayload.runId === 'string' ? agentPayload.runId : undefined;
          const hasScope = agentSessionKey !== undefined || agentRunId !== undefined;
          const belongsToRun =
            (agentSessionKey !== undefined && agentSessionKey === sessionKey) ||
            (agentRunId !== undefined && agentRunId === runId);
          if (!belongsToRun) {
            if (!hasScope) {
              const now = Date.now();
              const hasScopedProgress =
                sawRunOwnedProgress || sawRunOwnedContent || sawFinalEvent;
              const withinGraceWindow =
                now - sendRequestedAt <= UNSCOPED_AGENT_PROGRESS_GRACE_MS;

              // Unscoped agent noise should only influence liveness briefly
              // after send, or after we've already seen scoped run activity.
              if (!withinGraceWindow && !hasScopedProgress) {
                return;
              }

              sawUnscopedAgentProgress = true;
              lastEventTime = now;
              if (hasScopedProgress) {
                lastObservedRunActivityAt = now;
                _upsertTurn(turnToken, {
                  sessionKey,
                  runId,
                  status: 'running',
                  completionReason: 'unscoped_agent_progress',
                });
                resetIdleTimeout();
                pollStableCount = 0;
                clearSawFinal('unscoped agent activity');
              }
              const timeSinceLastDelta = Date.now() - lastDeltaTime;
              if (timeSinceLastDelta > 3000) {
                sawToolSinceLastContent = true;
                _setAgentActivity('working', onActivityChange);
              }
            }
            return;
          }

          // Scope timing/stability updates to this session only. Some gateway
          // broadcasts include agent events from other sessions; those should
          // not keep this send alive.
          const now = Date.now();
          lastEventTime = now;
          lastObservedRunActivityAt = now;
          _upsertTurn(turnToken, {
            sessionKey,
            runId,
            status: 'running',
            completionReason: 'agent_progress',
          });
          resetIdleTimeout();
          pollStableCount = 0;
          clearSawFinal('agent activity');

          if (
            agentRunId === runId ||
            (agentRunId === undefined && agentSessionKey === sessionKey)
          ) {
            sawRunOwnedProgress = true;
          }

          const timeSinceLastDelta = Date.now() - lastDeltaTime;
          if (timeSinceLastDelta > 3000) {
            sawToolSinceLastContent = true;
            _setAgentActivity('working', onActivityChange);
          }
          return;
        }

        if (eventName !== 'chat') return;

        const chat = (typeof payload === 'object' && payload !== null
          ? payload
          : {}) as Record<string, unknown>;

        if (typeof chat.sessionKey === 'string' && chat.sessionKey !== sessionKey) return;
        const state = typeof chat.state === 'string' ? chat.state : '';
        const eventRunId = typeof chat.runId === 'string' ? chat.runId : undefined;

        // RunId filter: if the event has a runId that doesn't match ours,
        // skip it. Events WITHOUT a runId are allowed through — many
        // legitimate gateway events omit runId.
        if (eventRunId && eventRunId !== runId) {
          return;
        }
        if (
          eventRunId === runId ||
          (
            !eventRunId &&
            typeof chat.sessionKey === 'string' &&
            chat.sessionKey === sessionKey
          )
        ) {
          captureRuntimeTruth(chat, 'run');
          captureRuntimeUsage(chat);
          if (chat.payload !== undefined) {
            captureRuntimeTruth(chat.payload, 'run');
            captureRuntimeUsage(chat.payload);
          }
        }
        if (
          state &&
          state !== 'final' &&
          (
            eventRunId === runId ||
            (
              !eventRunId &&
              typeof chat.sessionKey === 'string' &&
              chat.sessionKey === sessionKey
            )
          )
        ) {
          sawRunOwnedProgress = true;
        }
        const now = Date.now();
        lastEventTime = now;
        lastObservedRunActivityAt = now;
        resetIdleTimeout();
        if (state && state !== 'final') {
          clearSawFinal(`chat state=${state}`);
        }

        if (state && (state as CompactionState) in stateLabels) {
          _setAgentActivity(state === 'compacting' ? 'compacting' : 'working', onActivityChange);
        }

        if (TYPING_ACTIVITY_STATES.has(state)) {
          _setAgentActivity('typing', onActivityChange);
        } else if (TOOL_ACTIVITY_STATES.has(state)) {
          _setAgentActivity('working', onActivityChange);
          sawToolSinceLastContent = true;
        } else if (TERMINAL_ACTIVITY_STATES.has(state) && ownsTerminalEvent(eventRunId)) {
          touchTurnSignal(turnToken);
          _setAgentActivity('idle', onActivityChange);
        }

        const announce = parseAnnounceMetadata(chat, true);
        if (announce) {
          const messageText = extractChatEventMessageText(chat);
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
          lastDeltaTime = Date.now();
          const deltaText = stripAssistantControlDirectives(extractChatEventMessageText(chat));
          if (deltaText && !isStreamingSentinelFragment(deltaText)) {
            transitionLifecycle('stream_delta');
            sawRunOwnedContent = true;
            lastContentSignalAt = Date.now();
            _upsertTurn(turnToken, {
              sessionKey,
              runId,
              status: 'running',
              hasAssistantOutput: true,
              completionReason: 'stream_delta',
            });
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

        if (state === 'error' || state === 'error-stop') {
          if (!ownsTerminalEvent(eventRunId)) {
            console.log('[Gateway] Ignoring unscoped error event during active send');
            return;
          }
          transitionLifecycle('fail');
          console.log('[Gateway] REJECT via error event:', chat.errorMessage);
          finalizeTurn(turnToken, 'failed', {
            sessionKey,
            runId,
            completionReason: 'chat_error_event',
          });
          cleanup('errorEvent');
          _clearActiveSendRun(runId);
          reject(new Error(typeof chat.errorMessage === 'string' ? chat.errorMessage : 'OpenClaw chat error'));
          return;
        }

        if (state === 'aborted') {
          if (!ownsTerminalEvent(eventRunId)) {
            console.log('[Gateway] Ignoring unscoped aborted event during active send');
            return;
          }
          sawAbortedEvent = true;
          abortedEventAt = Date.now();
          transitionLifecycle('awaiting_output');
          console.log('[Gateway] Aborted event received — switching to history recovery');
          _upsertTurn(turnToken, {
            sessionKey,
            runId,
            status: 'awaiting_output',
            completionReason: 'chat_aborted_event',
          });
          _setAgentActivity('working', onActivityChange);
          cleanup('abortedEvent');
          _clearActiveSendRun(runId);
          resolve();
          return;
        }

        if (state === 'final') {
          if (!ownsTerminalEvent(eventRunId)) {
            console.log('[Gateway] Ignoring unscoped final event during active send');
            return;
          }
          const finalText = stripAssistantControlDirectives(extractChatEventMessageText(chat));
          const timeSinceSend = Date.now() - sendRequestedAt;
          console.log(`[Gateway] Final event: finalLen=${finalText?.length ?? 0}, streamedLen=${streamedText.length}, eventRunId=${eventRunId ?? 'none'}, timeSinceSend=${timeSinceSend}ms`);
          if (isGatewayDebugLogEnabled()) {
            const usageSnapshot =
              extractUsageSnapshot(chat) ??
              (chat.payload !== undefined ? extractUsageSnapshot(chat.payload) : null);
            const summary = summarizeUsagePayload(chat);
            console.log('[Gateway][debug] Final event usage snapshot:', {
              usageSnapshot,
              summary,
            });
            consumeGatewayDebugAuto();
          }

          // Guard against suspiciously early empty finals. The gateway may
          // emit these when the session is already busy with another agent
          // turn, or as a protocol-level acknowledgment artifact. Accepting
          // them causes premature resolution with no content.
          if (
            (!finalText || finalText.length === 0) &&
            streamedText.length === 0 &&
            timeSinceSend < 5000
          ) {
            console.warn(`[Gateway] Ignoring suspicious empty final (${timeSinceSend}ms after send, no content yet) — will rely on poll fallback`);
            return;
          }

          if (finalText && finalText.length >= streamedText.length) {
            streamedText = finalText;
            lastContentSignalAt = Date.now();
            if (onStreamDelta) {
              onStreamDelta(streamedText);
            }
          }
          sawFinal = true;
          sawFinalEvent = true;
          sawFinalEventAt = Date.now();
          sawFinalAt = Date.now();
          transitionLifecycle('awaiting_output');
          _upsertTurn(turnToken, {
            sessionKey,
            runId,
            status: 'awaiting_output',
            completionReason: finalText?.trim().length ? 'final_seen' : 'final_seen_without_content',
            hasAssistantOutput: streamedText.trim().length > 0,
          });
          _clearActiveSendRun(runId);
        }
      };

      let unsubscribe = connection.subscribe(eventHandler);
      console.log('[Gateway] Send handler subscribed, total handlers:', connection.handlerCount?.() ?? 'unknown');
    });

    await new Promise((r) => setTimeout(r, 50));

    const historyAfter = (await connection.request('chat.history', {
      sessionKey,
      limit: 200,
    })) as { messages?: unknown[] };

    const allMessages = Array.isArray(historyAfter.messages)
      ? historyAfter.messages.filter(isHistoryMessage)
      : [];

    if (!runtimeUsage) {
      runtimeUsage = extractUsageFromHistory(allMessages, runId);
      if (isGatewayDebugLogEnabled()) {
        const lastAssistant = [...allMessages]
          .reverse()
          .find((message) => message.role === 'assistant');
        console.log('[Gateway][debug] Usage from history:', {
          runtimeUsage,
          lastAssistantKeys: extractRecordKeys(lastAssistant),
          lastAssistantPayloadKeys: extractRecordKeys(
            extractOptionalRecord(lastAssistant)?.payload,
          ),
        });
        consumeGatewayDebugAuto();
      }
    }

    if (!runtimeUsage) {
      runtimeUsage = await fetchSessionUsageFromSessionsList(
        (method, params) => connection.request(method, params),
        sessionKey,
      );
    }

    let assistantMessages = extractAssistantMessagesForTurn(allMessages, {
      baselineIds: baselineMessageIds,
      minTimestamp: minNewMessageTimestamp,
      expectedUserText: messageText,
      expectedRunId: runId,
    });

    // History is the source of truth for final messages.
    // Streaming was only for the live preview — it can be truncated if
    // deltas stopped arriving (WS hiccup, timing issues).
    // Only fall back to streaming if history extraction found nothing.
    const historyTotalLength = assistantMessages.reduce((sum, m) => sum + m.content.length, 0);
    console.log(
      `[Gateway] Post-send: history found ${assistantMessages.length} messages (${historyTotalLength} chars), streamed ${streamedText.trim().length} chars`,
    );
    if (isGatewayVerboseDebugEnabled() && assistantMessages.length > 0) {
      for (let i = 0; i < assistantMessages.length; i += 1) {
        console.log(`[Gateway][debug] History msg[${i}] len=${assistantMessages[i].content.length}`);
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

    // Recovery path: if completion resolved but we still have no content,
    // keep polling history according to timeout class:
    // - no observed progress -> 3 minutes
    // - observed run activity -> 12 minutes
    // Skip recovery entirely for aborted runs — the user intentionally stopped,
    // there's no output to recover.
    if (assistantMessages.length === 0 && !streamedTrimmed && !sawAbortedEvent) {
      const sawAnyProgress =
        sawRunOwnedProgress || sawRunOwnedContent || sawFinalEvent || sawAbortedEvent;
      const hardDeadline = sendRequestedAt + (
        sawAnyProgress ? ACTIVE_RUN_NO_FINAL_TIMEOUT_MS : NO_EVENTS_AFTER_SEND_TIMEOUT_MS
      );
      _upsertTurn(turnToken, {
        sessionKey,
        runId,
        status: 'awaiting_output',
        completionReason: sawAnyProgress
          ? 'awaiting_output_active_backfill'
          : 'awaiting_output_no_event_backfill',
      });

      const recoveryDeadline = Math.max(Date.now(), hardDeadline);
      while (Date.now() < recoveryDeadline) {
        const waitMs = getBackfillPollIntervalMs(sendRequestedAt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        _setAgentActivity('working', onActivityChange);
        touchTurnSignal(turnToken);
        try {
          const processState = await connection.request<unknown>('process', {
            action: 'poll',
            sessionKey,
          });
          const processSnapshot = parseProcessPollSnapshot(processState);
          if (processSnapshot.terminal) {
            if (
              (processSnapshot.exitCode ?? 0) !== 0 &&
              !terminalProcessFailureMessage
            ) {
              terminalProcessFailureMessage =
                processSnapshot.error?.trim() ||
                `Upstream process exited with code ${processSnapshot.exitCode ?? 1}.`;
            }
            console.warn(
              `[Gateway] Recovery backfill observed terminal process state without new assistant output (exitCode=${processSnapshot.exitCode ?? 0})`,
            );
            break;
          }

          const recoveryHistory = (await connection.request('chat.history', {
            sessionKey,
            limit: 30,
          })) as { messages?: unknown[] };
          const recoveryMessages = Array.isArray(recoveryHistory.messages)
            ? recoveryHistory.messages.filter(isHistoryMessage)
            : [];
          const recovered = extractAssistantMessagesForTurn(recoveryMessages, {
            baselineIds: baselineMessageIds,
            minTimestamp: minNewMessageTimestamp,
            expectedUserText: messageText,
            expectedRunId: runId,
          });
          if (recovered.length > 0) {
            assistantMessages = recovered;
            _upsertTurn(turnToken, {
              sessionKey,
              runId,
              status: 'running',
              hasAssistantOutput: true,
              completionReason: 'recovered_from_history_backfill',
            });
            console.log(`[Gateway] Recovery poll captured ${recovered.length} assistant message(s)`);
            break;
          }
        } catch (error) {
          console.warn('[Gateway] Recovery poll failed:', error);
        }
      }
    }

    const shouldRunSettlePass =
      assistantMessages.length > 0 &&
      (
        (resolvedWithoutFinal && !sawFinalEvent) ||
        (
          requiresFinalSettlePass &&
          sawFinalEvent &&
          sawFinalEventAt > 0 &&
          Date.now() - sawFinalEventAt < FINAL_SETTLE_WINDOW_MS
        )
      );

    if (shouldRunSettlePass) {
      transitionLifecycle('settling_start');
      const settleDeadline = Date.now() + FINAL_SETTLE_WINDOW_MS;
      let lastSignature = assistantMessages
        .map((message) => message._id ?? `${message.timestamp ?? 'na'}:${message.content.length}`)
        .join('|');
      let stablePolls = 0;

      while (Date.now() < settleDeadline) {
        await new Promise((resolve) => setTimeout(resolve, FINAL_SETTLE_POLL_MS));

        try {
          const settleHistory = (await connection.request('chat.history', {
            sessionKey,
            limit: 30,
          })) as { messages?: unknown[] };
          const settleMessages = Array.isArray(settleHistory.messages)
            ? settleHistory.messages.filter(isHistoryMessage)
            : [];
          const extracted = extractAssistantMessagesForTurn(settleMessages, {
            baselineIds: baselineMessageIds,
            minTimestamp: minNewMessageTimestamp,
            expectedUserText: messageText,
            expectedRunId: runId,
          });
          if (extracted.length === 0) {
            stablePolls += 1;
            if (stablePolls >= 2) break;
            continue;
          }

          const signature = extracted
            .map((message) => message._id ?? `${message.timestamp ?? 'na'}:${message.content.length}`)
            .join('|');
          if (signature !== lastSignature) {
            assistantMessages = extracted;
            lastSignature = signature;
            stablePolls = 0;
            continue;
          }

          stablePolls += 1;
          if (stablePolls >= FINAL_SETTLE_STABLE_POLLS) {
            break;
          }
        } catch {
          // Keep best known assistant messages.
          stablePolls += 1;
          if (stablePolls >= FINAL_SETTLE_STABLE_POLLS) break;
        }
      }
    }

    const finalStreamedText = streamedText.trim();

    // Aborted runs: the user intentionally stopped — resolve cleanly with
    // whatever partial content we have (or empty). Not an error.
    if (sawAbortedEvent && assistantMessages.length === 0 && !finalStreamedText) {
      transitionLifecycle('complete');
      finalizeTurn(turnToken, 'completed', {
        sessionKey,
        runId,
        completionReason: 'user_aborted',
      });
      _setAgentActivity('idle', onActivityChange);
      _clearActiveSendRun(runId);
      return {
        messages: [],
        lastContent: '',
        aborted: true,
        runtimeModel,
        runtimeProvider,
        ...(runtimeSource ? { runtimeSource } : {}),
        usage: runtimeUsage ?? null,
      };
    }

    if (assistantMessages.length === 0 && !finalStreamedText) {
      const timedOutWithProgress =
        sawRunOwnedProgress || sawRunOwnedContent || sawFinalEvent;
      transitionLifecycle('timeout');
      finalizeTurn(turnToken, 'timed_out', {
        sessionKey,
        runId,
        completionReason: timedOutWithProgress
          ? 'timeout_active_no_final'
          : 'timeout_no_events',
      });
      if (terminalProcessFailureMessage) {
        throw new Error(`OpenClaw run failed: ${terminalProcessFailureMessage}`);
      }
      throw new Error('No response received — agent may be busy or the session is unavailable. Try again in a moment.');
    }

    transitionLifecycle('complete');
    finalizeTurn(turnToken, 'completed', {
      sessionKey,
      runId,
      hasAssistantOutput: true,
      completionReason: sawFinalEvent ? 'completed_from_final_or_history' : 'completed_from_history_without_final',
    });
    _setAgentActivity('idle', onActivityChange);
    _clearActiveSendRun(runId);

    if (!runtimeModel && !runtimeProvider) {
      try {
        const snapshot = await fetchSessionModel({
          transport,
          sessionKey,
          allowDefaultsFallback: false,
        });
        if (snapshot && (snapshot.model || snapshot.provider)) {
          runtimeModel = snapshot.model;
          runtimeProvider = snapshot.provider;
          runtimeSource = 'session';
        }
      } catch {
        // Keep runtime truth unknown when snapshot probe fails.
      }
    }

    return {
      messages: assistantMessages,
      lastContent: assistantMessages.length > 0
        ? assistantMessages[assistantMessages.length - 1].content
        : finalStreamedText,
      runtimeModel,
      runtimeProvider,
      ...(runtimeSource ? { runtimeSource } : {}),
      usage: runtimeUsage ?? null,
    };
  } catch (error) {
    if (!recoveryAttempted && shouldAutoRecoverFromSendError(error)) {
      const recoverySessionKey = rotateSessionKeyForRecovery(sessionKey);
      console.warn(
        `[Gateway] Auto-retrying send on fresh session after upstream overflow/413: ${sessionKey} -> ${recoverySessionKey}`,
      );
      return sendViaTauriWs(
        messageText,
        attachments,
        {
          ...transport,
          mode: 'tauri-ws',
          sessionKey: recoverySessionKey,
        },
        withRetryIdempotencyKey(idempotencyKey),
        onStreamDelta,
        onActivityChange,
        true,
      );
    }

    const existingTurn = turnRegistry.get(turnToken);
    if (!existingTurn || isTurnActive(existingTurn.status)) {
      const message = normalizeErrorMessage(error);
      const lower = message.toLowerCase();
      const reason =
        lower.includes('no response')
          ? 'timeout_no_output'
          : lower.includes('timeout')
            ? 'timeout_request'
            : 'send_failed';
      if (reason.startsWith('timeout')) {
        transitionLifecycle('timeout');
      } else {
        transitionLifecycle('fail');
      }
      finalizeTurn(turnToken, 'failed', {
        sessionKey,
        runId,
        completionReason: reason,
      });
    }
    _setAgentActivity('idle', onActivityChange);
    _clearActiveSendRun(runId);
    throw error;
  } finally {
    _clearActiveSendRun(runId);
  }
}

export async function sendMessage(messages: ChatMessage[], options?: GatewayOptions): Promise<SendResult> {
  const transport = await resolveTransport(options?.transport);
  const attachments = options?.attachments ?? [];
  const messageText = latestUserContent(messages);
  const onStreamDelta = options?.onStreamDelta;
  const onActivityChange = options?.onActivityChange;
  const idempotencyKey = options?.idempotencyKey;

  if (transport.mode === 'tauri-ws') {
    if (!messageText) throw new Error('No message content to send');
    return sendViaTauriWs(
      messageText,
      attachments,
      transport,
      idempotencyKey,
      onStreamDelta,
      onActivityChange,
    );
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

export type AiSurface = 'main-chat-drawer' | 'hub-scoped-chat' | 'roadmap-quick-add';

const SURFACE_RESPONSE_CONTRACTS: Record<AiSurface, string> = {
  'main-chat-drawer':
    'You are inside Clawchestra (main chat drawer). Respond conversationally with markdown formatting. You may suggest app features, guide workflows, and reference capabilities.',
  'hub-scoped-chat':
    'You are inside Clawchestra (project/item scoped chat). Respond with project-aware context at medium depth. Reference the project state and docs injected above.',
  'roadmap-quick-add':
    'You are inside Clawchestra (roadmap item quick-add). Brief confirmation only. Include item title, column, and priority. Keep response under 3 sentences.',
};

export async function sendMessageWithContext(
  messages: ChatMessage[],
  context: {
    view: string;
    selectedProject?: string;
    openclawWorkspacePath?: string | null;
    openclawContextPolicy?: 'selected-project-first' | 'workspace-default';
    surface?: AiSurface;
  },
  options?: GatewayOptions,
): Promise<SendResult> {
  // If a session key override is specified (scoped hub chats), inject it into the transport.
  let transportOverride = options?.transport;
  if (options?.sessionKey) {
    const base = transportOverride ?? await resolveTransport();
    if (base.mode === 'tauri-ws' || base.mode === 'tauri-openclaw' || base.mode === 'openclaw-ws') {
      transportOverride = { ...base, sessionKey: options.sessionKey };
    }
  }
  const transport = await resolveTransport(transportOverride);
  const attachments = options?.attachments ?? [];
  const onStreamDelta = options?.onStreamDelta;
  const onActivityChange = options?.onActivityChange;
  const idempotencyKey = options?.idempotencyKey;
  const policy = context.openclawContextPolicy ?? 'selected-project-first';
  const workspacePath = context.openclawWorkspacePath?.trim();
  const viewLine =
    policy === 'workspace-default'
      ? workspacePath
        ? `User workspace path: ${workspacePath}`
        : context.selectedProject
          ? `User is viewing project: ${context.selectedProject}`
          : `User is viewing: ${context.view}`
      : context.selectedProject
        ? `User is viewing project: ${context.selectedProject}`
        : workspacePath
          ? `User workspace path: ${workspacePath}`
          : `User is viewing: ${context.view}`;

  // Build context message with surface identifier + response contract
  const surface = context.surface;
  const responseContract = surface ? SURFACE_RESPONSE_CONTRACTS[surface] : null;
  const contextMessage = responseContract
    ? `[Clawchestra Context]\nSurface: ${surface}\n${viewLine}\n\n[Response Guidelines]\n${responseContract}`
    : viewLine;

  if (transport.mode === 'tauri-ws') {
    const userText = latestUserContent(messages);
    if (!userText) throw new Error('No message content to send');

    const composed = composeContextWrappedUserMessage(contextMessage, userText);
    return sendViaTauriWs(
      composed,
      attachments,
      transport,
      idempotencyKey,
      onStreamDelta,
      onActivityChange,
      false,
      options?.skipTurnTracking,
    );
  }

  if (transport.mode === 'tauri-openclaw') {
    const userText = latestUserContent(messages);
    if (!userText) throw new Error('No message content to send');

    const composed = composeContextWrappedUserMessage(contextMessage, userText);
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

    const composed = composeContextWrappedUserMessage(contextMessage, userText);
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
    if ((prev === 'disconnected' || prev === 'error') && getActiveTurnCount() === 0) {
      useDashboardStore.getState().setAgentActivity('idle');
    }
    listener(prev);
  });
}

export const __gatewayTestUtils = {
  extractAssistantMessagesForTurn,
  extractChatEventMessageText,
  extractRuntimeModelProvider,
  likelyNeedsFinalSettlePass,
  parseProcessPollSnapshot,
  classifyProcessPollCapability,
  normalizeHydratedTurnStatus,
  applyRecoveryCursorFilter,
  collectInternalNoReplyRunIds,
  shouldSuppressNoReplyRunAssistantMessage,
  resolveCompactionPresentation,
  hasMatchingUserTurnInHistory,
  estimateChatSendFrameBytes,
  OPENCLAW_WS_CLIENT_PAYLOAD_BUDGET_BYTES,
  isPendingTurnExpiredForHydration,
  getActiveTurnCount,
  clearTurnRegistryForTests: () => {
    turnRegistry.clear();
    turnLastPersistAt.clear();
    emitTurnRegistry();
  },
  upsertTurnForTests: (turn: PendingTurn) => {
    turnRegistry.set(turn.turnToken, turn);
    emitTurnRegistry();
  },
};

export async function pollProcessSessions(
  sessionKeys: string[],
  transportOverride?: GatewayTransport,
): Promise<{
  completed: Array<{ sessionKey: string; exitCode: number; error?: string }>;
  failures: Array<{ sessionKey: string; exitCode: number; error?: string }>;
}> {
  const completed: Array<{ sessionKey: string; exitCode: number; error?: string }> = [];
  const failures: Array<{ sessionKey: string; exitCode: number; error?: string }> = [];
  const transport = await resolveTransport(transportOverride);
  if (transport.mode !== 'tauri-ws') return { completed, failures };

  const { getTauriOpenClawConnection } = await import('./tauri-websocket');
  const connection = await getTauriOpenClawConnection(
    transport.wsUrl,
    transport.sessionKey || DEFAULT_SESSION_KEY,
    transport.token,
  );

  for (const sessionKey of sessionKeys) {
    try {
      const result = await connection.request<unknown>('process', {
        action: 'poll',
        sessionKey,
      });
      const snapshot = parseProcessPollSnapshot(result);

      if (snapshot.terminal) {
        const terminal = {
          sessionKey,
          exitCode: snapshot.exitCode ?? 0,
          ...(snapshot.error ? { error: snapshot.error } : {}),
        };
        completed.push(terminal);
        if (terminal.exitCode !== 0) {
          failures.push(terminal);
        }
      }
    } catch {
      // Ignore poll transport failures.
    }
  }

  return { completed, failures };
}
