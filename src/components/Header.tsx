import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Moon, RefreshCcw, Settings, Sun, SunMoon } from 'lucide-react';
import { flushSync } from 'react-dom';
import { Input } from './ui/input';
import type { ThemePreference } from '../lib/schema';
import { ErrorBadge } from './ErrorBadge';
import type { DashboardError } from '../lib/errors';
import { Button } from './ui/button';
import { isTauriRuntime, checkForUpdate, runAppUpdate } from '../lib/tauri';
import logoChartreuse from '../assets/logo.png';
import logoDark from '../assets/logo-dark.png';

interface HeaderProps {
  errors: DashboardError[];
  onRefresh: () => Promise<void>;
  onAddProject: () => void;
  onOpenSettings: () => void;
  themePreference: ThemePreference;
  onChangeTheme: (pref: ThemePreference) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  statusOptions: Array<{ id: string; label: string }>;
}

export function Header({
  errors,
  onRefresh,
  onAddProject,
  onOpenSettings,
  themePreference,
  onChangeTheme,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  statusOptions,
}: HeaderProps) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateTriggeredRef = useRef(false);

  // Check for updates on mount and every 30 seconds
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const check = async () => {
      try {
        const status = await checkForUpdate();
        setUpdateAvailable(status.update_available);
      } catch {
        // Silently fail - don't show button if we can't check
      }
    };

    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleUpdate = async () => {
    if (!isTauriRuntime() || updating || updateTriggeredRef.current) return;
    updateTriggeredRef.current = true;
    // Force immediate visual transition to "Updating..." before invoking Tauri.
    flushSync(() => {
      setUpdating(true);
    });
    // Give the browser one frame to paint the updated button state.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    try {
      await runAppUpdate(); // Build runs in background, app stays open until done
    } catch (error) {
      console.error('Failed to start update:', error);
      updateTriggeredRef.current = false;
      setUpdating(false);
    }
  };

  return (
    <header className="sticky top-0 z-20 mb-4 rounded-2xl border border-neutral-200 bg-neutral-0/95 p-4 backdrop-blur dark:border-neutral-700 dark:bg-neutral-950/95">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src={logoDark}
            alt=""
            className="h-7 w-auto dark:hidden"
            aria-hidden="true"
          />
          <img
            src={logoChartreuse}
            alt=""
            className="hidden h-7 w-auto dark:block"
            aria-hidden="true"
          />
          <h1 className="text-2xl italic text-neutral-950 dark:text-neutral-100" style={{ fontFamily: "'Geist Pixel Circle', sans-serif" }}>
            Clawchestra
          </h1>
          {(updateAvailable || updating) && (
            <button
              type="button"
              onClick={() => {
                void handleUpdate();
              }}
              disabled={updating}
              className="inline-flex items-center rounded-full bg-[#DFFF00] px-2.5 py-0.5 text-xs font-medium text-neutral-800 transition-colors hover:bg-[#e9ff4d] disabled:cursor-wait"
            >
              {updating ? (
                <span className="inline-flex items-center gap-1">
                  Updating
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                </span>
              ) : (
                'Update'
              )}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ErrorBadge errors={errors} />

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRefresh()}
            className="inline-flex items-center gap-1"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>

          <Button type="button" size="sm" onClick={onAddProject}>
            Add Project
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenSettings}
            aria-label="Open settings"
            title="Settings"
            className="h-9 w-9 rounded-lg p-0"
          >
            <Settings className="h-4 w-4" />
          </Button>

          <div className="inline-flex rounded-lg border border-neutral-300 p-1 dark:border-neutral-600">
            <button
              type="button"
              className={`rounded-md p-1.5 ${themePreference === 'light' ? 'bg-neutral-200 dark:bg-neutral-700' : ''}`}
              onClick={() => onChangeTheme('light')}
              aria-label="Light theme"
            >
              <Sun className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`rounded-md p-1.5 ${themePreference === 'dark' ? 'bg-neutral-200 dark:bg-neutral-700' : ''}`}
              onClick={() => onChangeTheme('dark')}
              aria-label="Dark theme"
            >
              <Moon className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`rounded-md p-1.5 ${themePreference === 'system' ? 'bg-neutral-200 dark:bg-neutral-700' : ''}`}
              onClick={() => onChangeTheme('system')}
              aria-label="System theme"
            >
              <SunMoon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_max-content]">
        <div className="relative">
          <Input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search by title, id, tag, next action..."
            className="pr-14"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 select-none rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-neutral-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            ⌘ + K
          </kbd>
        </div>
        <div className="relative md:justify-self-end">
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
            className="h-10 w-full appearance-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 pr-9 text-sm text-neutral-800 shadow-none outline-none transition-colors hover:border-neutral-400 focus:border-revival-accent-400 focus:ring-2 focus:ring-revival-accent-400/40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500 md:w-fit md:min-w-0"
          >
            <option value="all">All statuses</option>
            {statusOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        </div>
      </div>
    </header>
  );
}
