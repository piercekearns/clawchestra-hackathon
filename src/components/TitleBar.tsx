import { Loader2, PanelLeft, PanelLeftClose } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDashboardStore } from '../lib/store';
import { useAppUpdate } from '../hooks/useAppUpdate';
import logoChartreuse from '../assets/logo.png';
import logoDark from '../assets/logo-dark.png';

export function TitleBar() {
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const sidebarSide = useDashboardStore((s) => s.sidebarSide);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);
  const setSidebarSide = useDashboardStore((s) => s.setSidebarSide);
  const { updateAvailable, updating, updateBlockedReason, handleUpdate } = useAppUpdate();

  const leftOpen = sidebarOpen && sidebarSide === 'left';
  const rightOpen = sidebarOpen && sidebarSide === 'right';
  const LeftToggleIcon = leftOpen ? PanelLeftClose : PanelLeft;
  const RightToggleIcon = rightOpen ? PanelLeftClose : PanelLeft;
  const toggleSidebar = (side: 'left' | 'right') => {
    if (sidebarOpen && sidebarSide === side) {
      setSidebarOpen(false);
      return;
    }
    setSidebarSide(side);
    setSidebarOpen(true);
  };
  const startWindowDrag = () => {
    void getCurrentWindow().startDragging().catch(() => {});
  };

  return (
    <div
      className="relative z-50 flex h-[46px] shrink-0 items-center border-b border-neutral-200/50 bg-page px-4 dark:border-neutral-700/50 md:px-6"
      onMouseDown={startWindowDrag}
    >
      {/* Left padding for macOS traffic lights (trafficLightPosition: x=22) */}
      <div className="w-[78px] shrink-0" />

      {/* Left sidebar toggle */}
      <button
        type="button"
        onClick={() => toggleSidebar('left')}
        className={`pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 ${leftOpen ? 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={leftOpen}
        aria-controls="sidebar"
        aria-label="Toggle left sidebar"
      >
        <LeftToggleIcon className="h-4 w-4" />
      </button>

      {/* Spacer — pushes logo+title to center */}
      <div className="flex-1" />

      {/* Centered logo + title group */}
      <div className="pointer-events-none flex select-none items-center gap-2">
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
      </div>

      {/* Spacer — pushes right toggle to the edge */}
      <div className="flex-1" />

      {/* Right sidebar toggle */}
      <button
        type="button"
        onClick={() => toggleSidebar('right')}
        className={`pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 ${rightOpen ? 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={rightOpen}
        aria-controls="sidebar"
        aria-label="Toggle right sidebar"
      >
        <RightToggleIcon className="h-4 w-4 -scale-x-100" />
      </button>
    </div>
  );
}
