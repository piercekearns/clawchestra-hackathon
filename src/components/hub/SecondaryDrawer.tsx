import { useCallback, useMemo, useRef, useState } from 'react';
import type { HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { DrawerHeader } from './DrawerHeader';
import { ScopedChatShell } from './ScopedChatShell';

const MIN_WIDTH = 280;
const MAX_WIDTH = 800;

interface SecondaryDrawerProps {
  chatId: string;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onToast?: (kind: 'success' | 'error', message: string, action?: { label: string; onClick: () => void }) => void;
  onOpenLinkedItem?: (projectId: string, projectTitle: string, itemId: string) => void;
}

export function SecondaryDrawer({
  chatId,
  width,
  onWidthChange,
  onClose,
  onToast,
  onOpenLinkedItem,
}: SecondaryDrawerProps) {
  const hubChats = useDashboardStore((s) => s.hubChats);
  const projects = useDashboardStore((s) => s.projects);

  const chat = hubChats.find((c) => c.id === chatId);
  const isDragging = useRef(false);
  const rafHandle = useRef(0);
  const [isResizing, setIsResizing] = useState(false);
  const [isHandleHover, setIsHandleHover] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Resolve project title
  const projectTitle = useMemo(() => {
    if (!chat) return '';
    const findTitle = (ps: typeof projects): string | undefined => {
      for (const p of ps) {
        if (p.id === chat.projectId) return p.frontmatter?.title ?? p.id;
        if (p.children) {
          const found = findTitle(p.children);
          if (found) return found;
        }
      }
      return undefined;
    };
    return findTitle(projects) ?? chat.projectId;
  }, [chat, projects]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsResizing(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const drawerLeft = drawerRef.current?.getBoundingClientRect().left ?? 0;

      const onMouseMove = (event: MouseEvent) => {
        if (!isDragging.current) return;
        cancelAnimationFrame(rafHandle.current);
        rafHandle.current = requestAnimationFrame(() => {
          if (!isDragging.current) return;
          const newWidth = event.clientX - drawerLeft;
          onWidthChange(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)));
        });
      };

      const onMouseUp = () => {
        isDragging.current = false;
        cancelAnimationFrame(rafHandle.current);
        setIsResizing(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [onWidthChange],
  );

  if (!chat) return null;

  return (
    <div
      ref={drawerRef}
      className={`relative z-[60] flex shrink-0 flex-col overflow-visible border-r ${
        isResizing
          ? 'border-[#9fbf00] dark:border-[#9fbf00]'
          : isHandleHover
            ? 'border-[#8ca800] dark:border-[#8ca800]'
            : 'border-neutral-200 dark:border-neutral-700'
      } ${isResizing ? '' : 'transition-[border-color] duration-200 ease-out'}`}
      style={{ width, willChange: 'transform' }}
    >
      <div className="flex h-full flex-col overflow-hidden pb-4 md:pb-6">
        <DrawerHeader
          chat={chat}
          projectTitle={projectTitle}
          onClose={onClose}
          onToast={onToast}
          onOpenLinkedItem={onOpenLinkedItem}
        />
        <ScopedChatShell chat={chat} />
      </div>

      {/* Drag handle on right edge — z-[70] to stay above modal overlays (z-50) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        onMouseDown={handleDragStart}
        onMouseEnter={() => setIsHandleHover(true)}
        onMouseLeave={() => setIsHandleHover(false)}
        onDoubleClick={() => onWidthChange(400)}
        className="group absolute right-0 top-0 z-[70] h-full w-[6px] translate-x-1/2 cursor-col-resize [will-change:transform]"
      >
        <div
          className={`pointer-events-none absolute left-1/2 top-1/2 h-6 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm ${
            isResizing ? 'bg-[#DFFF00]' : 'bg-[#a7c400]'
          }`}
        />
      </div>
    </div>
  );
}
