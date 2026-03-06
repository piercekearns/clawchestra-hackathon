import { useEffect } from 'react';
import { ModalDragZone } from './ui/ModalDragZone';
import { Button } from './ui/button';
import type { DashboardSettings } from '../lib/settings';
import { SettingsForm } from './SettingsForm';

interface SettingsDialogProps {
  open: boolean;
  settings: DashboardSettings | null;
  onClose: () => void;
  onSave: (settings: DashboardSettings) => Promise<void>;
}

export function SettingsDialog({ open, settings, onClose, onSave }: SettingsDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm">
      <ModalDragZone />
      <div className="w-full max-w-2xl rounded-2xl border border-neutral-200 bg-neutral-0 p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Dashboard Settings</h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <SettingsForm
          active={open}
          settings={settings}
          onSave={onSave}
          onCancel={onClose}
          onSaved={onClose}
        />
      </div>
    </div>
  );
}
