import { useRef } from 'react';
import { MessageSquare, Plus, X } from 'lucide-react';
import type { HubAgentType, HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import type { TerminalActivityEntry } from '../../lib/store';
import { AGENT_LABELS } from '../../lib/terminal-utils';
import { AgentIcon } from './AgentIcon';
import { TypePickerMenu } from './TypePickerMenu';

interface TabStripProps {
  tabs: HubChat[];
  activeTabId: string;
  onSelectTab: (chatId: string) => void;
  onCloseTab: (chatId: string) => void;
  onAddChat: () => void;
  onAddTerminal: (agentType: HubAgentType) => void;
}

/** Get display label for a tab, with auto-numbering for duplicates. */
function getTabLabel(chat: HubChat, allTabs: HubChat[]): string {
  const baseLabel = chat.type === 'openclaw'
    ? 'Chat'
    : (AGENT_LABELS[chat.agentType!] ?? 'Terminal');

  const sameType = allTabs.filter((t) =>
    t.type === chat.type && t.agentType === chat.agentType,
  );
  if (sameType.length <= 1) return baseLabel;

  const sorted = [...sameType].sort((a, b) => a.createdAt - b.createdAt);
  const index = sorted.findIndex((t) => t.id === chat.id);
  return index === 0 ? baseLabel : `${baseLabel} ${index + 1}`;
}

/** Get per-tab activity: 1=action-required, 2=unread, 3=active, 4=idle */
function getTabActivity(
  chat: HubChat,
  terminalActivity: Record<string, TerminalActivityEntry>,
  busyChatIds: Set<string>,
): 1 | 2 | 3 | 4 {
  if (chat.type === 'terminal') {
    const a = terminalActivity[chat.id];
    if (a?.actionRequired) return 1;
    if (a && a.lastOutputAt > a.lastViewedAt) return 2;
    if (a?.isActive || busyChatIds.has(chat.id)) return 3;
  } else {
    if (busyChatIds.has(chat.id)) return 3;
    if (chat.unread) return 2;
  }
  return 4;
}

export function TabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddChat,
  onAddTerminal,
}: TabStripProps) {
  const terminalActivity = useDashboardStore((s) => s.terminalActivity);
  const busyChatIds = useDashboardStore((s) => s.hubBusyChatIds);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-center border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50">
      {/* Scrollable tab area */}
      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto scrollbar-none"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const label = getTabLabel(tab, tabs);
          const activity = getTabActivity(tab, terminalActivity, busyChatIds);

          return (
            <TabItem
              key={tab.id}
              chat={tab}
              label={label}
              activity={activity}
              isActive={isActive}
              onSelect={() => onSelectTab(tab.id)}
              onClose={() => onCloseTab(tab.id)}
            />
          );
        })}
      </div>

      {/* + button */}
      <div className="shrink-0 px-1">
        <TypePickerMenu
          onAddChat={onAddChat}
          onAddTerminal={onAddTerminal}
          renderTrigger={(toggle) => (
            <button
              type="button"
              onClick={toggle}
              className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
              aria-label="New tab"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        />
      </div>
    </div>
  );
}

function TabItem({
  chat,
  label,
  activity,
  isActive,
  onSelect,
  onClose,
}: {
  chat: HubChat;
  label: string;
  activity: 1 | 2 | 3 | 4;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group/tab relative flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
        isActive
          ? 'bg-white text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 border-b-2 border-revival-accent-400'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 border-b-2 border-transparent'
      }`}
    >
      {/* Tab icon with activity overlay */}
      <TabIcon chat={chat} activity={activity} />

      {/* Label */}
      <span className="max-w-[120px] truncate">{label}</span>

      {/* Close button — visible on hover */}
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 group-hover/tab:opacity-100 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-opacity"
        aria-label="Close tab"
      >
        <X className="h-3 w-3" />
      </span>
    </button>
  );
}

function TabIcon({ chat, activity }: { chat: HubChat; activity: 1 | 2 | 3 | 4 }) {
  // Activity states override the icon
  if (activity === 1) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />;
  }
  if (activity === 3) {
    return (
      <span className="flex shrink-0 items-center gap-[1.5px]">
        <span className="h-[3px] w-[3px] rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:0ms]" />
        <span className="h-[3px] w-[3px] rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:150ms]" />
        <span className="h-[3px] w-[3px] rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:300ms]" />
      </span>
    );
  }

  // Default type icon
  const icon = chat.type === 'terminal'
    ? <AgentIcon agentType={chat.agentType} className="h-3 w-3" />
    : <MessageSquare className="h-3 w-3" />;

  // Unread indicator as dot overlay
  if (activity === 2) {
    return (
      <span className="relative shrink-0">
        {icon}
        <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#DFFF00]" />
      </span>
    );
  }

  return <span className="shrink-0">{icon}</span>;
}
