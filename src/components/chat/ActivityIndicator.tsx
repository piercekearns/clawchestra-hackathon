interface ActivityIndicatorProps {
  label: string;
  isCompacting?: boolean;
}

export function ActivityIndicator({ label, isCompacting }: ActivityIndicatorProps) {
  // Remove trailing ... from label, we'll animate it separately
  const baseLabel = label.replace(/\.{2,}$/, '');
  const hasDots = label !== baseLabel;

  return (
    <span className="inline-flex items-center text-xs">
      {/* Text with animated color pulse — blue during compaction */}
      <span className={
        isCompacting
          ? 'animate-[textPulseBlue_2s_ease-in-out_infinite] text-blue-500 dark:text-blue-400'
          : 'animate-[textPulse_2s_ease-in-out_infinite] text-neutral-500 dark:text-neutral-400'
      }>
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
