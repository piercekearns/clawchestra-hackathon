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
 *
 * Positions entirely in integer pixels (no CSS percentage transforms)
 * to avoid sub-pixel blur on varying tooltip widths.
 */
export function Tooltip({ text, children, className }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ cx: number; top: number } | null>(null);
  const [offset, setOffset] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setAnchor({ cx: rect.left + rect.width / 2, top: rect.top });
  }, []);

  const hide = useCallback(() => {
    setAnchor(null);
    setOffset(null);
  }, []);

  // Once the tooltip renders, measure it and compute pixel-perfect position
  const measureTooltip = useCallback(
    (el: HTMLSpanElement | null) => {
      (tooltipRef as React.MutableRefObject<HTMLSpanElement | null>).current = el;
      if (!el || !anchor) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setOffset({
        left: Math.round(anchor.cx - w / 2),
        top: Math.round(anchor.top - h - 6),
      });
    },
    [anchor],
  );

  return (
    <>
      <span
        ref={triggerRef}
        className={className ?? 'inline-flex'}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {anchor
        ? createPortal(
            <span
              ref={measureTooltip}
              role="tooltip"
              className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md border border-neutral-600 bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-100 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              style={
                offset
                  ? { left: offset.left, top: offset.top }
                  : { left: Math.round(anchor.cx), top: Math.round(anchor.top) - 6, opacity: 0 }
              }
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
