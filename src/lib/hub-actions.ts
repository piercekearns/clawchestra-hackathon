import { useDashboardStore } from './store';
import { hubChatCreate, hubChatList } from './tauri';
import type { HubChat } from './hub-types';

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
    const newChat = await hubChatCreate(projectId, null, 'openclaw', null, projectTitle);
    await store.refreshHubChats();
    chats = [newChat];
  }

  // Prefer the project-level chat (no itemId), fallback to first
  const target = chats.find((c) => !c.itemId) ?? chats[0];
  store.setSidebarMode('default');
  store.setSidebarOpen(true);
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
    await hubChatCreate(projectId, null, 'openclaw', null, projectTitle);
  }

  // Find or create item-level chat
  let itemChat = store.hubChats.find(
    (c) => c.projectId === projectId && c.itemId === itemId && !c.archived,
  );
  if (!itemChat) {
    itemChat = await hubChatCreate(projectId, itemId, 'openclaw', null, itemTitle);
  }

  await store.refreshHubChats();

  store.setSidebarMode('default');
  store.setSidebarOpen(true);
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
 */
export function projectHasThread(projectId: string): boolean {
  const chats = useDashboardStore.getState().hubChats;
  return chats.some((c) => c.projectId === projectId && !c.archived);
}

/**
 * Check if a specific roadmap item has a hub chat.
 */
export function itemHasChat(projectId: string, itemId: string): boolean {
  const chats = useDashboardStore.getState().hubChats;
  return chats.some(
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
