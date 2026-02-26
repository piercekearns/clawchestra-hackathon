# Completion Confetti 🎉

> When a roadmap item is marked complete, a brief burst of confetti rains down over the board. Because shipping deserves a moment.

**Status:** Draft
**Created:** 2026-02-26
**Roadmap Item:** `completion-confetti`

---

## Problem

Completing a roadmap item currently produces:

1. Card moves to the Complete column
2. That's it

You shipped something. The app just stares at you. This is a crime.

## What Success Looks Like

- Marking an item complete triggers a **confetti burst** originating from the card's position on screen
- Lasts ~2 seconds, then clears — doesn't block interaction
- Subtle enough not to be annoying on the 10th use, satisfying enough to still feel good on the 100th
- Respects `prefers-reduced-motion` — no confetti for users who've opted out of animations

---

## Implementation

### Library

[`canvas-confetti`](https://github.com/catdad/canvas-confetti) — 3KB, zero dependencies, battle-tested.

```bash
pnpm add canvas-confetti
pnpm add -D @types/canvas-confetti
```

### Trigger Point

Fired from wherever `updateRoadmapItemStatus(itemId, 'complete')` is called — both from the status dropdown inside the item modal and (once Phase 1 of `roadmap-card-hover-actions` ships) from the `CircleCheckBig` hover button on the card.

### Confetti Config

```ts
import confetti from 'canvas-confetti';

export function fireCompletionConfetti(originEl?: HTMLElement) {
  const origin = originEl
    ? {
        x: (originEl.getBoundingClientRect().left + originEl.offsetWidth / 2) / window.innerWidth,
        y: (originEl.getBoundingClientRect().top + originEl.offsetHeight / 2) / window.innerHeight,
      }
    : { x: 0.5, y: 0.5 };

  // Respect reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  confetti({
    particleCount: 80,
    spread: 70,
    origin,
    colors: ['#DFFF00', '#ffffff', '#a3e635', '#fbbf24'],
    disableForReducedMotion: true,
  });
}
```

`#DFFF00` is in the palette because of course it is.

### Integration

```tsx
// In RoadmapItemList or wherever the status change fires:
const cardRef = useRef<HTMLDivElement>(null);

const handleComplete = (itemId: string) => {
  updateRoadmapItemStatus(itemId, 'complete');
  fireCompletionConfetti(cardRef.current ?? undefined);
};
```

---

## Stretch Goals

- **Different intensities**: P1 item completion gets more confetti than P5
- **Sound**: a tiny celebratory click (opt-in, off by default, lives in Settings)
- **Streak counter**: "3 items completed today 🔥" toast after the third completion in a session

---

## What It Is Not

- Not a full animation system
- Not blocking or modal
- Not persistent state
- Not enabled during the archive action (archiving is a quiet operation)

---

## Ship Criteria

- [ ] `canvas-confetti` installed
- [ ] `fireCompletionConfetti` utility written and exported
- [ ] Called on status → `complete` transition
- [ ] `prefers-reduced-motion` respected
- [ ] No layout shift, no z-index conflicts with modals
