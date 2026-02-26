import type { UsageSnapshot } from './gateway';

export type HubChatType = 'openclaw' | 'terminal';

export type HubAgentType = 'claude-code' | 'codex' | 'cursor' | 'opencode' | 'generic';

export interface HubChatModelState {
  label: string | null;
  tooltip: string | null;
  usage: UsageSnapshot | null;
}

export interface HubChat {
  id: string;
  projectId: string;
  itemId: string | null;
  type: HubChatType;
  agentType: HubAgentType | null;
  title: string;
  sessionKey: string | null;
  pinned: boolean;
  unread: boolean;
  sortOrder: number;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  archived: boolean;
}

export interface HubThread {
  projectId: string;
  projectTitle: string;
  chats: HubChat[];
}

export interface HubChatUpdate {
  title?: string;
  pinned?: boolean;
  unread?: boolean;
  archived?: boolean;
  sortOrder?: number;
  lastActivity?: number;
  messageCount?: number;
}
