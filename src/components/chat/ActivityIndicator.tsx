interface ActivityIndicatorProps {
  label: string;
}

export function ActivityIndicator({ label }: ActivityIndicatorProps) {
  // Remove trailing ... from label, we'll animate it separately
  const baseLabel = label.replace(/\.{2,}$/, '');
  const hasDots = label !== baseLabel;
  
  return (
    <span className="inline-flex items-center text-xs">
      {/* Text with animated color pulse */}
      <span className="animate-[textPulse_2s_ease-in-out_infinite] text-neutral-500 dark:text-neutral-400">
        {baseLabel}
        {hasDots && (
          <span className="loading-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        )}
      </span>
    </span>
  );
}
