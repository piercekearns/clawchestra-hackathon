import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ChatMessage } from '../../lib/gateway';
import { ChatBar } from './ChatBar';
import { MessageList } from './MessageList';
import { ResponseToast } from './ResponseToast';
import {
  createAttachmentId,
  createQueueId,
  type ChatAttachment,
  type ChatConnectionState,
  type ChatPrefillRequest,
  type ChatSendPayload,
  type QueuedMessage,
} from './types';

const MAX_ATTACHMENTS = 4;
const IMAGE_NAME_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif|svg)$/i;
const MAX_IMAGE_DIMENSION = 1920; // Resize large images to fit within this dimension
const MAX_IMAGE_BYTES = 150_000; // Target max ~150KB base64 to stay under CLI limits
const MAX_TOTAL_IMAGE_BYTES = 300_000; // Keep multi-image messages under gateway WS payload limits
const MIN_DRAWER_HEIGHT_PERCENT = 0.15; // Below this, drawer auto-closes
const MAX_DRAWER_HEIGHT_PERCENT = 0.95;
const DEFAULT_DRAWER_HEIGHT_PERCENT = 0.75; // Default open height (was 0.6)
const MIN_DRAWER_HEIGHT_PX = 120; // Minimum before auto-close triggers
const AUTO_CLOSE_THRESHOLD_PERCENT = 0.12; // Drag below this to auto-close

function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

function guessMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function isImageLikeFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_NAME_PATTERN.test(file.name);
}

/**
 * Resize image to fit within MAX_IMAGE_DIMENSION and compress to JPEG.
 * Returns a data URL that stays under MAX_IMAGE_BYTES.
 */
async function resizeImageIfNeeded(file: File): Promise<{ dataUrl: string; size: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      let { width, height } = img;
      
      // Only resize if image is larger than max dimension
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      
      // Start with quality 0.85, reduce if too large
      let quality = 0.85;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      
      // Iteratively reduce quality if still too large
      while (dataUrl.length > MAX_IMAGE_BYTES && quality > 0.3) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      
      resolve({ dataUrl, size: dataUrl.length });
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    
    img.src = url;
  });
}

const TITLE_BAR_HEIGHT = 46; // Custom title bar height (see TitleBar.tsx)

function clampDrawerHeight(nextHeightPx: number): number {
  const containerHeight = window.innerHeight - TITLE_BAR_HEIGHT;
  const minHeightPx = Math.max(MIN_DRAWER_HEIGHT_PX, containerHeight * MIN_DRAWER_HEIGHT_PERCENT);
  const maxHeightPx = containerHeight * MAX_DRAWER_HEIGHT_PERCENT;
  return Math.max(minHeightPx, Math.min(nextHeightPx, maxHeightPx));
}

function getDefaultDrawerHeightPx(): number {
  if (typeof window === 'undefined') return 420;
  return clampDrawerHeight((window.innerHeight - TITLE_BAR_HEIGHT) * DEFAULT_DRAWER_HEIGHT_PERCENT);
}

function normalizePreviewContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function previewContentOverlaps(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function looksLikeProgressiveAssistantRun(run: ChatMessage[]): boolean {
  if (run.length < 2) return false;
  const normalized = run.map((message) => normalizePreviewContent(message.content));
  if (normalized.some((value) => !value)) return false;
  for (let i = 1; i < normalized.length; i += 1) {
    if (!previewContentOverlaps(normalized[i - 1], normalized[i])) {
      return false;
    }
  }
  return true;
}

interface ChatShellProps {
  messages: ChatMessage[];
  gatewayConnected: boolean;
  connectionState: ChatConnectionState;
  activityLabel: string | null;
  activeModelLabel?: string | null;
  activeModelTooltip?: string | null;
  streamingContent?: string | null;
  prefillRequest?: ChatPrefillRequest | null;
  drawerOpen: boolean;
  responseToastMessage: string | null;
  isAgentWorking: boolean; // True when agent is processing
  showPendingBubble?: boolean;
  queue: QueuedMessage[];
  hasMoreMessages?: boolean;
  loadingMoreMessages?: boolean;
  onSend: (payload: ChatSendPayload) => Promise<boolean>;
  onQueueMessage: (payload: ChatSendPayload) => void;
  onRemoveFromQueue: (id: string) => void;
  onRetryQueuedMessage: (id: string) => void;
  onDrawerOpenChange: (open: boolean) => void;
  onDismissResponseToast: () => void;
  onLoadMore?: () => void;
  onRetryConnection?: () => void;
}

export function ChatShell({
  messages,
  gatewayConnected,
  connectionState,
  activityLabel,
  activeModelLabel,
  activeModelTooltip,
  streamingContent,
  prefillRequest,
  drawerOpen,
  responseToastMessage,
  isAgentWorking,
  showPendingBubble = false,
  queue,
  hasMoreMessages,
  loadingMoreMessages,
  onSend,
  onQueueMessage,
  onRemoveFromQueue,
  onRetryQueuedMessage,
  onDrawerOpenChange,
  onDismissResponseToast,
  onLoadMore,
  onRetryConnection,
}: ChatShellProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [images, setImages] = useState<ChatAttachment[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [drawerHeightPx, setDrawerHeightPx] = useState(getDefaultDrawerHeightPx());

  const resizingRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(0);
  const drawerHeightRef = useRef(drawerHeightPx);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composerContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    drawerHeightRef.current = drawerHeightPx;
  }, [drawerHeightPx]);

  useEffect(() => {
    const onResize = () => {
      setDrawerHeightPx((current) => clampDrawerHeight(current));
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!drawerOpen || !responseToastMessage) return;
    onDismissResponseToast();
  }, [drawerOpen, responseToastMessage, onDismissResponseToast]);

  useEffect(() => {
    if (!prefillRequest) return;

    setInput(prefillRequest.text);
    setImages([]);

    window.setTimeout(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      const cursor = prefillRequest.text.length;
      node.setSelectionRange(cursor, cursor);
    }, 0);
  }, [prefillRequest?.id, prefillRequest]);

  const appendImages = async (files: File[]) => {
    const imageFiles = files.filter(isImageLikeFile);
    if (imageFiles.length === 0) return;
    setAttachmentNotice(null);

    // Resize and compress images to stay under CLI payload limits
    let mapped: ChatAttachment[];
    try {
      mapped = await Promise.all(
        imageFiles.map(async (file) => {
          const { dataUrl, size } = await resizeImageIfNeeded(file);
          return {
            id: createAttachmentId(),
            name: file.name.replace(/\.[^.]+$/, '.jpg'), // Rename to .jpg since we convert
            mediaType: 'image/jpeg',
            dataUrl,
            size,
          };
        }),
      );
    } catch (error) {
      setAttachmentNotice(error instanceof Error ? error.message : 'Failed to process attachment');
      return;
    }

    let nextNotice: string | null = null;
    setImages((current) => {
      const existing = new Set(current.map((image) => `${image.name}:${image.size}`));
      const next = [...current];
      let totalBytes = next.reduce((sum, image) => sum + image.size, 0);
      let skippedForCount = 0;
      let skippedForSize = 0;
      let skippedDuplicates = 0;

      for (const image of mapped) {
        const key = `${image.name}:${image.size}`;
        if (existing.has(key)) {
          skippedDuplicates += 1;
          continue;
        }
        existing.add(key);

        if (next.length >= MAX_ATTACHMENTS) {
          skippedForCount += 1;
          continue;
        }

        if (totalBytes + image.size > MAX_TOTAL_IMAGE_BYTES) {
          skippedForSize += 1;
          continue;
        }

        next.push(image);
        totalBytes += image.size;
      }

      if (skippedForSize > 0) {
        nextNotice = `Attachment limit reached (${Math.round(
          MAX_TOTAL_IMAGE_BYTES / 1024,
        )}KB total). Remove images or send in smaller batches.`;
      } else if (skippedForCount > 0) {
        nextNotice = `You can attach up to ${MAX_ATTACHMENTS} images per message.`;
      } else if (skippedDuplicates > 0) {
        nextNotice = 'Skipped duplicate attachment.';
      }

      return next;
    });
    setAttachmentNotice(nextNotice);
  };

  useEffect(() => {
    const onWindowDragEnter = (event: DragEvent) => {
      if (!hasFilePayload(event.dataTransfer)) return;
      event.preventDefault();
      setDragDepth((value) => value + 1);
      setDragActive(true);
    };

    const onWindowDragOver = (event: DragEvent) => {
      if (!hasFilePayload(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    };

    const onWindowDragLeave = (event: DragEvent) => {
      if (!hasFilePayload(event.dataTransfer)) return;
      event.preventDefault();
      setDragDepth((value) => {
        const next = Math.max(0, value - 1);
        if (next === 0) setDragActive(false);
        return next;
      });
    };

    const onWindowDrop = (event: DragEvent) => {
      if (!hasFilePayload(event.dataTransfer)) return;
      event.preventDefault();
      setDragDepth(0);
      setDragActive(false);
      void appendImages(Array.from(event.dataTransfer?.files ?? []));
    };

    window.addEventListener('dragenter', onWindowDragEnter);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('dragleave', onWindowDragLeave);
    window.addEventListener('drop', onWindowDrop);

    return () => {
      window.removeEventListener('dragenter', onWindowDragEnter);
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('dragleave', onWindowDragLeave);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, []);

  useEffect(() => {
    const onMove = (clientY: number) => {
      if (!resizingRef.current) return;
      const delta = resizeStartYRef.current - clientY;
      const nextHeight = clampDrawerHeight(resizeStartHeightRef.current + delta);
      setDrawerHeightPx(nextHeight);
    };

    const onMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      onMove(event.clientY);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 0) return;
      onMove(event.touches[0].clientY);
    };

    const stopResizing = () => {
      resizingRef.current = false;
      document.body.style.userSelect = '';
      
      // Auto-close if dragged below threshold
      const thresholdPx = window.innerHeight * AUTO_CLOSE_THRESHOLD_PERCENT;
      if (drawerHeightRef.current < thresholdPx) {
        onDrawerOpenChange(false);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', stopResizing);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stopResizing);
    };
  }, []);

  const startResize = (clientY: number) => {
    resizingRef.current = true;
    resizeStartYRef.current = clientY;
    resizeStartHeightRef.current = drawerHeightPx;
    document.body.style.userSelect = 'none';
  };

  // Keep chat content anchored to the top edge of the composer container.
  // When the composer grows/shrinks (Shift+Enter, queued rows, images),
  // keep the message list anchored if the user was near the bottom.
  // Previous delta-based approach accumulated rounding errors at the scroll
  // boundary. This simpler strategy: if within 200px of the bottom before
  // the resize, snap to the new bottom after.
  useLayoutEffect(() => {
    if (!drawerOpen || typeof ResizeObserver === 'undefined') return;
    const composerNode = composerContainerRef.current;
    const messageNode = messageListRef.current;
    if (!composerNode || !messageNode) return;

    // Track distance from bottom on every scroll event so we know
    // the user's position at the moment the resize fires.
    let lastDistFromBottom = messageNode.scrollHeight - messageNode.scrollTop - messageNode.clientHeight;
    const onScroll = () => {
      lastDistFromBottom = messageNode.scrollHeight - messageNode.scrollTop - messageNode.clientHeight;
    };
    messageNode.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      // After flex recalculates, if we were near the bottom, snap there.
      // The 200px threshold covers the composer growth plus a small buffer.
      if (lastDistFromBottom < 200) {
        messageNode.scrollTop = messageNode.scrollHeight - messageNode.clientHeight;
      }
      // Update tracking after our own scroll adjustment
      lastDistFromBottom = messageNode.scrollHeight - messageNode.scrollTop - messageNode.clientHeight;
    });

    observer.observe(composerNode);
    return () => {
      observer.disconnect();
      messageNode.removeEventListener('scroll', onScroll);
    };
  }, [drawerOpen]);

  const latestResponsePreview = useMemo(() => {
    if (!responseToastMessage) return null;
    return responseToastMessage;
  }, [responseToastMessage]);

  const displayMessages = useMemo(() => {
    if (!streamingContent) return messages;

    const streamingNormalized = normalizePreviewContent(streamingContent);
    if (!streamingNormalized) return messages;

    // If the latest turn already has a trailing assistant run and the streaming
    // preview overlaps with it, replace the whole run with one live preview entry.
    // This prevents "fragmented assistant bubbles + combined streaming bubble"
    // duplication during active runs.
    let assistantRunStart = messages.length;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role !== 'assistant') break;
      assistantRunStart = i;
    }
    if (assistantRunStart < messages.length) {
      const run = messages.slice(assistantRunStart);
      const newestRunTimestamp = run.reduce(
        (latest, message) => Math.max(latest, message.timestamp ?? 0),
        0,
      );
      const closeInTime = Math.abs(Date.now() - newestRunTimestamp) <= 10 * 60_000;
      const runNormalized = normalizePreviewContent(run.map((message) => message.content).join('\n\n'));
      const overlapsRun =
        runNormalized.length > 0 &&
        closeInTime &&
        previewContentOverlaps(streamingNormalized, runNormalized);
      const runIsProgressive = looksLikeProgressiveAssistantRun(run);
      if (overlapsRun) {
        const anchor = run[run.length - 1];
        return [
          ...messages.slice(0, assistantRunStart),
          {
            ...anchor,
            content: streamingContent,
            timestamp: Date.now(),
          },
        ];
      }
      if (closeInTime && runIsProgressive) {
        const anchor = run[run.length - 1];
        return [
          ...messages.slice(0, assistantRunStart),
          {
            ...anchor,
            content: streamingContent,
            timestamp: Date.now(),
          },
        ];
      }
    }

    const next = [...messages];

    for (let i = next.length - 1; i >= 0; i -= 1) {
      const candidate = next[i];
      if (candidate.role === 'system') continue;
      if (candidate.role !== 'assistant') break;

      const existingNormalized = normalizePreviewContent(candidate.content);
      const closeInTime =
        Math.abs((candidate.timestamp ?? 0) - Date.now()) <= 10 * 60_000;
      if (
        closeInTime &&
        previewContentOverlaps(streamingNormalized, existingNormalized)
      ) {
        next[i] = {
          ...candidate,
          content: streamingContent,
          timestamp: Date.now(),
        };
        return next;
      }
      break;
    }

    return [...messages, { role: 'assistant' as const, content: streamingContent, timestamp: Date.now() }];
  }, [messages, streamingContent]);

  const submit = async () => {
    const text = input.trim();
    const currentImages = [...images];
    if (!text && currentImages.length === 0) return;

    // Clear input immediately
    setInput('');
    setImages([]);
    setAttachmentNotice(null);

    const payload: ChatSendPayload = { text, images: currentImages };

    // If agent is working, queue instead of sending
    if (isAgentWorking) {
      onQueueMessage(payload);
      return;
    }

    // Send immediately
    setSending(true);
    try {
      await onSend(payload);
    } finally {
      setSending(false);
    }
  };

  // Combined sending state: local sending OR agent is working globally
  const showAsSending = sending || isAgentWorking;

  return (
    <div className={`pointer-events-none z-40 flex shrink-0 justify-center ${drawerOpen ? 'absolute inset-x-0 bottom-0 px-4 pb-4 md:px-6' : ''}`}>
      <div className="pointer-events-auto w-full">
        {latestResponsePreview && !drawerOpen ? (
          <ResponseToast
            message={latestResponsePreview}
            onDismiss={onDismissResponseToast}
            onOpen={() => {
              onDismissResponseToast();
              onDrawerOpenChange(true);
              window.setTimeout(() => textareaRef.current?.focus(), 0);
            }}
          />
        ) : null}

        {drawerOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 bg-black/35"
              onClick={() => onDrawerOpenChange(false)}
              aria-label="Close chat drawer backdrop"
            />

            <section
              className="relative z-40 flex w-full flex-col overflow-hidden rounded-xl border border-neutral-300/80 bg-neutral-0/95 shadow-2xl backdrop-blur dark:border-neutral-600 dark:bg-neutral-900/95"
              style={{ height: `${drawerHeightPx}px` }}
              aria-label="Chat drawer"
            >
              {/* Drawer header - resize handle area (invisible) with centered toggle */}
              <div
                className="relative flex w-full cursor-row-resize items-center justify-center py-2"
                onMouseDown={(event) => startResize(event.clientY)}
                onTouchStart={(event) => {
                  if (event.touches.length > 0) startResize(event.touches[0].clientY);
                }}
                aria-label="Resize drawer"
                title="Drag to resize"
              >
                <button
                  type="button"
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => onDrawerOpenChange(false)}
                  aria-label="Collapse chat drawer"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              {connectionState === 'error' && onRetryConnection && (
                <div className="flex items-center justify-between border-b border-status-danger/20 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
                  <span>Connection failed after 5 attempts.</span>
                  <button
                    type="button"
                    className="rounded-full border border-status-danger/50 px-2 py-0.5 hover:bg-status-danger/10"
                    onClick={onRetryConnection}
                  >
                    Retry
                  </button>
                </div>
              )}

              <MessageList
                ref={messageListRef}
                messages={displayMessages}
                // Show the synthetic pending bubble until visible streamed text arrives.
                showReadingIndicator={showPendingBubble && !streamingContent}
                className="flex-1"
                hasMore={hasMoreMessages}
                loadingMore={loadingMoreMessages}
                onLoadMore={onLoadMore}
              />

              <div
                ref={composerContainerRef}
                className="border-t border-neutral-300/80 dark:border-neutral-700/80"
              >
                <ChatBar
                  ref={textareaRef}
                  variant="embedded"
                  showToggle={false}
                  connectionState={connectionState}
                  activityLabel={activityLabel}
                  activeModelLabel={activeModelLabel}
                  activeModelTooltip={activeModelTooltip}
                  drawerOpen={drawerOpen}
                  input={input}
                  sending={showAsSending}
                  dragActive={dragActive}
                  images={images}
                  attachmentNotice={attachmentNotice}
                  gatewayConnected={gatewayConnected}
                  queue={queue}
                  onInputChange={setInput}
                  onToggleDrawer={() => onDrawerOpenChange(!drawerOpen)}
                  onSubmit={() => {
                    void submit();
                  }}
                  onRemoveImage={(index) => {
                    setImages((current) => current.filter((_, i) => i !== index));
                    setAttachmentNotice(null);
                  }}
                  onRemoveFromQueue={onRemoveFromQueue}
                  onRetryQueuedMessage={onRetryQueuedMessage}
                  onPasteFiles={appendImages}
                  onDropFiles={appendImages}
                  onDragStateChange={(active) => {
                    setDragActive(active);
                    if (!active) setDragDepth(0);
                  }}
                />
              </div>
            </section>
          </>
        ) : (
          <div className="relative z-40">
          <ChatBar
            ref={textareaRef}
            variant="floating"
            showToggle
            connectionState={connectionState}
            activityLabel={activityLabel}
            activeModelLabel={activeModelLabel}
            activeModelTooltip={activeModelTooltip}
            drawerOpen={drawerOpen}
            input={input}
            sending={showAsSending}
            dragActive={dragActive}
            images={images}
            attachmentNotice={attachmentNotice}
            gatewayConnected={gatewayConnected}
            queue={queue}
            onInputChange={setInput}
            onToggleDrawer={() => onDrawerOpenChange(!drawerOpen)}
            onSubmit={() => {
              void submit();
            }}
            onRemoveImage={(index) => {
              setImages((current) => current.filter((_, i) => i !== index));
              setAttachmentNotice(null);
            }}
            onRemoveFromQueue={onRemoveFromQueue}
            onRetryQueuedMessage={onRetryQueuedMessage}
            onPasteFiles={appendImages}
            onDropFiles={appendImages}
            onDragStateChange={(active) => {
              setDragActive(active);
              if (!active) setDragDepth(0);
            }}
          />
          </div>
        )}
      </div>
    </div>
  );
}
