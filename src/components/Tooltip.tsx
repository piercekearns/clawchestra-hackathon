import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  /** Text shown in the tooltip */
  text: string;
  /** The element that triggers the tooltip on hover/focus */
  children: ReactNode;
  /** Extra classes on the wrapper span */
  className?: string;
}

/**
 * Shared portal-based tooltip. Renders above the trigger element,
 * centered horizontally. Uses a portal to `document.body` so it's
 * never clipped by overflow containers.
 */
export function Tooltip({ text, children, className }: TooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const hide = useCallback(() => setPos(null), []);

  return (
    <>
      <span
        ref={ref}
        className={className ?? 'inline-flex'}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {pos
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[9999] -translate-x-1/2 whitespace-nowrap rounded-md border border-neutral-600 bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-100 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              style={{ left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)' }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
