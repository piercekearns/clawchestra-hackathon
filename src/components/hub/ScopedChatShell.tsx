import { useEffect } from 'react';
import type { HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { hasTerminalSpawnGrace } from '../../lib/terminal-activity';
import { useScopedChatSession } from '../../hooks/useScopedChatSession';
import { MessageList } from '../chat/MessageList';
import { ChatBar } from '../chat/ChatBar';
import { TerminalShell } from './TerminalShell';

interface ScopedChatShellProps {
  chat: HubChat;
  onTerminalFocusChange?: (focused: boolean) => void;
  onTerminalDragActiveChange?: (active: boolean) => void;
  /** Incrementing key to force TerminalShell remount (for restart). */
  terminalRestartKey?: number;
}

export function ScopedChatShell({ chat, onTerminalFocusChange, onTerminalDragActiveChange, terminalRestartKey = 0 }: ScopedChatShellProps) {
  const activeTerminals = useDashboardStore((s) => s.activeTerminalChatIds);
  const terminalStatusReady = useDashboardStore((s) => s.terminalStatusReady);

  // Mark terminal as viewed when its pane mounts (clears unread + action-required)
  useEffect(() => {
    if (chat.type === 'terminal') {
      useDashboardStore.getState().markTerminalViewed(chat.id);
    }
  }, [chat.id, chat.type]);

  if (chat.type === 'terminal') {
    // Dead terminal + no restart requested → show placeholder, don't auto-spawn.
    // A terminal created in the last 60s is never "dead" — its tmux session
    // may not exist yet (TerminalShell creates it on mount). Use the DB
    // timestamp (reliable) plus the in-memory spawn grace (fast fallback).
    const isRecentlyCreated = Date.now() - chat.createdAt < 60_000;
    const isDead = terminalStatusReady && !chat.archived && !activeTerminals.has(chat.id) && !isRecentlyCreated && !hasTerminalSpawnGrace(chat.id);
    if (isDead && terminalRestartKey === 0) {
      return (
        <div className="flex flex-1 items-center justify-center min-h-0">
          <p className="text-sm text-neutral-500">Session ended — use Restart above to relaunch</p>
        </div>
      );
    }
    return <TerminalShell key={`terminal-${chat.id}-${terminalRestartKey}`} chat={chat} onFocusChange={onTerminalFocusChange} onDragActiveChange={onTerminalDragActiveChange} />;
  }
  return <OpenClawChatShell chat={chat} />;
}

function OpenClawChatShell({ chat }: { chat: HubChat }) {
  const session = useScopedChatSession({ chat });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Messages */}
      <div className="relative min-h-0 flex-1 flex flex-col">
        {session.messages.length === 0 && !session.streamingContent ? (
          <div className="absolute inset-0 flex items-center justify-center px-4">
            <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
              {session.contextLoaded ? (
                <>
                  Start a conversation about{' '}
                  <span className="font-medium text-neutral-500 dark:text-neutral-400">
                    {chat.title}
                  </span>
                </>
              ) : (
                'Loading context...'
              )}
            </p>
          </div>
        ) : (
          <MessageList
            messages={session.displayMessages}
            showReadingIndicator={session.sending && !session.streamingContent}
            scrollPadding="px-4 py-3 md:px-6"
          />
        )}
      </div>

      {/* Input bar — floating variant renders its own rounded border/shadow */}
      <div className="shrink-0 px-4 pb-4 md:px-6 md:pb-6">
      <ChatBar
        connectionState={session.wsConnectionState}
        activityLabel={session.sending ? 'Working...' : null}
        drawerOpen={false}
        variant="floating"
        showToggle={false}
        input={session.input}
        sending={session.sending}
        dragActive={session.dragActive}
        images={[]}
        gatewayConnected={session.gatewayConnected}
        queue={[]}
        activeModelLabel={session.modelLabel}
        activeModelTooltip={session.modelTooltip}
        activeModelUsage={session.modelUsage}
        onInputChange={session.setInput}
        onToggleDrawer={() => {}}
        onSubmit={() => void session.handleSend()}
        onRemoveImage={() => {}}
        onRemoveFromQueue={() => {}}
        onRetryQueuedMessage={() => {}}
        onPasteFiles={async () => {}}
        onDropFiles={async () => {}}
        onDragStateChange={session.setDragActive}
      />
      </div>
    </div>
  );
}
