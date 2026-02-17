import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import type { ChatMessage } from '../../lib/gateway';
import { cn } from '../../lib/utils';
import { MessageBubble } from './MessageBubble';
import { SystemBubble } from './SystemBubble';

interface MessageListProps {
  messages: ChatMessage[];
  className?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

export const MessageList = forwardRef<HTMLDivElement, MessageListProps>(function MessageList({ 
  messages, 
  className, 
  hasMore, 
  loadingMore, 
  onLoadMore 
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Expose the scroll container to parent via ref
  useImperativeHandle(ref, () => containerRef.current!, []);
  const [userScrolled, setUserScrolled] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const prevMessagesRef = useRef<{ length: number; firstTimestamp?: number }>({ 
    length: messages.length,
    firstTimestamp: messages[0]?.timestamp,
  });
  const wasLoadingMoreRef = useRef(false);
  const scrollHeightBeforeLoadRef = useRef(0);
  const wasAtBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastProgrammaticScrollTime = useRef(0); // Timestamp of last programmatic scroll
  const lastDistanceFromBottomRef = useRef(0); // Track distance from bottom for resize handling

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    
    // Ignore scroll events caused by programmatic scrolling (within 100ms)
    if (Date.now() - lastProgrammaticScrollTime.current < 100) {
      return;
    }
    
    const isNearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
    setUserScrolled(!isNearBottom);
    
    // Clear new messages indicator when user scrolls to bottom
    if (isNearBottom && hasNewMessages) {
      setHasNewMessages(false);
    }
    
    // Track scroll state for resize handling
    wasAtBottomRef.current = isNearBottom;
    lastScrollTopRef.current = node.scrollTop;
    lastDistanceFromBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight;
    
    // Load more when scrolled near top
    const isNearTop = node.scrollTop < 100;
    if (isNearTop && hasMore && !loadingMore && onLoadMore) {
      // Store scroll height before loading so we can preserve position
      scrollHeightBeforeLoadRef.current = node.scrollHeight;
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore, hasNewMessages]);

  // Track when loading starts
  useEffect(() => {
    if (loadingMore && !wasLoadingMoreRef.current) {
      // Loading just started - capture scroll height
      const node = containerRef.current;
      if (node) {
        scrollHeightBeforeLoadRef.current = node.scrollHeight;
      }
    }
    wasLoadingMoreRef.current = !!loadingMore;
  }, [loadingMore]);

  // Note: Removed complex ResizeObserver - relying on CSS scroll-anchor instead

  // Handle scroll position when messages change
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    
    const prev = prevMessagesRef.current;
    const messagesAdded = messages.length > prev.length;
    const firstTimestampChanged = messages[0]?.timestamp !== prev.firstTimestamp;
    
    // Update ref for next comparison
    prevMessagesRef.current = {
      length: messages.length,
      firstTimestamp: messages[0]?.timestamp,
    };
    
    if (!messagesAdded) return;
    
    // If first message timestamp changed, older messages were prepended → preserve scroll position
    if (firstTimestampChanged && scrollHeightBeforeLoadRef.current > 0) {
      const heightDiff = node.scrollHeight - scrollHeightBeforeLoadRef.current;
      node.scrollTop = node.scrollTop + heightDiff;
      scrollHeightBeforeLoadRef.current = 0;
      return;
    }
    
    // New messages added at bottom
    if (!userScrolled) {
      // User is at bottom → scroll to show new message
      lastProgrammaticScrollTime.current = Date.now();
      node.scrollTop = node.scrollHeight;
    } else {
      // User has scrolled up → show indicator for assistant + important system messages
      const latestMessage = messages[messages.length - 1];
      if (
        latestMessage?.role === 'assistant' ||
        (latestMessage?.role === 'system' &&
          latestMessage.systemMeta &&
          ['failure', 'completion', 'compaction', 'decision'].includes(latestMessage.systemMeta.kind))
      ) {
        setHasNewMessages(true);
      }
    }
  }, [messages, userScrolled]);

  // Initial scroll to bottom
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    lastProgrammaticScrollTime.current = Date.now();
    node.scrollTop = node.scrollHeight;
  }, []);

  const scrollToBottom = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    setHasNewMessages(false);
    setUserScrolled(false);
  }, []);

  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <div 
        ref={containerRef} 
        className="absolute inset-0 space-y-2 overflow-y-auto p-3"
        onScroll={handleScroll}
      >
      {/* Loading indicator at top */}
      {loadingMore && (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
          <span className="ml-2 text-xs text-neutral-400">Loading older messages...</span>
        </div>
      )}
      
      {/* Load more indicator */}
      {hasMore && !loadingMore && messages.length > 0 && (
        <div className="flex items-center justify-center py-2">
          <span className="text-xs text-neutral-500">↑ Scroll up to load more</span>
        </div>
      )}

      {messages.length === 0 && !loadingMore ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          Ask OpenClaw to update statuses, priorities, or roadmap items.
        </p>
      ) : null}

      {messages.map((message, index) => {
        if (message.role === 'system' && message.systemMeta) {
          return (
            <SystemBubble
              key={message._id ?? `${message.timestamp ?? index}-system-${message.systemMeta.kind}`}
              meta={message.systemMeta}
              content={message.content}
              timestamp={message.timestamp}
            />
          );
        }

        return (
          <MessageBubble
            key={message._id ?? `${message.timestamp ?? index}-${message.role}-${message.content.slice(0, 20)}`}
            message={message}
          />
        );
      })}
      {/* Scroll anchor - browser will try to keep this in view */}
      <div id="scroll-anchor" style={{ overflowAnchor: 'auto', height: 1 }} />
      </div>

      {/* New messages indicator */}
      {hasNewMessages && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-0 right-0 z-20 mx-auto w-fit flex items-center gap-1.5 rounded-full bg-[#DFFF00] px-3 py-1.5 text-xs font-medium text-neutral-900 shadow-xl transition-all hover:bg-[#e9ff4d] animate-[bounce_0.5s_ease-out_1]"
        >
          <ArrowDown className="h-3 w-3" />
          New messages
        </button>
      )}
    </div>
  );
});
