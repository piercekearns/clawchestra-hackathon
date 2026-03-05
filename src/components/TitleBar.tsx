import { useEffect } from 'react';
import { Columns2, Loader2, PanelLeft, PanelLeftClose, Rows2 } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDashboardStore } from '../lib/store';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { StatusBadge } from './StatusBadge';
import { Tooltip } from './Tooltip';
import logoChartreuse from '../assets/logo.png';
import logoDark from '../assets/logo-dark.png';

interface TitleBarProps {
  settingsMode?: boolean;
}

export function TitleBar({ settingsMode = false }: TitleBarProps) {
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);
  const layoutOrientation = useDashboardStore((s) => s.layoutOrientation);
  const setLayoutOrientation = useDashboardStore((s) => s.setLayoutOrientation);
  const { updateAvailable, updating, updateBlockedReason, updateFailureReason, handleUpdate } = useAppUpdate();
  const addBuildError = useDashboardStore((s) => s.addBuildError);
  const clearBuildErrors = useDashboardStore((s) => s.clearBuildErrors);

  // Sync update failure reason → StatusBadge build errors
  useEffect(() => {
    if (updateFailureReason) {
      addBuildError(updateFailureReason);
    } else {
      clearBuildErrors();
    }
  }, [updateFailureReason, addBuildError, clearBuildErrors]);

  const ToggleIcon = sidebarOpen ? PanelLeftClose : PanelLeft;
  const sidebarLocked = settingsMode && sidebarOpen;
  const toggleSidebar = () => {
    if (sidebarLocked) return;
    setSidebarOpen(!sidebarOpen);
  };
  const startWindowDrag = () => {
    void getCurrentWindow().startDragging().catch(() => {});
  };

  return (
    <div
      className="relative z-[90] flex h-[46px] shrink-0 items-center border-b border-neutral-200/50 bg-page px-4 dark:border-neutral-700/50 md:px-6"
      onMouseDown={startWindowDrag}
      onDoubleClick={() => void getCurrentWindow().toggleMaximize()}
    >
      <div className="flex items-center gap-2">
        {/* Left padding for macOS traffic lights (trafficLightPosition: x=22) */}
        <div className="w-[78px] shrink-0" />

        {/* Sidebar toggle */}
        <Tooltip text={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} position="below">
          <button
            type="button"
            onClick={toggleSidebar}
            disabled={sidebarLocked}
            className={`pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 ${sidebarLocked ? 'cursor-not-allowed opacity-40 hover:bg-transparent dark:hover:bg-transparent' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            aria-expanded={sidebarOpen}
            aria-controls="sidebar"
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            <ToggleIcon className="h-4 w-4" />
          </button>
        </Tooltip>

        {/* Orientation toggle */}
        <Tooltip text={layoutOrientation === 'horizontal' ? 'Stack vertically' : 'Arrange side by side'} position="below">
          <button
            type="button"
            onClick={() => setLayoutOrientation(layoutOrientation === 'horizontal' ? 'vertical' : 'horizontal')}
            onMouseDown={(e) => e.stopPropagation()}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            aria-label={layoutOrientation === 'horizontal' ? 'Stack vertically' : 'Arrange side by side'}
          >
            {layoutOrientation === 'horizontal' ? (
              <Rows2 className="h-4 w-4" />
            ) : (
              <Columns2 className="h-4 w-4" />
            )}
          </button>
        </Tooltip>
      </div>

      {/* Centered logo + title group */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 select-none items-center gap-2">
        <img
          src={logoDark}
          alt=""
          className="h-5 w-auto dark:hidden"
          aria-hidden="true"
          draggable="false"
        />
        <img
          src={logoChartreuse}
          alt=""
          className="hidden h-5 w-auto dark:block"
          aria-hidden="true"
          draggable="false"
        />
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Clawchestra
        </span>

        {/* Update badge */}
        {(updateAvailable || updating) && (
          <button
            type="button"
            onClick={() => void handleUpdate()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={updating}
            className="pointer-events-auto inline-flex items-center rounded-full bg-[#DFFF00] px-2 py-0.5 text-[11px] font-medium text-neutral-800 transition-colors hover:bg-[#e9ff4d] disabled:cursor-wait"
            title={updateBlockedReason ?? undefined}
          >
            {updating ? (
              <span className="inline-flex items-center gap-1">
                Updating
                <Loader2 className="h-3 w-3 animate-spin" />
              </span>
            ) : (
              'Update'
            )}
          </button>
        )}
        {updateBlockedReason && (
          <span className="text-[11px] text-status-danger">{updateBlockedReason}</span>
        )}
        <div className="pointer-events-auto">
          <StatusBadge />
        </div>
      </div>

      <div className="ml-auto" />
    </div>
  );
}
