import type { HubChat } from '../../lib/hub-types';
import { useScopedChatSession } from '../../hooks/useScopedChatSession';
import { MessageList } from '../chat/MessageList';
import { ChatBar } from '../chat/ChatBar';

interface ScopedChatShellProps {
  chat: HubChat;
}

export function ScopedChatShell({ chat }: ScopedChatShellProps) {
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
