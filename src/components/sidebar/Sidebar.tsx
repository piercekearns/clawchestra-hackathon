import { useCallback, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Monitor, Moon, Palette, Settings, Sun } from 'lucide-react';
import type { ThemePreference } from '../../lib/schema';
import {
  useDashboardStore,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
} from '../../lib/store';
import { HubNav } from '../hub/HubNav';

interface SidebarAction {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  badgeCount?: number;
  iconClassName?: string;
}

interface SidebarProps {
  side: 'left' | 'right';
  mode?: 'default' | 'settings';
  onOpenSettings: () => void;
  onBack?: () => void;
  elevated?: boolean;
  actions?: SidebarAction[];
  onToast?: (kind: 'success' | 'error', message: string, action?: { label: string; onClick: () => void }) => void;
}

export function Sidebar({
  side,
  mode = 'default',
  onOpenSettings,
  onBack,
  elevated = false,
  actions = [],
  onToast,
}: SidebarProps) {
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
      className={`relative ${elevated ? 'z-[70]' : 'z-20'} flex shrink-0 flex-col overflow-visible ${isRight ? 'border-l' : 'border-r'} ${isResizing ? 'border-[#9fbf00] dark:border-[#9fbf00]' : isHandleHover ? 'border-[#8ca800] dark:border-[#8ca800]' : sidebarOpen ? 'border-neutral-200 dark:border-neutral-700' : 'border-transparent'} ${isResizing ? '' : 'transition-[width,border-color] duration-200 ease-out'}`}
      style={{ width: sidebarOpen ? sidebarWidth : 0 }}
    >
      <div className={`flex h-full flex-col overflow-hidden ${sidebarOpen ? '' : 'pointer-events-none'}`} style={{ width: sidebarWidth }}>
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

        {/* Quick Actions heading + buttons */}
        {sidebarOpen && !isSettingsMode && actions.length > 0 && (
          <div className={`flex flex-col gap-0.5 px-2 pb-2 pt-4 ${isRight ? 'items-end' : 'items-start'}`}>
            <div className="px-3 pb-2 pt-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                Quick Actions
              </span>
            </div>
            {actions.map((action) => {
              const Icon = action.icon;
              const iconEl = (
                <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  <Icon className={action.iconClassName ?? 'h-4 w-4'} />
                  {action.badgeCount && action.badgeCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#DFFF00] px-0.5 text-[9px] font-semibold text-neutral-900">
                      {action.badgeCount}
                    </span>
                  ) : null}
                </span>
              );
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700 ${
                    isRight ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {isRight ? (
                    <>
                      <span className="min-w-0 truncate text-right">{action.label}</span>
                      {iconEl}
                    </>
                  ) : (
                    <>
                      {iconEl}
                      <span className="min-w-0 truncate">{action.label}</span>
                    </>
                  )}
                </button>
              );
            })}
            <ThemeQuickAction
              themePreference={themePreference}
              onSetTheme={setThemePreference}
              isRight={isRight}
            />
          </div>
        )}

        {/* Thread list — fills remaining space below actions */}
        {sidebarOpen && !isSettingsMode && (
          <HubNav onToast={onToast} />
        )}

        {/* Flex spacer for settings mode */}
        {isSettingsMode && <div className="flex-1" />}

        {/* Settings button */}
        {sidebarOpen && !isSettingsMode && (
          <div className="px-2 pb-[calc(0.5rem+9px)]">
            <button
              type="button"
              onClick={onOpenSettings}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700 ${isRight ? 'justify-end' : 'justify-start'}`}
            >
              {!isRight && <Settings className="h-4 w-4" />}
              Settings
              {isRight && <Settings className="h-4 w-4" />}
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
            className={`pointer-events-none absolute left-1/2 top-1/2 h-6 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-sm transition-colors duration-150 ${
              isResizing
                ? 'border-[#DFFF00] bg-[#DFFF00]'
                : isHandleHover
                  ? 'border-[#a7c400] bg-[#a7c400]'
                  : 'border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900'
            }`}
          />
        </div>
      )}
    </div>
  );
}

const THEME_OPTIONS: { pref: ThemePreference; icon: ComponentType<{ className?: string }>; label: string }[] = [
  { pref: 'light', icon: Sun, label: 'Light' },
  { pref: 'dark', icon: Moon, label: 'Dark' },
  { pref: 'system', icon: Monitor, label: 'System' },
];

function ThemeQuickAction({
  themePreference,
  onSetTheme,
  isRight,
}: {
  themePreference: ThemePreference;
  onSetTheme: (pref: ThemePreference) => void;
  isRight: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPos({ top: rect.top, left: isRight ? rect.left - 148 : rect.right + 8 });
      setOpen(true);
    }
  };

  const iconEl = (
    <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
      <Palette className="h-4 w-4" />
    </span>
  );

  return (
    <>
      <button
        type="button"
        onClick={handleToggle}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700 ${
          isRight ? 'justify-end' : 'justify-start'
        }`}
      >
        {isRight ? (
          <>
            <span className="min-w-0 truncate text-right">Theme</span>
            {iconEl}
          </>
        ) : (
          <>
            {iconEl}
            <span className="min-w-0 truncate">Theme</span>
          </>
        )}
      </button>
      {open && menuPos && createPortal(
        <>
          <div
            className="fixed inset-0 z-[200]"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed z-[200] w-36 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {THEME_OPTIONS.map(({ pref, icon: Icon, label }) => (
              <button
                key={pref}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetTheme(pref);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  pref === themePreference
                    ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100'
                    : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
