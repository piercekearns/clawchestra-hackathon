# Pitch Positioning & Demo Framework

> Define what Clawchestra is, who it's for, and how to show it — producing the narrative that the website, pitch deck, and live demos are all built from.

**Status:** Draft
**Created:** 2026-03-05
**Roadmap Item:** `pitch-positioning`
**Blocked by:** Nothing
**Blocks:** `clawchestra-ai-website`
**Deadline:** End of 2026-03-06 (ready to pitch to users and investors)

---

## Why This Exists

The website needs a story before it needs a design. A pitch deck needs a through-line before it needs slides. A live demo needs a script before it needs polish. This item produces the shared narrative framework that all three draw from — so the website becomes a pathway into a live demo, and the live demo reinforces what the website promised.

---

## Deliverables

### 1. The Pitch Narrative

A clear, concise answer to each of these:

**What is Clawchestra?**
- One-sentence positioning
- The elevator pitch (30 seconds)
- The extended explanation (2 minutes)

**Who is it for?**
- Primary audience (builders who use AI agents in their workflow)
- What they're doing today without it (scattered tools, no unified planning layer, AI disconnected from project state)
- Why they'd switch / adopt

**What does it enable that nothing else does?**
- The closed loop: AI plans → visual board → AI executes against plans → board updates → AI sees updated state
- AI isn't bolted on — it's a first-class participant in the planning and execution cycle
- One workspace across all projects, all agents, all tools
- Dual-surface: every action available via UI and via AI, user chooses what's faster

**What are the alternatives and why do they fall short?**
- Linear/Jira/Notion + AI chat (planning and AI are separate systems, no closed loop)
- Claude Code / Codex / Cursor alone (execution without planning visualisation)
- Notion AI / Linear AI (AI assists within a traditional PM tool, doesn't drive the workflow)
- Custom dashboards (no AI integration, manual everything)

### 2. The Demo Script

A structured walkthrough that shows the closed loop in action. This should work as:
- A live demo for investors / users (you driving the app)
- A recorded video for the website
- Animated/illustrated sequences for the landing page

**Suggested flow:**

1. **Start with the board.** Show projects, columns, cards. "This is everything I'm building, at a glance."
2. **Talk to OpenClaw.** "I've been thinking about building X." OpenClaw creates a project, writes a spec, adds roadmap items. Board updates live.
3. **Pick an item, open a terminal.** Launch Claude Code scoped to the project. Show it reading the spec, writing code.
4. **Board reflects progress.** Item status updates, activity indicators show the terminal is working, unread badges appear when it needs attention.
5. **Cross-project awareness.** Switch to a different project. OpenClaw already knows the context. "What's the status across all my projects?" — gets a real answer from actual project state.
6. **The loop closes.** Work done in step 3 is visible in step 4. Planning from step 2 drove execution in step 3. Everything stays in sync because it's the same system.

**Key moments to highlight:**
- AI creating structured plans (not just chat responses — actual roadmap items, specs, plans)
- The board updating in real-time as AI works
- Terminal agents embedded alongside the planning view
- Moving between projects seamlessly with context preserved
- The dual-surface: doing something via UI, then doing the same thing via chat

### 3. Visual / Animated Demo Concepts

For the website, identify which moments from the demo script translate to:

- **Hero animation / video** — the single most compelling visual (likely: the board updating as AI creates items in real-time)
- **Feature sections** — 3-4 key capabilities, each with a short animation or screenshot sequence
- **Before/after** — what the workflow looks like without Clawchestra vs with it

These don't need to be built yet — just identified and described so the website design has a clear brief.

### 4. Investor Framing (If Needed)

- Market context (AI-native tooling wave, developer workflow consolidation)
- Differentiation (closed-loop AI planning, not just AI-assisted PM)
- Vision (where this goes — per-user customisation, agent marketplace, cross-device, team collaboration)
- Traction / proof points (what's been built, how fast, what it enables)

---

## How the Website Uses This

The website's job is to:
1. **Communicate the pitch** — what Clawchestra is and why you'd want it (from deliverable 1)
2. **Show it in action** — embedded demo video or animations (from deliverables 2 + 3)
3. **Convert to action** — waitlist signup, download, or "book a demo"

The website IS the pitch deck in web form. A live demo extends it. The narrative framework ensures both tell the same story.

---

## What's NOT in Scope

- Building the website (that's the `clawchestra-ai-website` item)
- Recording/editing the actual demo video (follows from the script)
- Designing the pitch deck slides (follows from the narrative)
- Pricing, business model, go-to-market strategy (separate concern)

---

## Open Questions

1. What's the single most impressive thing to show in the first 10 seconds of a demo?
2. Should the website lead with "project management" framing or "AI workspace" framing?
3. Is the investor pitch meaningfully different from the user pitch, or the same story with different emphasis?
4. What existing app state / projects make the best demo material?
