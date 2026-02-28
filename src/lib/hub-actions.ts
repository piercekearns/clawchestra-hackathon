import { useDashboardStore } from './store';
import { hubChatCreate, hubChatList } from './tauri';
import type { HubChat, HubAgentType } from './hub-types';
import { AGENT_LABELS } from './terminal-utils';

/**
 * Open or create a project-level chat thread, then navigate the hub UI to it.
 */
export async function openOrCreateProjectChat(
  projectId: string,
  projectTitle: string,
): Promise<void> {
  const store = useDashboardStore.getState();
  let chats = store.hubChats.filter(
    (c) => c.projectId === projectId && !c.archived,
  );

  if (chats.length === 0) {
    const newChat = await hubChatCreate(projectId, null, 'openclaw', null, projectTitle, true);
    await store.refreshHubChats();
    chats = [newChat];
  }

  // Prefer the project root chat, fallback to first
  const target = chats.find((c) => c.isProjectRoot) ?? chats[0];
  store.setHubActiveChatId(target.id);
  store.setHubDrawerOpen(true);
  // Expand the thread if collapsed
  const collapsed = store.hubCollapsedThreads;
  if (collapsed.includes(projectId)) {
    store.toggleHubThread(projectId);
  }
}

/**
 * Open or create an item-level chat within a project thread, then navigate.
 */
export async function openOrCreateItemChat(
  projectId: string,
  projectTitle: string,
  itemId: string,
  itemTitle: string,
): Promise<void> {
  const store = useDashboardStore.getState();

  // Ensure project has at least a thread (project-level chat)
  const projectChats = store.hubChats.filter(
    (c) => c.projectId === projectId && !c.archived,
  );
  if (projectChats.length === 0) {
    await hubChatCreate(projectId, null, 'openclaw', null, projectTitle, true);
  }

  // Find or create item-level chat
  let itemChat = store.hubChats.find(
    (c) => c.projectId === projectId && c.itemId === itemId && !c.archived,
  );
  if (!itemChat) {
    itemChat = await hubChatCreate(projectId, itemId, 'openclaw', null, itemTitle);
  }

  await store.refreshHubChats();

  store.setHubActiveChatId(itemChat.id);
  store.setHubDrawerOpen(true);
  // Expand the thread if collapsed
  const collapsed = store.hubCollapsedThreads;
  if (collapsed.includes(projectId)) {
    store.toggleHubThread(projectId);
  }
}

/**
 * Check how many unread chats exist for a specific project (for card badges).
 */
export function getProjectUnreadCount(projectId: string): number {
  const chats = useDashboardStore.getState().hubChats;
  return chats.filter(
    (c) => c.projectId === projectId && c.unread && !c.archived,
  ).length;
}

/**
 * Check if a project has any hub chats (for filled/unfilled icon state).
 * Accepts the reactive hubChats array to ensure re-renders on changes.
 */
export function projectHasThread(hubChats: HubChat[], projectId: string): boolean {
  return hubChats.some((c) => c.projectId === projectId && !c.archived);
}

/**
 * Check if a specific roadmap item has a hub chat.
 * Accepts the reactive hubChats array to ensure re-renders on changes.
 */
export function itemHasChat(hubChats: HubChat[], projectId: string, itemId: string): boolean {
  return hubChats.some(
    (c) => c.projectId === projectId && c.itemId === itemId && !c.archived,
  );
}

/**
 * Get unread count for a specific item's chat.
 */
export function getItemUnreadCount(projectId: string, itemId: string): number {
  const chats = useDashboardStore.getState().hubChats;
  return chats.filter(
    (c) => c.projectId === projectId && c.itemId === itemId && c.unread && !c.archived,
  ).length;
}

/**
 * Open or create a terminal chat for a project, then navigate the hub UI to it.
 */
export async function openOrCreateTerminal(
  projectId: string,
  agentType: HubAgentType,
): Promise<void> {
  const store = useDashboardStore.getState();
  const label = AGENT_LABELS[agentType] ?? agentType;
  const title = agentType === 'generic' ? 'Terminal' : label;

  const newChat = await hubChatCreate(projectId, null, 'terminal', agentType, title);
  await store.refreshHubChats();

  // Optimistically mark as active so TerminalShell spawns immediately
  // (the poll would otherwise see it as "dead" since tmux session doesn't exist yet)
  const updated = new Set(store.activeTerminalChatIds);
  updated.add(newChat.id);
  store.setActiveTerminalChatIds(updated);

  store.setHubActiveChatId(newChat.id);
  store.setHubDrawerOpen(true);

  // Auto-expand drawer for terminal
  if (store.hubDrawerWidth < 640) {
    store.setHubDrawerWidth(640);
  }

  // Expand the thread if collapsed
  if (store.hubCollapsedThreads.includes(projectId)) {
    store.toggleHubThread(projectId);
  }
}
