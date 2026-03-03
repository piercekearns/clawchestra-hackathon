import type { HubChat, HubRow, HubThread } from './hub-types';

/** Group non-archived chats in a thread into HubRows by (projectId, itemId). */
export function buildRows(thread: HubThread, roadmapItemMap: Map<string, string>): HubRow[] {
  const nonArchived = thread.chats.filter((c) => !c.archived);
  const groups = new Map<string, HubChat[]>();

  for (const chat of nonArchived) {
    const key = chat.itemId ?? '__project__';
    const existing = groups.get(key);
    if (existing) {
      existing.push(chat);
    } else {
      groups.set(key, [chat]);
    }
  }

  const rows: HubRow[] = [];
  for (const [key, tabs] of groups) {
    const itemId = key === '__project__' ? null : key;
    const isProjectSurface = itemId === null;

    let title: string;
    if (isProjectSurface) {
      title = thread.projectTitle;
    } else {
      title = roadmapItemMap.get(itemId!) ?? tabs[0]?.title ?? 'Untitled';
    }

    // Sort tabs: by sortOrder, then creation time
    const sortedTabs = [...tabs].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
    );

    rows.push({
      projectId: thread.projectId,
      itemId,
      title,
      tabs: sortedTabs,
      isProjectSurface,
    });
  }

  // Order: project surface first, then pinned rows, then by lastActivity desc
  rows.sort((a, b) => {
    if (a.isProjectSurface !== b.isProjectSurface) return a.isProjectSurface ? -1 : 1;
    const aPinned = a.tabs.some((t) => t.pinned);
    const bPinned = b.tabs.some((t) => t.pinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    const aMax = Math.max(...a.tabs.map((t) => t.lastActivity));
    const bMax = Math.max(...b.tabs.map((t) => t.lastActivity));
    return bMax - aMax;
  });

  return rows;
}
