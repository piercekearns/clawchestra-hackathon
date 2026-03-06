/**
 * Generate a deterministic session key from chat scope.
 * Session keys are computed at creation time and stored — this is for reference/debugging only.
 */
export function generateSessionKey(
  projectId: string,
  itemId?: string,
  chatId?: string,
): string {
  if (itemId) return `agent:main:project:${projectId}:item:${itemId}`;
  // Ad-hoc chats use their UUID for uniqueness
  if (chatId) return `agent:main:project:${projectId}:chat:${chatId}`;
  return `agent:main:project:${projectId}`;
}
