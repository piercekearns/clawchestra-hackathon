import { SettingsForm } from './SettingsForm';
import type { DashboardSettings } from '../lib/settings';

interface SettingsPageProps {
  active: boolean;
  settings: DashboardSettings | null;
  onSave: (settings: DashboardSettings) => Promise<void>;
}

export function SettingsPage({ active, settings, onSave }: SettingsPageProps) {
  return (
    <div className="w-full">
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
        />
      </div>
    </div>
  );
}
