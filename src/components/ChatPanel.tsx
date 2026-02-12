import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { ChatMessage } from '../lib/gateway';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

interface ChatPanelProps {
  messages: ChatMessage[];
  gatewayConnected: boolean;
  onSend: (message: string) => Promise<void>;
  showComposer?: boolean;
}

export function ChatPanel({
  messages,
  gatewayConnected,
  onSend,
  showComposer = true,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
        <div>
          <h2 className="text-sm font-semibold">OpenClaw</h2>
          <p className="text-xs text-neutral-500">Embedded assistant</p>
        </div>
        <Badge variant={gatewayConnected ? 'success' : 'danger'}>
          {gatewayConnected ? 'Connected' : 'Disconnected'}
        </Badge>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            Ask OpenClaw to update project statuses, priorities, or roadmap items.
          </p>
        ) : null}

        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`rounded-lg px-3 py-2 text-sm ${
              message.role === 'user'
                ? 'ml-6 bg-revival-accent-400 text-neutral-900'
                : message.role === 'assistant'
                  ? 'mr-6 bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100'
                  : 'bg-neutral-100 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
          >
            {message.content}
          </div>
        ))}
      </div>

      {showComposer ? (
        <form
          className="border-t border-neutral-200 p-3 dark:border-neutral-700"
          onSubmit={async (event) => {
            event.preventDefault();
            const message = input.trim();
            if (!message || sending || !gatewayConnected) return;

            setSending(true);
            try {
              await onSend(message);
              setInput('');
            } finally {
              setSending(false);
            }
          }}
        >
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={gatewayConnected ? 'Ask OpenClaw...' : 'Gateway disconnected'}
              className="h-20 flex-1 resize-none"
              disabled={!gatewayConnected || sending}
            />
            <Button
              type="submit"
              disabled={!gatewayConnected || sending || !input.trim()}
              className="inline-flex h-20 w-12 items-center justify-center px-0"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      ) : null}
    </aside>
  );
}
