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
  isProjectRoot: boolean;
}

export interface HubThread {
  projectId: string;
  projectTitle: string;
  chats: HubChat[];
}

/** A row groups HubChats sharing the same (projectId, itemId) — rendered as one sidebar entry with tabs. */
export interface HubRow {
  projectId: string;
  itemId: string | null;
  title: string;
  tabs: HubChat[];
  isProjectSurface: boolean;
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
