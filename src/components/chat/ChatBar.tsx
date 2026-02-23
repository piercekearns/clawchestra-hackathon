import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Send, X, Clock } from 'lucide-react';
import { ActivityIndicator } from './ActivityIndicator';
import { CommandDropdown } from './CommandDropdown';
import { StatusBadge } from './StatusBadge';
import type { ChatAttachment, ChatConnectionState, QueuedMessage } from './types';

const MIN_INPUT_HEIGHT = 40;
const MAX_INPUT_HEIGHT = 210;

// Check if input shows a partial slash command (no space yet = still selecting)
function shouldShowCommandDropdown(input: string): boolean {
  if (!input.startsWith('/')) return false;
  // Hide dropdown once a space appears (command was selected)
  return !input.slice(1).includes(' ');
}

function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

interface ChatBarProps {
  connectionState: ChatConnectionState;
  activityLabel: string | null;
  activeModelLabel?: string | null;
  activeModelTooltip?: string | null;
  drawerOpen: boolean;
  variant?: 'floating' | 'embedded';
  showToggle?: boolean;
  input: string;
  sending: boolean;
  dragActive: boolean;
  images: ChatAttachment[];
  gatewayConnected: boolean;
  queue: QueuedMessage[];
  attachmentNotice?: string | null;
  onInputChange: (value: string) => void;
  onToggleDrawer: () => void;
  onSubmit: () => void;
  onRemoveImage: (index: number) => void;
  onRemoveFromQueue: (id: string) => void;
  onPasteFiles: (files: File[]) => Promise<void>;
  onDropFiles: (files: File[]) => Promise<void>;
  onDragStateChange: (active: boolean) => void;
  onComposerHeightChange?: (heightDelta: number) => void;
}

export const ChatBar = forwardRef<HTMLTextAreaElement, ChatBarProps>(function ChatBar(
  {
    connectionState,
    activityLabel,
    activeModelLabel,
    activeModelTooltip,
    drawerOpen,
    variant = 'floating',
    showToggle = true,
    input,
    sending,
    dragActive,
    images,
    gatewayConnected,
    queue,
    attachmentNotice,
    onInputChange,
    onToggleDrawer,
    onSubmit,
    onRemoveImage,
    onRemoveFromQueue,
    onPasteFiles,
    onDropFiles,
    onDragStateChange,
    onComposerHeightChange,
  },
  forwardedRef,
) {
  const [composerHeight, setComposerHeight] = useState(MIN_INPUT_HEIGHT);
  const [dropdownDismissed, setDropdownDismissed] = useState(false);
  const prevInputRef = useRef(input);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const showDropdown = shouldShowCommandDropdown(input) && !dropdownDismissed;
  const showModelBadge = connectionState === 'connected' && Boolean(activeModelLabel);
  
  // Reset dismissed state only when input actually changes
  useEffect(() => {
    const prevInput = prevInputRef.current;
    prevInputRef.current = input;
    
    if (!dropdownDismissed) return;
    
    // Reset if they cleared the slash
    if (!input.startsWith('/')) {
      setDropdownDismissed(false);
      return;
    }
    
    // Reset if they typed a NEW slash (input went from non-slash to slash)
    if (!prevInput.startsWith('/') && input.startsWith('/')) {
      setDropdownDismissed(false);
      return;
    }
    
    // Reset if they're typing more after the slash (actively filtering)
    if (input.length > prevInput.length && input.startsWith('/')) {
      setDropdownDismissed(false);
    }
  }, [input, dropdownDismissed]);

  // useLayoutEffect runs BEFORE the browser paints, preventing the
  // visible flash where the textarea momentarily shows text at the wrong
  // height (which caused phantom line-break flickers).
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;

    // Reset to min height to measure true content height
    node.style.height = `${MIN_INPUT_HEIGHT}px`;
    const scrollHeight = node.scrollHeight;
    const nextHeight = Math.max(MIN_INPUT_HEIGHT, Math.min(scrollHeight, MAX_INPUT_HEIGHT));
    node.style.height = `${nextHeight}px`;
    node.style.maxHeight = `${MAX_INPUT_HEIGHT}px`;
    node.style.overflowY = scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden';
    setComposerHeight((prev) => {
      const delta = nextHeight - prev;
      if (delta !== 0 && onComposerHeightChange) {
        onComposerHeightChange(delta);
      }
      return nextHeight;
    });
  }, [input, onComposerHeightChange]);

  const expanded = composerHeight > 72;
  const isFloating = variant === 'floating';
  const hasContent = input.trim() || images.length > 0;

  return (
    <div
      className={`relative flex w-full flex-col ${
        isFloating
          ? `max-h-[50vh] rounded-xl border border-neutral-300 bg-neutral-0/95 backdrop-blur transition-all dark:border-neutral-600 dark:bg-neutral-900/95 ${
              expanded ? 'shadow-[0_-20px_42px_rgba(0,0,0,0.46)]' : 'shadow-2xl'
            }`
          : ''
      } ${dragActive ? 'ring-2 ring-revival-accent-400/40' : ''}`}
      onDragOver={(event) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        onDragStateChange(true);
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        onDragStateChange(false);
      }}
      onDrop={async (event) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        onDragStateChange(false);
        await onDropFiles(Array.from(event.dataTransfer.files ?? []));
      }}
    >
      {dragActive ? (
        <div
          className={`pointer-events-none absolute inset-0 z-10 border-2 border-dashed border-revival-accent-400 bg-revival-accent-200/10 dark:bg-revival-accent-900/20 ${
            isFloating ? 'rounded-xl' : 'rounded-none'
          }`}
        />
      ) : null}

      {isFloating ? (
        <button
          type="button"
          className="relative flex w-full flex-shrink-0 items-center gap-2 border-b border-neutral-300/80 px-3 py-2 text-left dark:border-neutral-700/80"
          onClick={onToggleDrawer}
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? 'Collapse chat drawer' : 'Open chat drawer'}
          title={drawerOpen ? 'Collapse chat drawer' : 'Open chat drawer'}
        >
          <span className="font-semibold uppercase tracking-[0.06em] text-[11px] text-neutral-600 dark:text-neutral-300">
            OpenClaw
          </span>
          {showModelBadge ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] text-neutral-700 dark:border-neutral-600 dark:text-neutral-300"
              title={activeModelTooltip ?? activeModelLabel}
            >
              {activeModelLabel}
            </span>
          ) : (
            <StatusBadge state={connectionState} />
          )}
          {activityLabel ? <ActivityIndicator label={activityLabel} /> : null}
          {images.length > 0 ? (
            <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] text-neutral-600 dark:border-neutral-600 dark:text-neutral-300">
              {images.length} image{images.length === 1 ? '' : 's'} attached
            </span>
          ) : null}
          {queue.length > 0 ? (
            <span className="rounded-full border border-revival-accent/50 bg-revival-accent/10 px-2 py-0.5 text-[10px] text-revival-accent flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {queue.length} queued
            </span>
          ) : null}
          {showToggle ? (
            <span
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-neutral-500 dark:text-neutral-300"
              aria-hidden
            >
              {drawerOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </span>
          ) : null}
        </button>
      ) : (
        <div className="flex w-full flex-shrink-0 items-center gap-2 border-b border-neutral-300/80 px-3 py-2 dark:border-neutral-700/80">
          <span className="font-semibold uppercase tracking-[0.06em] text-[11px] text-neutral-600 dark:text-neutral-300">
            OpenClaw
          </span>
          {showModelBadge ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] text-neutral-700 dark:border-neutral-600 dark:text-neutral-300"
              title={activeModelTooltip ?? activeModelLabel}
            >
              {activeModelLabel}
            </span>
          ) : (
            <StatusBadge state={connectionState} />
          )}
          {activityLabel ? <ActivityIndicator label={activityLabel} /> : null}
          {images.length > 0 ? (
            <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] text-neutral-600 dark:border-neutral-600 dark:text-neutral-300">
              {images.length} image{images.length === 1 ? '' : 's'} attached
            </span>
          ) : null}
          {queue.length > 0 ? (
            <span className="rounded-full border border-revival-accent/50 bg-revival-accent/10 px-2 py-0.5 text-[10px] text-revival-accent flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {queue.length} queued
            </span>
          ) : null}
        </div>
      )}

      {/* Queued messages UI */}
      {queue.length > 0 && (
        <div className="border-b border-neutral-300/50 dark:border-neutral-700/50 px-2 py-1.5 space-y-1 bg-neutral-50/50 dark:bg-neutral-800/30">
          <div className="text-[10px] text-neutral-500 dark:text-neutral-400 px-1">
            Queued messages (will send when agent finishes)
          </div>
          {queue.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-dashed border-neutral-400/50 dark:border-neutral-600 bg-neutral-100/80 dark:bg-neutral-800/50 px-2 py-1.5 text-sm"
            >
              <Clock className="h-3 w-3 text-neutral-400 flex-shrink-0" />
              <span className="flex-1 truncate text-neutral-700 dark:text-neutral-300 text-xs">
                {item.text || `[${item.attachments.length} image${item.attachments.length === 1 ? '' : 's'}]`}
              </span>
              <button
                type="button"
                onClick={() => onRemoveFromQueue(item.id)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-0.5"
                title="Remove from queue"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 p-2">
        <div className={`relative rounded-lg border bg-neutral-0/80 focus-within:ring-1 focus-within:ring-revival-accent-400/40 dark:bg-neutral-950/70 transition-all ${
          sending 
            ? 'border-revival-accent/50' 
            : 'border-neutral-300/70 dark:border-neutral-600'
        }`}>
          {/* Slash command dropdown */}
          {showDropdown && (
            <CommandDropdown
              input={input}
              onSelect={(cmd) => onInputChange(cmd)}
              onClose={() => {
                setDropdownDismissed(true);
              }}
            />
          )}
          <textarea
            ref={(node) => {
              textareaRef.current = node;
              if (typeof forwardedRef === 'function') {
                forwardedRef(node);
              } else if (forwardedRef) {
                forwardedRef.current = node;
              }
            }}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onPaste={async (event) => {
              const files = Array.from(event.clipboardData.files ?? []);
              if (files.length === 0) return;
              await onPasteFiles(files);
            }}
            onKeyDown={(event) => {
              // Don't submit if command dropdown is open (let dropdown handle Enter)
              if (event.key === 'Enter' && !event.shiftKey && !showDropdown) {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder={
              sending
                ? 'Type to queue another message...'
                : gatewayConnected
                  ? 'Message OpenClaw (Enter sends, Shift+Enter newline)...'
                  : 'Gateway offline. You can still draft here.'
            }
            className="max-h-[210px] w-full resize-none border-0 bg-transparent px-3 pb-[8px] pt-[12px] pr-12 text-sm leading-5 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-400"
          />

          <button
            type="button"
            disabled={!hasContent}
            onClick={onSubmit}
            aria-label={sending ? 'Queue message' : 'Send message'}
            title={sending ? 'Queue message (agent is working)' : 'Send message'}
            className={`absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md p-0 leading-none transition-colors disabled:opacity-50 ${
              sending
                ? 'bg-revival-accent/70 text-neutral-900 hover:bg-revival-accent/90'
                : 'bg-[#DFFF00] text-neutral-900 hover:bg-[#c8e600]'
            }`}
          >
            {sending ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </button>
        </div>

        {images.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            {images.map((image, index) => (
              <button
                type="button"
                key={image.id}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-neutral-0 px-2 py-1 text-[11px] text-neutral-700 hover:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-500"
                onClick={() => onRemoveImage(index)}
                title={`Remove ${image.name}`}
              >
                <span className="max-w-[14rem] truncate">{image.name}</span>
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : null}
        {attachmentNotice ? (
          <div className="mt-1 px-1 text-[11px] text-status-danger">{attachmentNotice}</div>
        ) : null}
      </div>
    </div>
  );
});
