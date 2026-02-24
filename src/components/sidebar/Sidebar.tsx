import { useCallback, useRef, useState, type ComponentType } from 'react';
import { ArrowLeft, ArrowRight, Monitor, Moon, Settings, Sun } from 'lucide-react';
import type { ThemePreference } from '../../lib/schema';
import {
  useDashboardStore,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
} from '../../lib/store';

interface SidebarProps {
  side: 'left' | 'right';
  mode?: 'default' | 'settings';
  onOpenSettings: () => void;
  onBack?: () => void;
  elevated?: boolean;
}

export function Sidebar({ side, mode = 'default', onOpenSettings, onBack, elevated = false }: SidebarProps) {
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const sidebarWidth = useDashboardStore((s) => s.sidebarWidth);
  const themePreference = useDashboardStore((s) => s.themePreference);
  const setThemePreference = useDashboardStore((s) => s.setThemePreference);
  const setSidebarWidth = useDashboardStore((s) => s.setSidebarWidth);
  const isDragging = useRef(false);
  const rafHandle = useRef(0);
  const [isResizing, setIsResizing] = useState(false);
  const [isHandleHover, setIsHandleHover] = useState(false);
  const isRight = side === 'right';
  const isSettingsMode = mode === 'settings';
  const BackIcon = isRight ? ArrowRight : ArrowLeft;

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
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
          const width = isRight ? viewportWidth - x : x;
          setSidebarWidth(width);
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
    [setSidebarWidth],
  );

  return (
    <div
      id="sidebar"
      role="complementary"
      aria-label="Sidebar"
      className={`relative ${elevated ? 'z-[70]' : 'z-20'} flex shrink-0 flex-col overflow-visible ${isRight ? 'border-l' : 'border-r'} ${isResizing || isHandleHover ? 'border-revival-accent-600/70 dark:border-revival-accent-400/50' : 'border-neutral-200 dark:border-neutral-700'} ${isResizing ? '' : 'transition-[width] duration-200 ease-out'}`}
      style={{ width: sidebarOpen ? sidebarWidth : 0 }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* Settings back button */}
        {sidebarOpen && isSettingsMode && onBack && (
          <div className="border-b border-neutral-200 p-2 dark:border-neutral-700">
            <button
              type="button"
              onClick={onBack}
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-100 ${isRight ? 'justify-end' : 'justify-start'} w-full`}
            >
              {!isRight && <BackIcon className="h-4 w-4" />}
              <span>Back to Clawchestra</span>
              {isRight && <BackIcon className="h-4 w-4" />}
            </button>
          </div>
        )}

        {/* Theme toggle pinned to top */}
        {sidebarOpen && !isSettingsMode && (
          <div className="border-b border-neutral-200 p-2 dark:border-neutral-700">
            <div
              className={`pointer-events-auto flex ${isRight ? 'justify-end' : 'justify-start'}`}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="inline-flex rounded-md border border-neutral-300 p-0.5 dark:border-neutral-600">
                <ThemeButton
                  pref="light"
                  current={themePreference}
                  onClick={setThemePreference}
                  icon={Sun}
                  label="Light theme"
                />
                <ThemeButton
                  pref="dark"
                  current={themePreference}
                  onClick={setThemePreference}
                  icon={Moon}
                  label="Dark theme"
                />
                <ThemeButton
                  pref="system"
                  current={themePreference}
                  onClick={setThemePreference}
                  icon={Monitor}
                  label="System theme"
                />
              </div>
            </div>
          </div>
        )}

        {/* Main content area — empty for Phase 1 */}
        <div className="flex-1" />

        {/* Settings button pinned to bottom — only rendered when open to keep out of tab order */}
        {sidebarOpen && !isSettingsMode && (
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

      {/* Drag handle (edge) — wide hit area, narrow visual indicator */}
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
          className={`group absolute top-0 h-full w-[6px] cursor-col-resize ${isRight ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'}`}
        >
          <div
            className={`pointer-events-none absolute left-1/2 top-1/2 h-6 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm ${isResizing ? 'bg-revival-accent-500 dark:bg-revival-accent-300' : 'bg-revival-accent-600 dark:bg-revival-accent-400'}`}
          />
        </div>
      )}
    </div>
  );
}

function ThemeButton({
  pref,
  current,
  onClick,
  icon: Icon,
  label,
}: {
  pref: ThemePreference;
  current: ThemePreference;
  onClick: (pref: ThemePreference) => void;
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`rounded p-1 ${pref === current ? 'bg-neutral-200 dark:bg-neutral-700' : ''}`}
      onClick={() => onClick(pref)}
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
