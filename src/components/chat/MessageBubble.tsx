import { useState, useCallback, type ComponentPropsWithoutRef } from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../../lib/gateway';
import { stripOpenClawEnvelope } from '../../lib/chat-normalization';
import { cn } from '../../lib/utils';

interface MessageBubbleProps {
  message: ChatMessage;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ── Tiny copy button ─────────────────────────────────────────────── */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-all',
        'hover:bg-neutral-200/80 hover:text-neutral-600 dark:hover:bg-neutral-700/80 dark:hover:text-neutral-300',
        copied && 'text-green-500 dark:text-green-400',
        className,
      )}
      title={copied ? 'Copied' : 'Copy'}
      aria-label={copied ? 'Copied' : 'Copy'}
    >
      {copied ? <Check className="h-3.5 w-3.5" strokeLinejoin="miter" strokeLinecap="square" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/* ── Code block with copy button ──────────────────────────────────── */
function CodeBlock({ children, className: langClass, ...rest }: ComponentPropsWithoutRef<'code'>) {
  // Inline code (no language class, not inside <pre>)
  const isBlock = typeof langClass === 'string' && langClass.startsWith('language-');
  const text = extractText(children);

  if (!isBlock) {
    return (
      <code className={langClass} {...rest}>
        {children}
      </code>
    );
  }

  return (
    <div className="group/code relative">
      <code className={langClass} {...rest}>
        {children}
      </code>
      <CopyButton
        text={text}
        className="absolute right-2 top-2 opacity-0 group-hover/code:opacity-100 focus:opacity-100"
      />
    </div>
  );
}

/** Recursively extract text from React children. */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

/* ── MessageBubble ────────────────────────────────────────────────── */
export function MessageBubble({ message }: MessageBubbleProps) {
  const role = message.role;
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';
  const roleLabel = isUser ? 'You' : isAssistant ? 'Clawdbot' : 'System';
  const displayContent = isUser ? stripOpenClawEnvelope(message.content) : message.content;

  return (
    <div
      className={cn(
        'group/msg flex flex-col',
        isUser ? 'items-end' : 'items-start',
      )}
    >
      {/* Message bubble */}
      <article
        className={cn(
          'relative max-w-[75%] rounded-lg border px-3 py-2 shadow-sm',
          isUser
            ? 'border-revival-accent-400/40 bg-revival-accent-100 text-neutral-900 dark:bg-revival-accent-900/30 dark:text-neutral-100'
            : isAssistant
              ? 'border-neutral-300/80 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'
              : 'border-neutral-300/80 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
        )}
      >
        {/* Copy whole message - appears on hover */}
        <CopyButton
          text={displayContent}
          className="absolute right-1.5 top-1.5 opacity-0 group-hover/msg:opacity-100 focus:opacity-100"
        />

        <div className="prose max-w-none break-words pr-6 text-sm leading-relaxed dark:prose-invert prose-p:my-2 prose-pre:my-3 prose-pre:rounded-md prose-pre:bg-neutral-800 prose-pre:px-3 prose-pre:py-2.5 prose-pre:text-[13px] prose-pre:leading-normal prose-pre:text-neutral-100 prose-code:rounded prose-code:bg-neutral-200 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-table:my-3 prose-table:text-[13px] prose-th:border prose-th:border-neutral-300 prose-th:bg-neutral-100 prose-th:px-2.5 prose-th:py-1.5 prose-td:border prose-td:border-neutral-300 prose-td:px-2.5 prose-td:py-1.5 dark:prose-code:bg-neutral-700 dark:prose-pre:bg-neutral-800 dark:prose-th:border-neutral-600 dark:prose-th:bg-neutral-800 dark:prose-td:border-neutral-600 prose-hr:my-3">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              code: CodeBlock,
            }}
          >
            {displayContent}
          </ReactMarkdown>
        </div>
      </article>

      {/* Label + time below the bubble */}
      <footer
        className={cn(
          'mt-1 flex items-center gap-1.5 text-[10px] text-neutral-400 dark:text-neutral-500',
          isUser ? 'pr-1' : 'pl-1',
        )}
      >
        <span className="font-medium">{roleLabel}</span>
        {message.timestamp ? (
          <>
            <span>·</span>
            <span>{formatTime(message.timestamp)}</span>
          </>
        ) : null}
      </footer>
    </div>
  );
}
