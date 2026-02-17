import {
  checkOpenClawGatewayConnection,
  getOpenClawGatewayConfig,
  sendOpenClawMessage,
} from './tauri';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
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
  onActivityChange?: (label: string) => void;
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

async function sendViaTauriWs(
  messageText: string,
  attachments: GatewayImageAttachment[],
  transport: GatewayTransport,
  onStreamDelta?: (content: string) => void,
  onActivityChange?: (label: string) => void,
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

  // Get message count BEFORE sending so we know where new messages start
  let messageCountBefore = 0;
  try {
    const historyBefore = (await connection.request('chat.history', {
      sessionKey,
      limit: 1,
    })) as { total?: number; messages?: unknown[] };
    messageCountBefore = historyBefore.total ?? historyBefore.messages?.length ?? 0;
    console.log('[Gateway] Message count before send:', messageCountBefore);
  } catch (e) {
    console.warn('[Gateway] Failed to get message count before send:', e);
  }

  try {
    // Send the message
    console.log('[Gateway] Sending chat.send via tauri-ws, connection.connected:', connection.connected);
    await connection.request('chat.send', {
      sessionKey,
      message: messageText,
      deliver: false,
      idempotencyKey: runId,
      attachments: attachments.length > 0 ? toOpenClawAttachments(attachments) : undefined,
    });
    console.log('[Gateway] chat.send succeeded');

    // Wait for response using hybrid approach: events + polling
    // Events provide real-time updates, polling ensures we catch completion even if events are missed
    await new Promise<void>((resolve, reject) => {
      let completed = false;
      let finalDebounceTimer: ReturnType<typeof setTimeout> | null = null;
      let sawFinal = false; // Track if we've seen at least one final
      
      // Cancel any pending completion timer (call when activity resumes)
      const cancelFinalDebounce = () => {
        if (finalDebounceTimer) {
          console.log('[Gateway] Activity detected, canceling completion timer');
          clearTimeout(finalDebounceTimer);
          finalDebounceTimer = null;
        }
      };
      
      // Start/restart the completion timer
      const startFinalDebounce = () => {
        cancelFinalDebounce();
        finalDebounceTimer = setTimeout(() => {
          console.log('[Gateway] Final debounce elapsed (2s no activity), resolving');
          cleanup();
          resolve();
        }, 2000);
      };
      
      // Cleanup function to stop all listeners/timers
      const cleanup = () => {
        if (completed) return;
        completed = true;
        clearTimeout(safetyTimeout);
        clearInterval(pollInterval);
        cancelFinalDebounce();
        unsubscribe();
      };

      // Safety timeout (30 min) - only if both events AND polling fail
      const safetyTimeout = setTimeout(() => {
        console.warn('[Gateway] Safety timeout after 30 minutes');
        cleanup();
        resolve();
      }, 30 * 60 * 1000);

      // Track when we last received an event (to detect stalled connections)
      let lastEventTime = Date.now();
      
      // Poll for completion only if no events received for 30+ seconds
      // This is a true fallback, not the primary mechanism
      const pollInterval = setInterval(async () => {
        if (completed) return;
        
        const timeSinceLastEvent = Date.now() - lastEventTime;
        
        // Only poll if events have stalled for 30+ seconds
        if (timeSinceLastEvent < 30000) {
          return;
        }
        
        console.log('[Gateway] No events for 30s, polling for completion...');
        
        try {
          const pollHistory = (await connection.request('chat.history', {
            sessionKey,
            limit: 5,
          })) as { messages?: Array<Record<string, unknown>> };
          
          const messages = pollHistory.messages ?? [];
          const latestAssistant = messages.find(m => m.role === 'assistant');
          
          if (latestAssistant) {
            const content = extractText(latestAssistant.content);
            if (content && content.length > streamedText.length) {
              streamedText = content;
              if (onStreamDelta) {
                onStreamDelta(streamedText);
              }
            }
            
            // If we have content and events stalled, assume complete
            if (content) {
              console.log('[Gateway] Poll fallback: found assistant message, resolving');
              cleanup();
              resolve();
            }
          }
        } catch (e) {
          console.warn('[Gateway] Poll failed:', e);
        }
      }, 10000); // Check every 10s but only act if stalled

      // Map states to user-friendly activity labels
      const stateLabels: Record<string, string> = {
        thinking: 'Thinking...',
        reasoning: 'Reasoning...',
        tool_use: 'Using tools...',
        tool_call: 'Using tools...',
        tool_result: 'Processing results...',
        reading: 'Reading...',
        writing: 'Writing...',
        searching: 'Searching...',
        executing: 'Running command...',
        delta: 'Streaming...',
        streaming: 'Streaming...',
      };

      // Subscribe to real-time events (primary mechanism)
      const unsubscribe = connection.subscribe((eventName, payload) => {
        if (completed) return;
        
        // Track event activity (for stall detection)
        lastEventTime = Date.now();
        
        if (eventName !== 'chat') return;

        const chat = (typeof payload === 'object' && payload !== null
          ? payload
          : {}) as Record<string, unknown>;

        if (typeof chat.sessionKey === 'string' && chat.sessionKey !== sessionKey) return;
        if (typeof chat.runId === 'string' && chat.runId !== runId) return;

        const state = typeof chat.state === 'string' ? chat.state : '';

        // Update activity label for known states
        if (state && stateLabels[state] && onActivityChange) {
          onActivityChange(stateLabels[state]);
        }
        
        // If we see activity states after a 'final', cancel the completion timer
        // This handles sub-agents starting new work after an initial response
        const activityStates = ['thinking', 'reasoning', 'tool_use', 'tool_call', 'reading', 'writing', 'searching', 'executing'];
        if (activityStates.includes(state) && sawFinal) {
          cancelFinalDebounce();
        }

        if (state === 'delta') {
          const deltaText = extractText(chat.message);
          if (deltaText && deltaText.length >= streamedText.length) {
            streamedText = deltaText;
            if (onStreamDelta) {
              onStreamDelta(streamedText);
            }
          }
          return;
        }

        if (state === 'error') {
          cleanup();
          reject(new Error(typeof chat.errorMessage === 'string' ? chat.errorMessage : 'OpenClaw chat error'));
          return;
        }

        if (state === 'aborted') {
          cleanup();
          reject(new Error('OpenClaw chat aborted'));
          return;
        }

        if (state === 'final') {
          // Extract final content if present
          const finalText = extractText(chat.message);
          if (finalText && finalText.length >= streamedText.length) {
            streamedText = finalText;
            if (onStreamDelta) {
              onStreamDelta(streamedText);
            }
          }
          sawFinal = true;
          console.log('[Gateway] Received final event, starting 2s completion timer');
          
          // Start completion timer - will be canceled if activity resumes
          // This handles sub-agents sending multiple responses in sequence
          startFinalDebounce();
        }
      });
    });

    // Small delay to ensure message is persisted before fetching history
    await new Promise((r) => setTimeout(r, 50));

    // Fetch history to get ALL new messages (not just the last one)
    const historyAfter = (await connection.request('chat.history', {
      sessionKey,
      limit: 100, // Get enough to capture all new messages
    })) as { messages?: Array<Record<string, unknown>> };

    const allMessages = historyAfter.messages ?? [];
    
    // Extract new assistant messages (messages added after our send)
    // We sent a user message + got assistant responses, so skip the first messageCountBefore + 1
    const newMessages: ChatMessage[] = [];
    const startIndex = Math.max(0, allMessages.length - (allMessages.length - messageCountBefore));
    
    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      // Only include assistant messages that came after our user message
      if (msg.role === 'assistant') {
        const content = extractText(msg.content);
        if (content.trim()) {
          newMessages.push({
            role: 'assistant',
            content: content.trim(),
            timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
          });
        }
      }
    }

    // Filter to only messages we haven't seen (after messageCountBefore)
    // History is returned newest-first, so reverse to get chronological order
    const reversedMessages = [...allMessages].reverse();
    const assistantMessages: ChatMessage[] = [];
    let foundUserMessage = false;
    
    for (const msg of reversedMessages) {
      // Look for our user message (contains the messageText we sent)
      if (msg.role === 'user') {
        const userContent = extractText(msg.content);
        if (userContent.includes(messageText.slice(0, 50))) {
          foundUserMessage = true;
          continue;
        }
      }
      // Collect assistant messages after our user message
      if (foundUserMessage && msg.role === 'assistant') {
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

    console.log('[Gateway] Found', assistantMessages.length, 'new assistant messages');

    // Fallback: if we couldn't find messages via history matching, use streamed text
    if (assistantMessages.length === 0 && streamedText.trim()) {
      assistantMessages.push({
        role: 'assistant',
        content: streamedText.trim(),
        timestamp: Date.now(),
      });
    }

    // Safety check: if streamed text is longer than history result, prefer streamed text
    // This handles race conditions where history hasn't fully persisted
    const lastHistoryContent = assistantMessages.length > 0 
      ? assistantMessages[assistantMessages.length - 1].content 
      : '';
    
    if (streamedText.trim().length > lastHistoryContent.length) {
      console.log('[Gateway] Streamed text longer than history, using streamed text');
      if (assistantMessages.length > 0) {
        assistantMessages[assistantMessages.length - 1].content = streamedText.trim();
      } else {
        assistantMessages.push({
          role: 'assistant',
          content: streamedText.trim(),
          timestamp: Date.now(),
        });
      }
    }

    return {
      messages: assistantMessages,
      lastContent: assistantMessages.length > 0 
        ? assistantMessages[assistantMessages.length - 1].content 
        : streamedText.trim(),
    };
  } catch (e) {
    // If WebSocket fails, don't close the connection (it might be reusable)
    throw e;
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
