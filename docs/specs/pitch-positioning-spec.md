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

**Concrete demo scenario: "Reading Tracker" from zero to shipped**

This is the actual walkthrough — a complete project lifecycle in ~5 minutes. Every step uses real app functionality. The demo project is deliberately simple so the focus stays on the workflow, not the project itself.

---

**Act 1: The Board (30s)**

Open the app. The board is already populated with real projects (Clawchestra itself, personal site, etc.) across columns. This isn't a blank demo — it's a real workspace.

> "This is Clawchestra. Everything I'm building, across every project, in one place. Each column is a status — pending, up next, in progress, complete. Each card is a deliverable. Let me show you what happens when I start something new."

---

**Act 2: Idea → Project → Roadmap (90s)**

Open the chat drawer. Talk to OpenClaw:

> "I want to build a simple reading tracker — a web app where I can log books I've read and rate them."

OpenClaw responds conversationally — suggests creating a project, asks a few clarifying questions. User agrees. OpenClaw:
1. Creates the project (card appears on the board in real-time)
2. Writes a brief spec doc
3. Creates 3-4 roadmap items: "Data model & API", "Reading log UI", "Rating system", "Deploy to Vercel"

**What to show:** The board updating live as OpenClaw works. Cards appearing. The project going from nothing to structured plan in under a minute. Click into the project — show the kanban with items in the pending column, click a card to see the spec.

**What to say:**
> "I described an idea. OpenClaw turned it into a project with a spec, a roadmap, and structured deliverables. I didn't fill out a form, I didn't write YAML, I didn't create a Jira ticket. I talked about what I wanted and the board updated."

---

**Act 3: Plan → Execute (90s)**

Click the first roadmap item ("Data model & API"). Open a Claude Code terminal scoped to the project.

> "Now I want to build this first item. I'll open a coding agent — Claude Code — right here, scoped to this project."

The terminal opens alongside the board (side-by-side or stacked layout). Claude Code reads the spec that OpenClaw wrote. It starts working.

**What to show:**
- The terminal running alongside the planning view — not in a separate app, not in a different window
- Activity dots animating on the terminal tab while Claude Code works
- The amber "action required" badge when Claude Code needs a decision
- Switching back to the board — the terminal keeps running, badges visible

**What to say:**
> "The coding agent is reading the spec that the planning AI wrote. Same system, same context. I can watch it work, switch to something else, and get notified when it needs me."

---

**Act 4: Complete → Move On (60s)**

Claude Code finishes the work. Review what it built (briefly). Mark the item as complete — hover the card, click the checkmark. Card moves to the complete column.

Open the chat drawer again. Ask OpenClaw:

> "What's next for the reading tracker?"

OpenClaw sees the updated board state — knows the first item is complete, sees the remaining items, suggests the next one. The loop is visible: what the coding agent built is reflected in the planning layer, and the planning AI uses that to guide what comes next.

**What to show:**
- Completing an item via the UI (hover action)
- OpenClaw's awareness of the updated state (it knows what just happened)
- The board reflecting the full lifecycle: some items complete, some pending

**What to say:**
> "The planning AI told the coding agent what to build. The coding agent built it. I marked it done. The planning AI sees the update and knows what's next. That's the loop — plan, execute, update, repeat. All in one place."

---

**Act 5: Cross-Project (30s)**

Navigate back to the main board. Show multiple projects.

> "This isn't just one project. Everything I'm building lives here. I can ask OpenClaw about any of them — 'what's blocked across my projects?', 'which project has the most items in progress?' — and get real answers because it has the actual state, not my memory of it."

---

**Key moments to highlight:**
- AI creating structured deliverables (not just chat — actual board items, specs, plans)
- The board updating in real-time as AI works
- Terminal agents embedded alongside the planning view, not in a separate tool
- Activity awareness: dots, badges, action-required indicators
- Completing work and the AI immediately knowing the updated state
- Multiple projects, one workspace, continuous context

**What NOT to show in the demo:**
- Setup / onboarding (assume the app is already configured)
- Git sync (real but not visually compelling for a first demo)
- Settings / customisation (not the story)
- Edge cases or error states

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
