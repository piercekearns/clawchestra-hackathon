import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface ScrollRevealTextProps {
  text: string;
  className?: string;
}

/**
 * A text label that truncates with ellipsis and smoothly scrolls to reveal
 * the full text on hover.
 */
export function ScrollRevealText({ text, className }: ScrollRevealTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  const measure = useCallback(() => {
    if (!containerRef.current || !textRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const textWidth = textRef.current.scrollWidth;
    setOverflowPx(Math.max(0, textWidth - containerWidth));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [text, measure]);

  // Re-measure when container resizes (e.g. hover padding changes)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const hasOverflow = overflowPx > 0;
  // Scale duration: ~40px/sec, min 1s, max 4s
  const duration = hasOverflow ? Math.min(4, Math.max(1, overflowPx / 40)) : 0;

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden ${className ?? ''}`}
    >
      <span
        ref={textRef}
        className="scroll-reveal-text inline-block whitespace-nowrap"
        style={hasOverflow ? {
          '--overflow-distance': `-${overflowPx}px`,
          '--scroll-duration': `${duration}s`,
        } as React.CSSProperties : undefined}
      >
        {text}
      </span>
    </div>
  );
}
