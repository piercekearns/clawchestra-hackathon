import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Send, X } from 'lucide-react';
import type { ChatMessage } from '../lib/gateway';

export interface OpenClawComposerImage {
  name: string;
  mediaType: string;
  dataUrl: string;
  size: number;
}

interface OpenClawComposerProps {
  messages: ChatMessage[];
  gatewayConnected: boolean;
  thinking?: boolean;
  streamingContent?: string;
  onSend: (payload: { text: string; images: OpenClawComposerImage[] }) => Promise<boolean>;
}

const MIN_COMPOSER_HEIGHT = 40;
const MAX_COMPOSER_HEIGHT = 210;
const MAX_ATTACHMENTS = 4;
const IMAGE_NAME_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif|svg)$/i;

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

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-revival-accent-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-revival-accent-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-revival-accent-400" />
      </div>
      <span className="text-xs text-neutral-500 dark:text-neutral-400">Thinking...</span>
    </div>
  );
}

export function OpenClawComposer({ messages, gatewayConnected, thinking, streamingContent, onSend }: OpenClawComposerProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(MIN_COMPOSER_HEIGHT);
  const [images, setImages] = useState<OpenClawComposerImage[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [, setDragDepth] = useState(0);
  const [dropFeedback, setDropFeedback] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const appendImages = async (files: File[]) => {
    const imageFiles = files.filter(isImageLikeFile);
    if (imageFiles.length === 0) {
      setDropFeedback('Only image files are supported');
      return;
    }

    const readAsDataUrl = (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsDataURL(file);
      });

    const mapped = await Promise.all(
      imageFiles.map(async (file) => ({
        name: file.name,
        mediaType: file.type || guessMimeType(file.name),
        dataUrl: await readAsDataUrl(file),
        size: file.size,
      })),
    );

    setImages((current) => {
      const existing = new Set(current.map((image) => `${image.name}:${image.size}`));
      const unique = mapped.filter((image) => !existing.has(`${image.name}:${image.size}`));
      const next = [...current, ...unique].slice(0, MAX_ATTACHMENTS);
      const addedCount = next.length - current.length;
      
      // Set feedback inside the setter to get accurate count
      if (addedCount > 0) {
        setDropFeedback(`Attached ${addedCount} image${addedCount > 1 ? 's' : ''}`);
      }
      // Don't show "no new images" - just stay silent if duplicates
      
      return next;
    });
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const nextHeight = Math.max(
      MIN_COMPOSER_HEIGHT,
      Math.min(textarea.scrollHeight, MAX_COMPOSER_HEIGHT),
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_COMPOSER_HEIGHT ? 'auto' : 'hidden';
    setComposerHeight(nextHeight);
  }, [input]);

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
    if (!dropFeedback) return;
    const timer = window.setTimeout(() => setDropFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [dropFeedback]);

  const latestAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role !== 'user') return messages[i];
    }
    return null;
  }, [messages]);

  const expanded = composerHeight > 72;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4 md:px-6">
      <div className="pointer-events-auto w-full">
        {/* Show thinking indicator, streaming content, or latest message */}
        {thinking ? (
          <div className="mb-2 max-h-24 max-w-[78rem] rounded-lg border border-revival-accent-400/40 bg-neutral-0/90 px-3 py-2 shadow-lg backdrop-blur dark:bg-neutral-900/90">
            {streamingContent ? (
              <div className="text-xs text-neutral-700 dark:text-neutral-200">
                {streamingContent}
                <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-revival-accent-400" />
              </div>
            ) : (
              <ThinkingIndicator />
            )}
          </div>
        ) : latestAssistantMessage ? (
          <div className="mb-2 max-h-24 max-w-[78rem] overflow-y-auto rounded-lg border border-neutral-300/80 bg-neutral-0/90 px-3 py-2 text-xs text-neutral-700 shadow-lg backdrop-blur dark:border-neutral-600/80 dark:bg-neutral-900/90 dark:text-neutral-200">
            {latestAssistantMessage.content}
          </div>
        ) : null}

        <form
          ref={formRef}
          onSubmit={async (event) => {
            event.preventDefault();
            const text = input.trim();
            const currentImages = [...images];
            if ((!text && currentImages.length === 0) || sending) return;

            // Clear input immediately (optimistic UI)
            setInput('');
            setImages([]);
            setSending(true);
            
            try {
              await onSend({ text, images: currentImages });
            } finally {
              setSending(false);
            }
          }}
        >
          <div
            className={`relative rounded-xl border border-neutral-300 bg-neutral-0/95 p-2 backdrop-blur transition-all dark:border-neutral-600 dark:bg-neutral-900/95 ${
              expanded ? 'shadow-[0_-20px_42px_rgba(0,0,0,0.46)]' : 'shadow-2xl'
            } ${dragActive ? 'border-revival-accent-400 ring-2 ring-revival-accent-400/40' : ''}`}
            onDragOver={(event) => {
              if (!hasFilePayload(event.dataTransfer)) return;
              event.preventDefault();
              setDragActive(true);
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            }}
            onDragEnter={(event) => {
              if (!hasFilePayload(event.dataTransfer)) return;
              event.preventDefault();
              setDragDepth((value) => value + 1);
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              if (!hasFilePayload(event.dataTransfer)) return;
              event.preventDefault();
              setDragDepth((value) => {
                const next = Math.max(0, value - 1);
                if (next === 0) setDragActive(false);
                return next;
              });
            }}
            onDrop={async (event) => {
              if (!hasFilePayload(event.dataTransfer)) return;
              event.preventDefault();
              event.stopPropagation();
              setDragActive(false);
              setDragDepth(0);
              await appendImages(Array.from(event.dataTransfer.files ?? []));
            }}
          >
            {dragActive ? (
              <div className="pointer-events-none absolute inset-0 z-10 rounded-xl border-2 border-dashed border-revival-accent-400 bg-revival-accent-200/10 dark:bg-revival-accent-900/20" />
            ) : null}

            <div className="mb-2 flex items-center gap-2 px-1 text-xs text-neutral-500 dark:text-neutral-400">
              <span className="font-semibold uppercase tracking-[0.06em]">OpenClaw</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] dark:border-neutral-600">
                <Circle
                  className={`h-2.5 w-2.5 ${
                    gatewayConnected
                      ? 'fill-revival-accent-400 text-revival-accent-400'
                      : 'fill-status-danger text-status-danger'
                  }`}
                />
                {gatewayConnected ? 'Connected' : 'Disconnected'}
              </span>
              {images.length > 0 ? (
                <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] dark:border-neutral-600">
                  {images.length} image{images.length > 1 ? 's' : ''} attached
                </span>
              ) : null}
            </div>

            <div className="relative rounded-lg border border-neutral-300/70 bg-neutral-0/80 focus-within:ring-1 focus-within:ring-revival-accent-400/40 dark:border-neutral-600 dark:bg-neutral-950/70">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={async (event) => {
                  const files = Array.from(event.clipboardData.files ?? []);
                  if (files.length === 0) return;
                  await appendImages(files);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    formRef.current?.requestSubmit();
                  }
                }}
                placeholder={
                  gatewayConnected
                    ? 'Message OpenClaw (Enter sends, Shift+Enter newline)...'
                    : 'Gateway offline. You can still draft here.'
                }
                className="max-h-[210px] w-full resize-none border-0 bg-transparent px-3 pb-[8px] pt-[12px] pr-12 text-sm leading-5 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-400"
              />
              <button
                type="submit"
                disabled={sending || (!input.trim() && images.length === 0)}
                aria-label="Send message"
                title="Send message"
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#DFFF00] p-0 leading-none text-neutral-900 transition-colors hover:bg-[#c8e600]"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>

          {images.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5 px-1">
              {images.map((image, index) => (
                <button
                  type="button"
                  key={`${image.name}-${index}`}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-neutral-0 px-2 py-1 text-[11px] text-neutral-700 hover:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-500"
                  onClick={() => {
                    setImages((current) => current.filter((_, i) => i !== index));
                  }}
                  title={`Remove ${image.name}`}
                >
                  <span className="max-w-[14rem] truncate">{image.name}</span>
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
