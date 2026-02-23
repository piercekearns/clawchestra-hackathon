import { SettingsForm } from './SettingsForm';
import type { DashboardSettings } from '../lib/settings';

interface SettingsPageProps {
  active: boolean;
  settings: DashboardSettings | null;
  onSave: (settings: DashboardSettings) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  saveNudge?: boolean;
}

export function SettingsPage({ active, settings, onSave, onDirtyChange, saveNudge }: SettingsPageProps) {
  return (
    <div className="min-h-full w-full bg-neutral-50 px-8 py-6 dark:bg-neutral-900">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Settings
          </h1>
        </div>

        <SettingsForm
          active={active}
          settings={settings}
          onSave={onSave}
          onDirtyChange={onDirtyChange}
          saveNudge={saveNudge}
        />
      </div>
    </div>
  );
}
