import { MessageSquare, Terminal } from 'lucide-react';
import type { HubAgentType, HubChatType } from '../../lib/hub-types';

interface ChatTypeIconProps {
  type: HubChatType;
  agentType?: HubAgentType | null;
  className?: string;
}

export function ChatTypeIcon({ type, agentType, className = 'h-3.5 w-3.5' }: ChatTypeIconProps) {
  if (type === 'terminal') {
    return <Terminal className={className} />;
  }
  return <MessageSquare className={className} />;
}
