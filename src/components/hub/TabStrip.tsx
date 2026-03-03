import { useCallback, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MessageSquare, Plus, X } from 'lucide-react';
import type { HubAgentType, HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import type { TerminalActivityEntry } from '../../lib/store';
import { hubChatUpdate } from '../../lib/tauri';
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
  isSelected: boolean,
): 1 | 2 | 3 | 4 {
  // Don't show activity indicators on the selected tab — user can see the content directly
  if (isSelected) return 4;
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
  const refreshHubChats = useDashboardStore((s) => s.refreshHubChats);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      // Recompute sortOrder for all tabs based on new positions
      const reordered = [...tabs];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].sortOrder !== i) {
          await hubChatUpdate(reordered[i].id, { sortOrder: i });
        }
      }
      await refreshHubChats();
    },
    [tabs, refreshHubChats],
  );

  const tabIds = tabs.map((t) => t.id);

  return (
    <div className="flex items-center border-b border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900/80 px-1.5 py-1">
      {/* Scrollable tab + button area — button flows inline after tabs */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          <div
            ref={scrollRef}
            className="flex items-center gap-0.5 overflow-x-auto scrollbar-none"
          >
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const label = getTabLabel(tab, tabs);
              const activity = getTabActivity(tab, terminalActivity, busyChatIds, isActive);

              return (
                <SortableTabItem
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

            {/* + button — inline right after the last tab */}
            <div className="shrink-0 px-0.5">
              <TypePickerMenu
                onAddChat={onAddChat}
                onAddTerminal={onAddTerminal}
                renderTrigger={(toggle) => (
                  <button
                    type="button"
                    onClick={toggle}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                    aria-label="New tab"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              />
            </div>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableTabItem(props: {
  chat: HubChat;
  label: string;
  activity: 1 | 2 | 3 | 4;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.chat.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-50 z-10' : ''} {...attributes} {...listeners}>
      <TabItem {...props} />
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
      className={`group/tab relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
        isActive
          ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100'
          : 'text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-200'
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
