import { useCallback, useEffect, useRef, useState } from 'react';
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

export function TabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddChat,
  onAddTerminal,
}: TabStripProps) {
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
    <div className="flex items-center border-b border-neutral-200 dark:border-neutral-700 px-1.5 py-1.5 md:px-3.5">
      {/* Scrollable tab + button area — button flows inline after tabs */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          <div
            ref={scrollRef}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
          >
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const label = getTabLabel(tab, tabs);

              return (
                <SortableTabItem
                  key={tab.id}
                  chat={tab}
                  label={label}
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
    <div
      ref={setNodeRef}
      style={{ ...style, flex: '1 1 220px', minWidth: 80, maxWidth: 260 }}
      className={isDragging ? 'opacity-50 z-10' : ''}
      {...attributes}
      {...listeners}
    >
      <TabItem {...props} />
    </div>
  );
}

function TabItem({
  chat,
  label,
  isActive,
  onSelect,
  onClose,
}: {
  chat: HubChat;
  label: string;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const activity = useDashboardStore((s) => s.terminalActivity[chat.id]);
  const busyChatIds = useDashboardStore((s) => s.hubBusyChatIds);
  const activeTerminals = useDashboardStore((s) => s.activeTerminalChatIds);
  const terminalStatusReady = useDashboardStore((s) => s.terminalStatusReady);

  const isDeadTerminal = terminalStatusReady && chat.type === 'terminal' && !chat.archived && !activeTerminals.has(chat.id);

  // Raw terminal activity states (same derivation as ChatEntryRow)
  const isTerminalActive = chat.type === 'terminal' && !isDeadTerminal && !!activity?.isActive;
  const isTerminalActionRequired = chat.type === 'terminal' && !isDeadTerminal && !!activity?.actionRequired;
  // Unread only when NOT active — active output is in-progress, not "unread"
  const isTerminalUnread = chat.type === 'terminal' && !isDeadTerminal && !isTerminalActive
    && !!activity && activity.lastOutputAt > activity.lastViewedAt;

  // busyChatIds tracks openclaw AI-responding; isTerminalActive tracks terminal output.
  // The debounce (200ms enter, 3s cooldown) already filters brief typing echoes,
  // so no need to suppress on the selected tab — matches old ChatEntryRow behaviour.
  const effectiveActive = busyChatIds.has(chat.id) || isTerminalActive;

  // Debounced active dots — 200ms enter delay, 500ms exit delay.
  // Re-entry cooldown: after dots disappear, require 3s before re-showing
  // to filter post-response flicker (e.g. tab-suggestion rendering).
  // During cooldown, badges stay visible (inCooldown prevents suppression).
  const [showActiveDots, setShowActiveDots] = useState(false);
  const [inCooldown, setInCooldown] = useState(false);
  const lastDotsExitRef = useRef(0);
  useEffect(() => {
    if (!effectiveActive) {
      setInCooldown(false);
      const timer = setTimeout(() => {
        setShowActiveDots(false);
        lastDotsExitRef.current = Date.now();
      }, 500);
      return () => clearTimeout(timer);
    }
    const sinceLastExit = Date.now() - lastDotsExitRef.current;
    if (sinceLastExit < 3000 && lastDotsExitRef.current > 0) {
      setInCooldown(true);
      const timer = setTimeout(() => {
        setShowActiveDots(true);
        setInCooldown(false);
      }, 3000 - sinceLastExit);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setShowActiveDots(true), 200);
    return () => clearTimeout(timer);
  }, [effectiveActive]);

  // For openclaw chats, busy = dots
  const isOpenclawBusy = chat.type === 'openclaw' && busyChatIds.has(chat.id);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group/tab relative flex w-full min-w-0 items-center gap-1.5 rounded-md px-2.5 py-[6px] text-xs transition-colors ${
        isActive
          ? 'bg-neutral-50 text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100'
          : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200'
      }`}
    >
      {/* Tab icon — matches ChatEntryRow activity logic exactly */}
      <TabIcon
        chat={chat}
        showActiveDots={showActiveDots}
        isOpenclawBusy={isOpenclawBusy}
        inCooldown={inCooldown}
        isTerminalActive={isTerminalActive}
        isTerminalActionRequired={isTerminalActionRequired}
        isTerminalUnread={isTerminalUnread}
      />

      {/* Label */}
      <span className="min-w-0 truncate">{label}</span>

      {/* Close button — visible on hover */}
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 group-hover/tab:opacity-100 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-opacity"
        aria-label="Close tab"
      >
        <X className="h-3 w-3" />
      </span>
    </button>
  );
}

function TabIcon({
  chat,
  showActiveDots,
  isOpenclawBusy,
  inCooldown,
  isTerminalActive,
  isTerminalActionRequired,
  isTerminalUnread,
}: {
  chat: HubChat;
  showActiveDots: boolean;
  isOpenclawBusy: boolean;
  inCooldown: boolean;
  isTerminalActive: boolean;
  isTerminalActionRequired: boolean;
  isTerminalUnread: boolean;
}) {
  const dots = (
    <span className="shrink-0 text-[10px] font-bold leading-none text-revival-accent-400">
      <span className="loading-dots"><span>.</span><span>.</span><span>.</span></span>
    </span>
  );

  // Openclaw busy → dots
  if (isOpenclawBusy) return dots;

  if (chat.type === 'terminal') {
    const icon = <AgentIcon agentType={chat.agentType} className="h-3 w-3" />;

    // Action-required always shows immediately — highest priority, overrides dots
    if (isTerminalActionRequired) {
      return (
        <span className="relative shrink-0">
          {icon}
          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
        </span>
      );
    }

    // Debounced active dots
    if (showActiveDots) return dots;

    // When dots aren't showing: show unread badge if not about to show dots
    // (inCooldown || !isTerminalActive) means dots won't appear imminently
    if ((inCooldown || !isTerminalActive) && (isTerminalUnread || chat.unread)) {
      return (
        <span className="relative shrink-0">
          {icon}
          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#DFFF00]" />
        </span>
      );
    }
    return <span className="shrink-0">{icon}</span>;
  }

  // Openclaw — default icon with optional unread badge
  const icon = <MessageSquare className="h-3 w-3" />;
  if (chat.unread) {
    return (
      <span className="relative shrink-0">
        {icon}
        <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#DFFF00]" />
      </span>
    );
  }
  return <span className="shrink-0">{icon}</span>;
}
