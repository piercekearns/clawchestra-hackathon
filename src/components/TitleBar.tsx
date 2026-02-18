import { Loader2, Moon, PanelLeft, PanelLeftClose, Sun, SunMoon } from 'lucide-react';
import { useDashboardStore } from '../lib/store';
import { useAppUpdate } from '../hooks/useAppUpdate';
import type { ThemePreference } from '../lib/schema';
import logoChartreuse from '../assets/logo.png';
import logoDark from '../assets/logo-dark.png';

export function TitleBar() {
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);
  const themePreference = useDashboardStore((s) => s.themePreference);
  const setThemePreference = useDashboardStore((s) => s.setThemePreference);
  const { updateAvailable, updating, handleUpdate } = useAppUpdate();

  const ToggleIcon = sidebarOpen ? PanelLeftClose : PanelLeft;

  return (
    <div
      data-tauri-drag-region
      className="flex h-[38px] shrink-0 items-center gap-2 bg-page px-2"
    >
      {/* Left padding for macOS traffic lights */}
      <div className="w-[70px] shrink-0" data-tauri-drag-region />

      {/* Sidebar toggle */}
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
        aria-label="Toggle sidebar"
      >
        <ToggleIcon className="h-4 w-4" />
      </button>

      {/* Logo */}
      <img
        src={logoDark}
        alt=""
        className="h-5 w-auto dark:hidden"
        aria-hidden="true"
      />
      <img
        src={logoChartreuse}
        alt=""
        className="hidden h-5 w-auto dark:block"
        aria-hidden="true"
      />

      {/* App title */}
      <span className="pointer-events-none select-none text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Clawchestra
      </span>

      {/* Update badge */}
      {(updateAvailable || updating) && (
        <button
          type="button"
          onClick={() => void handleUpdate()}
          disabled={updating}
          className="pointer-events-auto inline-flex items-center rounded-full bg-[#DFFF00] px-2 py-0.5 text-[11px] font-medium text-neutral-800 transition-colors hover:bg-[#e9ff4d] disabled:cursor-wait"
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

      {/* Spacer */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Theme toggle */}
      <div className="pointer-events-auto inline-flex rounded-md border border-neutral-300 p-0.5 dark:border-neutral-600">
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
          icon={SunMoon}
          label="System theme"
        />
      </div>
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
  icon: React.ComponentType<{ className?: string }>;
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
