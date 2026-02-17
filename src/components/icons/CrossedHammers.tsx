import type { SVGProps } from 'react';

/** Custom crossed-hammers icon used for formal build workflow actions. */
export function CrossedHammers(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.5 4.5 5 8l2.5 2.5L11 7z" />
      <path d="M15.5 4.5 19 8l-2.5 2.5L13 7z" />
      <path d="m7.5 10.5 9 9" />
      <path d="m16.5 10.5-9 9" />
    </svg>
  );
}
