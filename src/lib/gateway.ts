import {
  chatPendingTurnRemove,
  chatPendingTurnSave,
  chatPendingTurnsLoad,
  checkOpenClawGatewayConnection,
  getOpenClawGatewayConfig,
  isTauriRuntime,
  sendOpenClawMessage,
} from './tauri';
import type { ChatConnectionState } from '../components/chat/types';
import { useDashboardStore } from './store';
import {
  normalizeChatContentForMatch,
  unwrapGatewayContextWrappedUserContent,
} from './chat-normalization';

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
const GATEWAY_DEBUG_LOG = import.meta.env.DEV || import.meta.env.VITE_GATEWAY_DEBUG === '1';
const OPENCLAW_CLIENT_ID = 'openclaw-control-ui';
const OPENCLAW_SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing'];
const TURN_TERMINAL_RETENTION_MS = 60_000;

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

  turnRegistry.set(turnToken, {
    ...current,
    ...updates,
    status,
    completedAt: Date.now(),
    lastSignalAt: Date.now(),
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

function isPendingTurnExpiredForHydration(turn: {
  status: TurnStatus;
  lastSignalAt: number;
}, now: number): boolean {
  if (!isTurnActive(turn.status)) return false;
  return now - turn.lastSignalAt > ACTIVE_RUN_NO_FINAL_TIMEOUT_MS;
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
    for (const turn of persisted) {
      if (!isTurnActive(turn.status as TurnStatus)) continue;
      if (
        isPendingTurnExpiredForHydration(
          {
            status: turn.status as TurnStatus,
            lastSignalAt: turn.lastSignalAt,
          },
          now,
        )
      ) {
        removePersistedPendingTurn(turn.turnToken);
        continue;
      }
      turnRegistry.set(turn.turnToken, {
        turnToken: turn.turnToken,
        sessionKey: turn.sessionKey,
        runId: turn.runId,
        status: turn.status as TurnStatus,
        submittedAt: turn.submittedAt,
        lastSignalAt: turn.lastSignalAt,
        completedAt: turn.completedAt,
        hasAssistantOutput: turn.hasAssistantOutput,
        completionReason: turn.completionReason,
      });
    }
    emitTurnRegistry();
  } catch (error) {
    console.warn('[Gateway] Failed to hydrate pending turns:', error);
  }

  return snapshotTurnRegistry();
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

    const content = extractText(message.content).trim();
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

  return assistantMessages;
}

function normalizeTextForMatch(text: string): string {
  return normalizeChatContentForMatch(text);
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

    const content = extractText(message.content).trim();
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

  return assistantMessages;
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

  const { getTauriOpenClawConnection } = await import('./tauri-websocket');
  const sessionKey = options?.sessionKey?.trim() || transport.sessionKey?.trim() || DEFAULT_SESSION_KEY;
  const connection = await getTauriOpenClawConnection(
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

  const chronological = toChronologicalHistory(rawMessages);
  const seen = new Set<string>();
  const recovered: ChatMessage[] = [];

  for (const message of chronological) {
    const role = normalizeHistoryRole(message.role);
    if (!role) continue;

    if (role === 'user' && isSyntheticSystemExecUserMessage(message)) {
      continue;
    }

    let content = extractText(message.content).trim();
    if (role === 'user') {
      const unwrapped = unwrapGatewayContextWrappedUserContent(content);
      if (unwrapped) {
        content = unwrapped;
      }
    }
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
      recovered.push({
        role,
        content: '',
        timestamp,
        ...(id ? { _id: id } : {}),
        systemMeta: {
          kind: 'compaction',
          title: 'Conversation compacted',
          details: {
            Note: 'Older messages were summarized to free context space',
          },
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

  return recovered;
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
    const eventRecord = (typeof payload === 'object' && payload !== null
      ? payload
      : {}) as Record<string, unknown>;

    if (eventName === 'agent') {
      const sessionKey =
        typeof eventRecord.sessionKey === 'string' ? eventRecord.sessionKey : undefined;
      const runId = typeof eventRecord.runId === 'string' ? eventRecord.runId : undefined;
      const announce = parseAnnounceMetadata(eventRecord, true);
      const messageText =
        typeof eventRecord.message === 'string'
          ? eventRecord.message
          : extractText(eventRecord.message);
      const status =
        announce?.status ??
        (typeof eventRecord.status === 'string' ? normalizeAnnounceStatus(eventRecord.status, messageText) : undefined) ??
        'running';

      if (shouldSuppressForActiveSend(runId) && Boolean(announce)) {
        return;
      }

      emit({
        kind: 'announce',
        sessionKey: announce?.sessionKey ?? sessionKey,
        runId: announce?.runId ?? runId,
        label:
          announce?.label ??
          (typeof eventRecord.label === 'string' ? eventRecord.label : undefined),
        status,
        runtime:
          announce?.runtime ??
          (typeof eventRecord.runtime === 'string' ? eventRecord.runtime : undefined),
        tokens:
          announce?.tokens ??
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
      emit({ kind: 'compaction', sessionKey, runId, message: 'Conversation compacted' });
    }

    if (state === 'error') {
      emit({
        kind: 'error',
        sessionKey,
        runId,
        message:
          typeof eventRecord.errorMessage === 'string'
            ? eventRecord.errorMessage
            : 'Unknown error',
        label: typeof eventRecord.label === 'string' ? eventRecord.label : undefined,
      });
    }

    if (announce) {
      const messageText =
        typeof eventRecord.message === 'string'
          ? eventRecord.message
          : extractText(eventRecord.message);
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
  const turnToken = getRequestId();
  let runId = turnToken;
  const sendRequestedAt = Date.now();
  let streamedText = '';
  let sawFinalEvent = false;
  let sawFinalEventAt = 0;
  let resolvedWithoutFinal = false;
  let requiresFinalSettlePass = false;
  let sawRunOwnedProgress = false;
  let sawUnscopedAgentProgress = false;
  let sawRunOwnedContent = false;
  let lastObservedRunActivityAt = sendRequestedAt;
  const baselineMessageIds = new Set<string>();
  upsertTurn(turnToken, {
    sessionKey,
    runId,
    status: 'queued',
    submittedAt: sendRequestedAt,
    lastSignalAt: sendRequestedAt,
    hasAssistantOutput: false,
    completionReason: 'queued',
  });

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
    console.warn('[Gateway] Failed to load baseline history before send:', error);
  }

  try {
    markActiveSendRun(runId);
    upsertTurn(turnToken, {
      sessionKey,
      runId,
      status: 'running',
      completionReason: 'chat_send_started',
    });
    setAgentActivity('working', onActivityChange);
    console.log('[Gateway] === SEND START === sessionKey:', sessionKey, 'runId:', runId, 'connected:', connection.connected);

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
        idempotencyKey: runId,
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
      const ackRunId = typeof sendResponse?.runId === 'string' ? sendResponse.runId : undefined;
      if (ackRunId && ackRunId !== runId) {
        runId = ackRunId;
        markActiveSendRun(runId);
      }
      upsertTurn(turnToken, {
        sessionKey,
        runId,
        status: 'running',
        completionReason: 'chat_send_acknowledged',
      });
      console.log('[Gateway] chat.send acknowledged');
    } catch (sendErr) {
      console.warn('[Gateway] chat.send failed — will poll for response:', sendErr);
      upsertTurn(turnToken, {
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
          upsertTurn(turnToken, {
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
        console.log(`[Gateway] Final signal cleared due to ${reason}`);
      };

      const cleanup = (reason: string) => {
        if (completed) return;
        completed = true;
        console.log(`[Gateway] CLEANUP reason=${reason}, streamedLen=${streamedText.length}, handlers=${connection.handlerCount?.() ?? '?'}`);
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
        console.warn('[Gateway] RESOLVE via safetyTimeout (30min)');
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

      // Record when the send started so the poll can ignore older messages.
      // If the send wasn't acked, minNewMessageTimestamp already widens the
      // matching window.
      let lastPollSignature = '';
      let pollStableCount = 0; // How many consecutive polls returned the same length
      let noFinalBlockedLogged = false;

      // Aggressive poll fallback — events may not be delivered reliably
      // (WS drops, event subscription issues), so poll frequently.
      // Poll every 2s when send failed, 3s otherwise. Resolve after
      // 2 consecutive stable polls.
      const pollIntervalMs = sendAcked ? 3000 : 2000;
      const pollInterval = setInterval(async () => {
        if (completed) return;

        // If events are actively arriving (content deltas OR agent tool-use
        // events), let them drive — only poll as backup. The streamedText check
        // was previously required, but agent events during pure tool work (no
        // content yet) are equally valid indicators of an active send.
        if (sendAcked && !sawFinal) {
          const timeSinceLastEvent = Date.now() - lastEventTime;
          if (timeSinceLastEvent < 5000) {
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
              streamedText = combined;
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
              console.log(
                `[Gateway] No-final resolution blocked: content still looks incomplete (sendAge=${sendAgeMs}ms)`,
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
                try {
                  const processState = await connection.request<unknown>('process', {
                    action: 'poll',
                    sessionKey,
                  });
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
                } catch (error) {
                  // If process polling is unavailable, fall back to chat-history stability.
                  console.warn('[Gateway] process.poll check failed during no-final resolve:', error);
                }
              }
              resolvedWithoutFinal = !sawFinal;
              if (sawFinal) {
                requiresFinalSettlePass = likelyNeedsFinalSettlePass(assistantMessages);
              }
              console.log(
                `[Gateway] Poll resolved: ${combined.length} chars, stable=${pollStableCount}/${stabilityThreshold}, sawFinal=${sawFinal}`,
              );
              cleanup('pollStability');
              resolve();
            }
          } else if (sawFinal && sawFinalAt > 0) {
            if (streamedText.trim().length > 0 && Date.now() - sawFinalAt >= 1500) {
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
              cleanup('finalWithoutContentTimeout');
              reject(new Error('No assistant response received from OpenClaw (run may have terminated).'));
            }
          }
        } catch (error) {
          console.warn('[Gateway] Poll failed:', error);
        }
      }, pollIntervalMs);

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

      let lastDeltaTime = 0; // Timestamp of most recent content delta

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
                upsertTurn(turnToken, {
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
                setAgentActivity('working', onActivityChange);
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
          upsertTurn(turnToken, {
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
            setAgentActivity('working', onActivityChange);
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

        if (state && stateLabels[state]) {
          setAgentActivity('working', onActivityChange);
        }

        if (TYPING_ACTIVITY_STATES.has(state)) {
          setAgentActivity('typing', onActivityChange);
        } else if (TOOL_ACTIVITY_STATES.has(state)) {
          setAgentActivity('working', onActivityChange);
          sawToolSinceLastContent = true;
        } else if (TERMINAL_ACTIVITY_STATES.has(state) && ownsTerminalEvent(eventRunId)) {
          touchTurnSignal(turnToken);
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
          lastDeltaTime = Date.now();
          const deltaText = extractText(chat.message);
          if (deltaText) {
            sawRunOwnedContent = true;
            upsertTurn(turnToken, {
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

        if (state === 'error') {
          if (!ownsTerminalEvent(eventRunId)) {
            console.log('[Gateway] Ignoring unscoped error event during active send');
            return;
          }
          console.log('[Gateway] REJECT via error event:', chat.errorMessage);
          finalizeTurn(turnToken, 'failed', {
            sessionKey,
            runId,
            completionReason: 'chat_error_event',
          });
          cleanup('errorEvent');
          clearActiveSendRun(runId);
          reject(new Error(typeof chat.errorMessage === 'string' ? chat.errorMessage : 'OpenClaw chat error'));
          return;
        }

        if (state === 'aborted') {
          if (!ownsTerminalEvent(eventRunId)) {
            console.log('[Gateway] Ignoring unscoped aborted event during active send');
            return;
          }
          console.log('[Gateway] REJECT via aborted event');
          finalizeTurn(turnToken, 'failed', {
            sessionKey,
            runId,
            completionReason: 'chat_aborted_event',
          });
          cleanup('abortedEvent');
          clearActiveSendRun(runId);
          reject(new Error('OpenClaw chat aborted'));
          return;
        }

        if (state === 'final') {
          if (!ownsTerminalEvent(eventRunId)) {
            console.log('[Gateway] Ignoring unscoped final event during active send');
            return;
          }
          const finalText = extractText(chat.message);
          const timeSinceSend = Date.now() - sendRequestedAt;
          console.log(`[Gateway] Final event: finalLen=${finalText?.length ?? 0}, streamedLen=${streamedText.length}, eventRunId=${eventRunId ?? 'none'}, timeSinceSend=${timeSinceSend}ms`);

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
            if (onStreamDelta) {
              onStreamDelta(streamedText);
            }
          }
          sawFinal = true;
          sawFinalEvent = true;
          sawFinalEventAt = Date.now();
          sawFinalAt = Date.now();
          upsertTurn(turnToken, {
            sessionKey,
            runId,
            status: 'awaiting_output',
            completionReason: finalText?.trim().length ? 'final_seen' : 'final_seen_without_content',
            hasAssistantOutput: streamedText.trim().length > 0,
          });
          clearActiveSendRun(runId);
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
    if (GATEWAY_DEBUG_LOG && assistantMessages.length > 0) {
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
    if (assistantMessages.length === 0 && !streamedTrimmed) {
      const sawAnyProgress =
        sawRunOwnedProgress || sawRunOwnedContent || sawFinalEvent;
      const hardDeadline = sendRequestedAt + (
        sawAnyProgress ? ACTIVE_RUN_NO_FINAL_TIMEOUT_MS : NO_EVENTS_AFTER_SEND_TIMEOUT_MS
      );
      upsertTurn(turnToken, {
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
        setAgentActivity('working', onActivityChange);
        touchTurnSignal(turnToken);
        try {
          const processState = await connection.request<unknown>('process', {
            action: 'poll',
            sessionKey,
          });
          const processSnapshot = parseProcessPollSnapshot(processState);
          if (processSnapshot.terminal) {
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
            upsertTurn(turnToken, {
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
    if (assistantMessages.length === 0 && !finalStreamedText) {
      const timedOutWithProgress =
        sawRunOwnedProgress || sawRunOwnedContent || sawFinalEvent;
      finalizeTurn(turnToken, 'timed_out', {
        sessionKey,
        runId,
        completionReason: timedOutWithProgress
          ? 'timeout_active_no_final'
          : 'timeout_no_events',
      });
      throw new Error('No response received — agent may be busy or the session is unavailable. Try again in a moment.');
    }

    finalizeTurn(turnToken, 'completed', {
      sessionKey,
      runId,
      hasAssistantOutput: true,
      completionReason: sawFinalEvent ? 'completed_from_final_or_history' : 'completed_from_history_without_final',
    });
    setAgentActivity('idle', onActivityChange);
    clearActiveSendRun(runId);

    return {
      messages: assistantMessages,
      lastContent: assistantMessages.length > 0
        ? assistantMessages[assistantMessages.length - 1].content
        : finalStreamedText,
    };
  } catch (error) {
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
      finalizeTurn(turnToken, 'failed', {
        sessionKey,
        runId,
        completionReason: reason,
      });
    }
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
  context: {
    view: string;
    selectedProject?: string;
    openclawWorkspacePath?: string | null;
    openclawContextPolicy?: 'selected-project-first' | 'workspace-default';
  },
  options?: GatewayOptions,
): Promise<SendResult> {
  const transport = await resolveTransport(options?.transport);
  const attachments = options?.attachments ?? [];
  const onStreamDelta = options?.onStreamDelta;
  const onActivityChange = options?.onActivityChange;
  const policy = context.openclawContextPolicy ?? 'selected-project-first';
  const workspacePath = context.openclawWorkspacePath?.trim();
  const contextMessage =
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
    if ((prev === 'disconnected' || prev === 'error') && getActiveTurnCount() === 0) {
      useDashboardStore.getState().setAgentActivity('idle');
    }
    listener(prev);
  });
}

export const __gatewayTestUtils = {
  extractAssistantMessagesForTurn,
  likelyNeedsFinalSettlePass,
  parseProcessPollSnapshot,
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
