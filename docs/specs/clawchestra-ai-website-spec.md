# Clawchestra.ai Website — Spec (Discovery Phase)

> Document current decisions, constraints, reconnaissance findings, and pre-plan execution gates before writing a true implementation plan.

## Summary

This discovery brief captures where the Clawchestra.ai website initiative stands after spec review and dependency analysis. It locks the brand and launch posture that are already clear, records technical reconnaissance from reference sites, and defines pre-plan steps: first a constrained visual exploration phase (multiple static variants), then implementation planning after direction selection and prerequisite closure.

The goal is to avoid premature full builds while still moving quickly: produce high-quality direction candidates under fixed constraints, choose a winner, then write a production implementation plan with minimal rework.

---

**Roadmap Item:** `clawchestra-ai-website`  
**Spec:** `docs/specs/clawchestra-ai-website-spec.md`  
**Status:** Draft  
**Created:** 2026-02-20

---

## 1. Current State Snapshot

### What is already defined

1. Website intent and core sections are specified in the website spec.
2. Strong visual direction is already preferred (dither texture, lobster motif, revival yellow + black contrast).
3. Domain ownership is confirmed (`clawchestra.ai`).
4. Website item is pending and blocked by reconnaissance + launch/distribution prerequisites.
5. FFR Phase 5 now has a thin static install/download surface in `website/` that should be reused rather than replaced when the broader site is built.

### What was missing before this brief

1. No implementation plan document for the website item.
2. No explicit variant-generation workflow for trying multiple polished directions before full build.
3. No lock on launch posture language for "friend-first" distribution.
4. No explicit stack recommendation tied to reference-site evidence.

---

## 2. Constraints Locked Now

These are treated as fixed constraints for exploration and implementation unless explicitly changed.

### Brand and color system

1. Primary palette:
   - `#DFFF00` (revival yellow)
   - near-black
   - white
   - neutral greys
2. The lobster motif remains central to hero composition.
3. Yellow/black inversion is allowed (dark-primary or inverse-primary), but palette family stays constant.

### Typography constraints

1. Theme families to use for varianting are based on roadmap direction:
   - Standard
   - Terminal
   - Geist
2. Current app baseline fonts are:
   - `Space Grotesk` for UI
   - `IBM Plex Mono` for mono/code contexts
3. Variant exploration should map each concept to one font-theme package to avoid random mixing.

### UX and messaging constraints

1. CTA hierarchy remains:
   - primary: install / get access
   - secondary: GitHub
2. No dead links or fake install pathways.
3. If install is not public yet, page language must explicitly present invite/private alpha + waitlist.

---

## 3. Launch Posture Decision (Locked)

Initial launch posture:

1. **Friend-first private alpha** for actual installs.
2. **Public marketing + waitlist** website.
3. **No public install claim** until distribution artifacts are real and verifiable.

Operational implication:

1. Friend install path is private GitHub collaborator access + source-build docs.
2. Public users get product story + proof + waitlist CTA.

## 3a. Relationship To First Friend Readiness

The website item and FFR Phase 5 overlap, but they should not be collapsed into one vague bucket.

1. `first-friend-readiness` owns install/distribution correctness:
   - release artifacts
   - OS-aware routing
   - install instructions
   - update/download truth
2. `clawchestra-ai-website` owns the broader public site:
   - marketing narrative
   - visual design direction
   - waitlist/private-alpha posture
   - non-install storytelling surfaces
3. If the production website is implemented while FFR Phase 5 is active, shared download/install work should be built once and accepted against both items.
4. This item should not outrun FFR reality by claiming download/install flows that the release system cannot yet support.

---

## 4. Reference-Site Technical Recon (Completed)

Targets reviewed:

1. `openclaw.ai`
2. `clawi.ai`
3. `blacksmith.sh`

### Observed evidence summary

1. `openclaw.ai`
   - Strong Astro markers (`data-astro-*`) and Vite-style assets.
   - Lightweight static-first output characteristics.
2. `clawi.ai`
   - Clear Next.js App Router signatures (`/_next/static`, response headers indicating Next.js).
   - Heavier app-style runtime/chunk profile.
3. `blacksmith.sh`
   - Webflow-generated assets/scripts.
   - GSAP present for animation-heavy interactions.

### Recommendation derived from evidence

1. Use **Astro + Tailwind** for Clawchestra.ai:
   - static-first performance
   - fast iteration
   - simple deployment
2. Keep animation approach **CSS-first**, with a single richer motion tool only if needed:
   - optional: Rive for one hero motion artifact
   - avoid broad animation-framework sprawl for initial launch.

---

## 5. Hosting, Analytics, and Operations Decisions

### Hosting/CDN (recommended path)

1. Host on Cloudflare Pages.
2. Manage DNS on existing Cloudflare domain setup for `clawchestra.ai`.
3. Keep deployment simple (no extra infra layers at first launch).

### Analytics

1. Minimal/no analytics at launch is acceptable.
2. If later needed, add one lightweight privacy-friendly tracker after public install opens.

---

## 6. Variant Exploration Phase (Required Before Full Build)

This phase is the mechanism to generate and compare polished directions before committing implementation resources.

### Purpose

1. Generate visual confidence.
2. Compare directions quickly without full-stack build cost.
3. Lock one direction based on explicit review criteria.

### Deliverables

Create at least three static direction mockups:

1. `Variant A` — dark-primary poster direction
2. `Variant B` — inverse/yellow-primary direction
3. `Variant C` — hybrid editorial direction with stronger typographic emphasis

Format:

1. HTML/CSS mockups (minimal JS only if needed for a key interaction feel).
2. Responsive states for desktop + mobile.
3. Shared content skeleton across all variants.

### Fixed across all variants

1. Information architecture sections from spec.
2. Core headline/value proposition blocks.
3. CTA order and semantics.
4. Install/waitlist truthfulness.
5. Brand palette family.

### Allowed to vary across variants

1. Typography pairing within allowed theme set.
2. Composition and layout rhythm.
3. Texture/grain treatment.
4. Motion language (subtle and intentional).
5. Illustration treatment/cropping of lobster motif.

### Review rubric

Each variant should be scored on:

1. Clarity in first 30 seconds.
2. Visual distinctiveness (non-generic quality).
3. Perceived trust and polish.
4. Install/waitlist CTA clarity.
5. Mobile readability and balance.
6. Ease of scaling into full production implementation.

---

## 7. Full Build Phase (After Variant Selection)

Once one direction is selected, build production site with:

1. Finalized copy system.
2. Production media assets.
3. Cloudflare deployment.
4. Public waitlist flow.
5. Private-alpha install instructions for invited users.

---

## 8. Media Pipeline Definition (What "Final Media Polish" Means)

For this project, the media polish pipeline is:

1. Define demo shot list (3-5 canonical user flows).
2. Capture source footage at consistent resolution/fps.
3. Edit and trim short sequences per website section.
4. Export optimized artifacts:
   - primary: `webm`/`mp4`
   - fallback: still images and optional GIF
5. Generate poster frames and alt text.
6. Compress for web budgets and verify load behavior on mobile.

This should be treated as a repeatable pipeline, not ad-hoc asset drops.

---

## 9. Dependencies and Decision Ledger

### Closed decisions

1. Launch mode: friend-first private alpha + public waitlist.
2. Core brand direction: locked to yellow/black/white/grey family with lobster motif.
3. Variant-first process before full implementation.
4. Hosting preference: Cloudflare stack.

### Still open (must close before production launch)

1. Public repository URL and release surface strategy.
2. Exact private-alpha access flow copy (invite wording, access request handling).
3. Which install channels are genuinely available on launch date.
4. Final font mapping per selected variant theme.
5. Final media asset pack readiness.

---

## 10. Execution Sequence

1. Create reconnaissance brief artifact (already completed at planning level; persist if needed as separate file).
2. Run Variant Exploration Phase and produce 3 static mockups.
3. Review and select (or merge) one direction.
4. Lock copy, font package mapping, and launch CTA text.
5. Build production website on selected stack.
6. Deploy to Cloudflare Pages and wire domain.
7. Ship friend-private install path and public waitlist site.

---

## 11. Exit Criteria for Discovery

This discovery phase is considered successfully executed when:

1. Three polished static variants exist and are reviewable.
2. One direction is explicitly selected.
3. Launch posture copy is finalized (private alpha + waitlist).
4. A separate implementation plan can be written without unresolved foundation decisions.
