# Launch Clawchestra.ai Website

Create a public-facing website for Clawchestra that explains what the app is, demonstrates how it works, and makes installation fast across operating systems.

## Key Deliverables
- Technical reconnaissance of `openclaw.ai` and `clawi.ai` (framework, styling, animation, maintainability)
- Distinctive brand-first marketing site for `clawchestra.ai`
- Hero section with Clawchestra branding/logo and clear value proposition
- Product walkthrough section with an interactive/animated app demo
- Clear explanation of mission, product goals, and outcomes for users
- Feature highlights with concrete examples
- Quick Start section with multiple installation paths
- GitHub repository link and explicit "Powered by OpenClaw" messaging

## Spec
See `docs/specs/clawchestra-ai-website-spec.md` for current scope, dependencies, reconnaissance outcomes, and pre-plan execution gates.

## Current Status
- Launch posture selected: **friend-first private alpha + public waitlist website**
- Brand constraints locked: `#DFFF00` + black/white/grey family, lobster-centric visual direction
- Technical recon completed at planning level for:
  - `openclaw.ai` (Astro/Vite-style static-first output)
  - `clawi.ai` (Next.js App Router/Turbopack profile)
  - `blacksmith.sh` (Webflow + GSAP-heavy stack)
- Recommended implementation stack: **Astro + Tailwind**, CSS-first motion (optional single richer motion layer only if needed)

## Dependencies
- Implementation plan (to be written after variant exploration direction is selected)
- DNS and hosting setup for `clawchestra.ai`
- Public repository strategy (no remote currently configured in this local repo)
- Distribution channel decisions (`npm`/`pnpm`/`bun`, Homebrew, or release downloads)
- Install artifacts per OS (macOS, Linux, Windows)
- Final website content and media assets (demo video/GIF/screenshots, logo variants)

## Next Step
Run Variant Exploration Phase: produce 3 polished static mockups under locked brand/copy constraints, review and choose one direction, then write implementation plan before production implementation.
