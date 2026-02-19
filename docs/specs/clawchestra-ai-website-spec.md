# Clawchestra.ai Website

> Launch a bold, high-conviction website that explains Clawchestra, proves product value quickly, and makes installation frictionless.

## Summary

Clawchestra needs a dedicated public website that turns first-time visitors into active users by combining strong brand expression, fast product comprehension, and immediate install paths. This spec defines core content, interaction goals, and delivery constraints for a `clawchestra.ai` launch, with design and implementation explicitly executed using the `frontend-design` skill (inspired by `openclaw.ai` / `clawi.ai` energy, but not visually derivative). It also identifies unresolved dependencies that must be closed before launch.

---

**Roadmap Item:** `clawchestra-ai-website`
**Status:** Draft
**Created:** 2026-02-19

---

## 1. Product Intent

The site should answer these questions in under 30 seconds:
- What is Clawchestra?
- Why does it matter?
- What can it do for me?
- How do I install it right now?

Primary conversion event: user starts installation.
Secondary conversion event: user visits the GitHub repository.

## 2. Required Outcomes

The first release must satisfy all of the following:

### A. Branding
- Prominently display Clawchestra branding and logo above the fold
- Establish a confident visual identity (not generic landing-page styling)

### B. Product Visualisation
- Show the app in action with at least one rich visual artifact:
  - preferred: short embedded demo video
  - fallback: animated GIF + high-quality screenshots
- Include at least one interaction cue (hover/scroll animation, timeline reveal, or UI simulation)

### C. Product Story
- Clearly describe:
  - what Clawchestra is
  - what the project exists to do
  - what goals it helps teams/agents achieve
- Explain outcomes, not only features

### D. Feature Communication
- Present key features as scannable sections/cards
- Tie each feature to a practical benefit

### E. Easy Installation
- Include a "Quick Start" section that supports multiple install methods and multiple operating systems
- Installation instructions should minimize cognitive load (copy/paste command blocks + OS tabs or method tabs)

## 3. Site Information Architecture

Recommended structure:
1. Hero (branding, one-sentence value prop, primary CTA: Install)
2. Product in Motion (video/animation of real usage)
3. What It Is / Why It Exists
4. Feature Highlights
5. Quick Start Installation
6. Powered by OpenClaw
7. GitHub + community links
8. FAQ / troubleshooting for install edge cases

## 4. Content Requirements

### Must include
- Clawchestra logo/wordmark
- GitHub repository link
- Explicit statement that Clawchestra is powered by OpenClaw
- Installation guidance for macOS, Linux, and Windows

### Should include
- "Who this is for" framing (solo builders, teams, agent-native workflows)
- Credibility elements (real screenshots, architecture snippets, or workflow diagrams)

## 5. Frontend Design Execution (Required Skill)

Implementation for this website must use the `frontend-design` skill guidance:
- Commit to a single intentional aesthetic direction before coding
- Use expressive typography and cohesive visual system
- Avoid generic "AI landing page" patterns
- Use meaningful motion (load sequence, staged reveals, or interactive preview)
- Ensure responsive behavior on both desktop and mobile

Design inspiration references (`openclaw.ai`, `clawi.ai`, `blacksmith.sh`) should inform confidence and clarity, but the final execution must be distinctly Clawchestra.

## 6. Visual Direction Concept (Preferred)

Preferred concept direction for the first build:
- High-contrast, poster-like aesthetic with coarse dither/grain texture
- Hero anchored by a large lobster motif adapted for Clawchestra (conducting baton in one/both claws)
- Revival yellow (`#DFFF00`) as dominant brand accent with black as core contrast pair
- Composition should feel bold and intentional, not polished-corporate

Two acceptable palette modes:
1. Dark mode primary: near-black background, `#DFFF00` lobster/accents
2. Inverse mode primary: `#DFFF00` background, near-black lobster/typography

Usage guidance:
- Lobster artwork can be a large background plane behind hero content, but text contrast must remain AAA/AA readable.
- Add subtle motion only (parallax drift, grain flicker, reveal masks); avoid heavy animation that obscures copy.
- Maintain a clear CTA hierarchy above visual treatment: Install first, GitHub second.
- Keep art export flexible (SVG/PNG/WebP variants + transparent cutout) so sections can reuse motif without repainting layout.

## 7. Reference Site Reconnaissance (Required Before Build Plan)

Before implementation planning, run a targeted technical reconnaissance of `openclaw.ai`, `clawi.ai`, and `blacksmith.sh` to reduce guesswork and avoid low-quality "quick AI site" outcomes.

### Research goals
- Identify likely framework/runtime used (for example: React/Next.js/Astro/Svelte)
- Identify styling and component approach (for example: Tailwind, shadcn-style primitives, custom CSS system)
- Identify animation approach (for example: Framer Motion, GSAP, CSS-only, Lottie/Rive usage)
- Identify typography strategy and layout system patterns
- Identify deployment/hosting patterns where discoverable
- Identify maintainability characteristics (easy to extend, componentization quality, likely update ergonomics)

### Required output
Create a short internal research brief before build planning that includes:
- observed evidence
- confidence level for each inference
- recommendations for the Clawchestra stack choice, optimized for speed and long-term maintainability
- explicit note on whether to use familiar tooling (`shadcn`, `Tailwind`) or alternatives, with rationale

## 8. Installation Experience Requirements

Quick Start must support multiple pathways:
- Source build from GitHub (clone + prerequisites + run/build)
- Packaged binary install per OS (if artifacts exist)
- Package-manager install paths where available (`npm`, `pnpm`, `bun`, etc.)

Every method should show:
- prerequisites
- exact command(s)
- expected result
- fallback/help link if command fails

## 9. Dependencies and Unresolved Preconditions

### Confirmed
- Domain ownership: user confirmed `clawchestra.ai` is owned.

### Unresolved / Needs Decision
1. DNS and hosting strategy for `clawchestra.ai`
2. Public GitHub repository URL and release strategy
3. Which install channels will be officially supported at launch
4. Whether package-manager distribution artifacts exist (currently unknown)
5. Whether signed installers/notarization are required at launch
6. Marketing media assets availability (demo video/GIF/screenshots)
7. Reference-site reconnaissance not yet completed (`openclaw.ai`, `clawi.ai`, `blacksmith.sh`)
8. Hero artwork production workflow not yet finalized (AI-edited lobster asset pipeline + export formats)

These must be resolved before a production launch plan is finalized.

## 10. Acceptance Criteria

This item is ready for build verification when:
- Reference-site reconnaissance brief is completed and reviewed
- Final implementation stack decision is documented with rationale
- Website contains all required sections in this spec
- Visual direction implements approved lobster/baton concept (or documented alternative approved by user)
- Quick Start provides at least two valid installation methods
- OS-specific install guidance exists for macOS, Linux, and Windows
- GitHub link and OpenClaw attribution are visible
- Product demo media is present and functional
- Mobile and desktop layouts are both usable and polished

## 11. Out of Scope (Initial Launch)

- Full documentation portal migration
- Authenticated user dashboard/accounts
- Blog/CMS system
- Advanced SEO/analytics optimization beyond baseline metadata
