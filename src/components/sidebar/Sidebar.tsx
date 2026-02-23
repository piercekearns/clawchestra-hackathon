import { useCallback, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import {
  useDashboardStore,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
} from '../../lib/store';

interface SidebarProps {
  onOpenSettings: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const sidebarWidth = useDashboardStore((s) => s.sidebarWidth);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);
  const setSidebarWidth = useDashboardStore((s) => s.setSidebarWidth);
  const isDragging = useRef(false);
  const rafHandle = useRef(0);
  const [isResizing, setIsResizing] = useState(false);
  const [isHandleHover, setIsHandleHover] = useState(false);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsResizing(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (event: MouseEvent) => {
        if (!isDragging.current) return;
        const x = event.clientX;
        cancelAnimationFrame(rafHandle.current);
        rafHandle.current = requestAnimationFrame(() => {
          if (!isDragging.current) return;
          if (x < SIDEBAR_MIN_WIDTH - 40) {
            setSidebarOpen(false);
            setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
          } else {
            setSidebarWidth(x);
          }
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
    [setSidebarOpen, setSidebarWidth],
  );

  return (
    <div
      id="sidebar"
      role="complementary"
      aria-label="Sidebar"
      className={`relative z-20 flex shrink-0 flex-col overflow-visible border-r bg-neutral-50 dark:bg-neutral-900 ${isResizing || isHandleHover ? 'border-revival-accent-500/60 dark:border-revival-accent-400/50' : 'border-neutral-200 dark:border-neutral-700'} ${isResizing ? '' : 'transition-[width] duration-200 ease-out'}`}
      style={{ width: sidebarOpen ? sidebarWidth : 0 }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* Main content area — empty for Phase 1 */}
        <div className="flex-1" />

        {/* Settings button pinned to bottom — only rendered when open to keep out of tab order */}
        {sidebarOpen && (
          <div className="border-t border-neutral-200 p-2 dark:border-neutral-700">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
          </div>
        )}
      </div>

      {/* Drag handle (right edge) — wide hit area, narrow visual indicator */}
      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          onMouseDown={handleDragStart}
          onMouseEnter={() => setIsHandleHover(true)}
          onMouseLeave={() => setIsHandleHover(false)}
          onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
          className="group absolute right-0 top-0 h-full w-[6px] translate-x-1/2 cursor-col-resize"
        >
          <div
            className={`pointer-events-none absolute left-1/2 top-1/2 h-6 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm ${isResizing ? 'bg-revival-accent-400 dark:bg-revival-accent-300' : 'bg-revival-accent-500 dark:bg-revival-accent-400'}`}
          />
        </div>
      )}
    </div>
  );
}
