import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, MessageSquare, Plus, Terminal } from 'lucide-react';
import type { HubAgentType } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { AGENT_LABELS } from '../../lib/terminal-utils';
import { AgentIcon } from './AgentIcon';

interface TypePickerMenuProps {
  onAddChat: () => void;
  onAddTerminal?: (agentType: HubAgentType) => void;
  /** External trigger position (e.g. from right-click). */
  externalMenuPos?: { top: number; left: number } | null;
  onExternalMenuClose?: () => void;
  /** Override the button element. When provided, the default + button is not rendered. */
  renderTrigger?: (toggle: (e: React.MouseEvent) => void) => React.ReactNode;
}

export function TypePickerMenu({
  onAddChat,
  onAddTerminal,
  externalMenuPos,
  onExternalMenuClose,
  renderTrigger,
}: TypePickerMenuProps) {
  const [open, setOpen] = useState(false);
  const [terminalSubmenu, setTerminalSubmenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (externalMenuPos) {
      setMenuPos(externalMenuPos);
      setOpen(true);
      setTerminalSubmenu(false);
    }
  }, [externalMenuPos]);

  const detectedAgents = useDashboardStore((s) => s.detectedAgents);
  const tmuxAvailable = detectedAgents.some((a) => a.agentType === 'tmux' && a.available);
  const codingAgents = detectedAgents.filter((a) => a.agentType !== 'tmux' && a.available);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      setTerminalSubmenu(false);
      onExternalMenuClose?.();
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      // Clamp menu within window bounds
      const menuWidth = 176;
      const menuHeight = 80; // approximate height of 2 menu items
      let top = rect.bottom + 4;
      let left = rect.right - menuWidth;
      if (top + menuHeight > window.innerHeight) top = rect.top - menuHeight - 4;
      if (left < 4) left = 4;
      if (left + menuWidth > window.innerWidth - 4) left = window.innerWidth - menuWidth - 4;
      setMenuPos({ top, left });
      setOpen(true);
      setTerminalSubmenu(false);
    }
  };

  const handleAgentSelect = (agentType: HubAgentType) => {
    setOpen(false);
    setTerminalSubmenu(false);
    onExternalMenuClose?.();
    onAddTerminal?.(agentType);
  };

  const close = () => {
    setOpen(false);
    setTerminalSubmenu(false);
    onExternalMenuClose?.();
  };

  return (
    <div className="relative">
      {renderTrigger ? (
        renderTrigger(handleToggle)
      ) : (
        <button
          type="button"
          onClick={handleToggle}
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          aria-label="New chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
      {open && menuPos && createPortal(
        <>
          <div
            className="fixed inset-0 z-[200]"
            onClick={(e) => { e.stopPropagation(); close(); }}
          />
          <div
            className="fixed z-[200] w-44 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                close();
                onAddChat();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              OpenClaw Chat
            </button>
            <div
              className="relative"
              onMouseEnter={() => setTerminalSubmenu(true)}
              onMouseLeave={() => setTerminalSubmenu(false)}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Terminal className="h-3.5 w-3.5" />
                <span>Terminal</span>
                {!tmuxAvailable ? (
                  <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400">Install tmux</span>
                ) : (
                  <ChevronRight className="ml-auto h-3 w-3 text-neutral-400" />
                )}
              </button>
              {terminalSubmenu && (
                <div className="absolute left-full top-0 z-[200] pl-1">
                  <div className="w-44 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                    {!tmuxAvailable ? (
                      <div className="px-3 py-1.5 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                        tmux is missing. Clawchestra will open a temporary terminal and offer in-app remediation.
                      </div>
                    ) : null}
                    {codingAgents.map((agent) => (
                      <button
                        key={agent.agentType}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAgentSelect(agent.agentType as HubAgentType);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        <AgentIcon agentType={agent.agentType} className="h-3.5 w-3.5 text-neutral-400" />
                        {AGENT_LABELS[agent.agentType as HubAgentType] ?? agent.command}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAgentSelect('generic');
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      <Terminal className="h-3.5 w-3.5 text-neutral-400" />
                      Shell
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
