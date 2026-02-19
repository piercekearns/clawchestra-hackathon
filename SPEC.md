# Pipeline Dashboard — Technical Specification

*A visual, interactive project pipeline aggregator with embedded AI assistant.*

**Status:** Spec Complete — Ready for Build
**Created:** 2026-02-11
**Updated:** 2026-02-11 (v5 — review fixes applied)
**Author:** Clawdbot + Pierce

---

## Table of Contents

1. [Vision & Goals](#vision--goals)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Data Model & Schema](#data-model--schema)
5. [Field Ownership & Write Routing](#field-ownership--write-routing)
6. [UI Design System](#ui-design-system)
7. [UI Structure](#ui-structure)
8. [Core Features](#core-features)
9. [OpenClaw Integration](#openclaw-integration)
10. [File Operations](#file-operations)
11. [Error Handling](#error-handling)
12. [Schema Governance](#schema-governance)
13. [Project Structure](#project-structure)
14. [Build Phases](#build-phases)
15. [Future Considerations](#future-considerations)

---

## Vision & Goals

### What This Is
A personal productivity hub that **aggregates project states across repos** into an interactive kanban board, with an embedded OpenClaw chat panel for AI-assisted project management.

The dashboard is not a standalone tracker — it reads live status from each project's own repo. Coding agents update `PROJECT.md` in the repo they're working on; the dashboard sees those changes automatically. Macro-level priorities and organization live in the dashboard. Micro-level status lives in the repos.

### Core Principles
1. **Files as source of truth** — No database. Markdown files with frontmatter ARE the data.
2. **Aggregator, not duplicator** — Dashboard reads status from repos. No manual sync between dashboard and repo state.
3. **Bidirectional sync** — UI reads from files, writes back to files. Always in sync.
4. **Agent-native** — OpenClaw lives inside the dashboard. Ask it to update projects, add ideas, or modify the dashboard itself.
5. **Native app from day one** — Tauri-first architecture. Not a browser tab wrapped later.
6. **Generic board architecture** — Board/Column/Card components render any item with a status. Projects today, roadmap items tomorrow. Phase 6 (hierarchical drill-down) is a data source addition, not a component rewrite.
7. **D-ready architecture** — Clean separation so it could become multi-user/hosted later (without building for that now).

### Success Criteria
- [ ] Can see all projects at a glance in kanban view
- [ ] Can drag cards between columns, changes persist to markdown
- [ ] Projects with `localPath` read live status from their repo's PROJECT.md
- [ ] Can drill into any project for details, edit inline
- [ ] Can chat with OpenClaw in sidebar, it can make changes
- [ ] Feels like a native app (Tauri)
- [ ] Dashboard itself is editable by OpenClaw (agent-native)

---

## Tech Stack

### Frontend (Runs inside Tauri webview)
| Layer | Technology | Notes |
|-------|------------|-------|
| Framework | **Vite + React** | Fast HMR, no server framework overhead, Tauri-recommended |
| UI Components | **shadcn/ui** | Consistent, accessible, easy to customize |
| Styling | **Tailwind CSS** | Utility-first, works great with shadcn |
| Drag & Drop | **@dnd-kit/core** | Modern, accessible DnD library |
| Markdown Parsing | **gray-matter** | Parse frontmatter from markdown (in browser) |
| Markdown Rendering | **react-markdown** | Lighter than MDX, sufficient for content display |
| State Management | **Zustand** | Handles external updates well, good DX for optimistic updates |
| Icons | **Lucide React** | Comes with shadcn |
| Date Utilities | **date-fns** | `differenceInDays`, `parseISO` for staleness calculations |

### Backend (Tauri Rust — handles all filesystem and native operations)
| Layer | Technology | Notes |
|-------|------------|-------|
| File System | **Tauri invoke commands** | Rust reads/writes files, exposes via `invoke()` |
| File Watching | **@tauri-apps/plugin-fs** | Native file system events, replaces chokidar |
| Desktop App | **Tauri 2.0** | Lightweight, uses system webview |
| Build Target | **macOS (arm64)** | Primary target, can add Windows/Linux later |

### OpenClaw Integration
| Layer | Technology | Notes |
|-------|------------|-------|
| Connection | **REST** | `/v1/chat/completions` endpoint on local gateway (`http://localhost:18789`) |
| Mutation Model | **File-based** | OpenClaw writes files directly, dashboard watches for changes |
| Chat UI | **Custom component** | Embedded in sidebar |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  TAURI SHELL                                            │
│  ┌───────────────────────────────────────────────────┐  │
│  │  VITE + REACT (SPA)                               │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │              UI LAYER                       │  │  │
│  │  │  ┌────────────┐  ┌───────┐  ┌───────────┐  │  │  │
│  │  │  │ Breadcrumb │  │ Board │  │ Chat      │  │  │  │
│  │  │  │ Navigation │  │ (gen) │  │ Panel     │  │  │  │
│  │  │  └────────────┘  └───────┘  └───────────┘  │  │  │
│  │  │                  ┌───────┐  ┌───────────┐  │  │  │
│  │  │                  │Column │  │ Card      │  │  │  │
│  │  │                  │ (gen) │  │ Detail    │  │  │  │
│  │  │                  └───────┘  └───────────┘  │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  │                       │                           │  │
│  │  ┌────────────────────▼────────────────────────┐  │  │
│  │  │              DATA LAYER                     │  │  │
│  │  │  ┌──────────┐ ┌──────────┐ ┌────────────┐  │  │  │
│  │  │  │ store.ts │ │schema.ts │ │ gateway.ts │  │  │  │
│  │  │  │(Zustand) │ │(validate)│ │ (OpenClaw) │  │  │  │
│  │  │  └──────────┘ └──────────┘ └────────────┘  │  │  │
│  │  │  ┌──────────┐ ┌──────────┐ ┌────────────┐  │  │  │
│  │  │  │ tauri.ts │ │hierarch- │ │  views.ts  │  │  │  │
│  │  │  │(invoke)  │ │  y.ts    │ │(nav state) │  │  │  │
│  │  │  └──────────┘ └──────────┘ └────────────┘  │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│  ┌───────────────────────▼───────────────────────────┐  │
│  │  TAURI RUST BACKEND                               │  │
│  │  - get_projects_dir() → workspace path            │  │
│  │  - read_file(path) → raw file content             │  │
│  │  - write_file(path, content) → persist            │  │
│  │  - list_files(dir) → file paths                   │  │
│  │  - delete_file(path) → remove                     │  │
│  │  - File watching via @tauri-apps/plugin-fs         │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
  projects/*.md        ~/memestr/            OpenClaw Gateway
  (dashboard           PROJECT.md            (REST, localhost:18789)
   entries)            (repo status)
```

### Key Architectural Decisions

1. **Vite + React SPA** — No server framework. Vite provides fast HMR, minimal config, and is Tauri's recommended frontend tooling. No conceptual overhead of a server framework in a desktop app.

2. **Thin Rust backend** — Tauri commands handle raw file I/O only (read, write, list, delete, watch). Frontmatter parsing happens in the browser via `gray-matter`. This avoids reimplementing YAML parsing in Rust.

3. **Aggregator model** — Dashboard entries are thin references. If a project has `localPath`, the dashboard reads live status from that repo's `PROJECT.md` (or configured `statusFile`). Dashboard-only fields (priority, tags, icon) stay in the dashboard entry. Status fields come from the repo.

4. **OpenClaw writes files directly** — When the user asks OpenClaw to "move ClawOS to shipped", OpenClaw edits the markdown file itself. The Tauri file watcher detects the change and the dashboard re-renders. No special mutation API needed.

5. **Generic board components** — Board, Column, and Card components work with a `BoardItem` interface, not `ProjectViewModel` directly. This means Phase 6 (hierarchical drill-down into ROADMAP.md) is a data source addition, not a component rewrite.

6. **Column definitions are data** — Columns are defined by the current view context, not hardcoded. Top-level board uses project statuses (`in-progress`, `up-next`, etc.). A project's roadmap board (Phase 6) uses `complete`, `in-progress`, `pending`. The Board component doesn't care — it receives columns + items.

7. **Development workflow** — `npm run tauri dev` runs Vite dev server + Tauri window with hot reload. Iteration speed is identical to browser-only development.

---

## Data Model & Schema

### BoardItem Interface (Generic)

All kanban-rendered items implement this interface. Board, Column, and Card components work with `BoardItem`, making them reusable across projects (now) and roadmap items (Phase 6).

```typescript
// lib/schema.ts

// Any item that can appear on a kanban board
export interface BoardItem {
  id: string;
  title: string;
  status: string;
  priority?: number;
  icon?: string;
  nextAction?: string;
  blockedBy?: string;
  tags?: string[];
}
```

### Column Configuration

Columns are data, not hardcoded. Each view context defines its own columns.

```typescript
// lib/schema.ts

export interface ColumnDefinition {
  id: string;        // matches status values
  label: string;     // display name
  color?: string;    // accent color
}

// Top-level project board columns
export const PROJECT_COLUMNS: ColumnDefinition[] = [
  { id: 'in-progress', label: 'In Progress' },
  { id: 'up-next', label: 'Up Next' },
  { id: 'pending', label: 'Pending' },
  { id: 'dormant', label: 'Dormant' },
  { id: 'shipped', label: 'Shipped' },
];

// Roadmap item columns (Phase 6)
export const ROADMAP_COLUMNS: ColumnDefinition[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'complete', label: 'Complete' },
];
```

### Project Frontmatter Schema

Every project markdown file follows this schema:

```yaml
---
# REQUIRED
title: "Project Name"
status: "in-progress" | "up-next" | "pending" | "dormant" | "shipped"
type: "project" | "sub-project" | "idea"

# REQUIRED for in-progress
priority: 1  # integer, lower = higher priority

# OPTIONAL - External Repo
localPath: "~/memestr"           # filesystem path to repo (enables live status reading)
statusFile: "PROJECT.md"          # file to read status from (default: PROJECT.md)
repo: "piercekearns/memestr"      # GitHub repo for commit tracking (Phase 5)

# OPTIONAL - Hierarchy
parent: "nostr/clawos"  # relative path for sub-projects

# OPTIONAL - Tracking
lastActivity: "2026-02-07"  # ISO date, auto-updated on file change
lastReviewed: "2026-02-11"  # ISO date, manual or via review action

# OPTIONAL - Metadata
tags: ["nostr", "bot", "live"]
icon: "🚀"  # emoji for visual identification
color: "blue"  # for card accent (blue|green|yellow|red|purple|gray)

# OPTIONAL - State
blockedBy: "Waiting on X"  # surfaces as warning
nextAction: "Ship DM mode"  # quick reminder of what's next
---

# Project Name

Regular markdown content below the frontmatter...
```

### Repo Status File (PROJECT.md)

When a dashboard entry has `localPath`, the repo's status file provides live status:

```yaml
# ~/memestr/PROJECT.md
---
title: Memestr
status: in-progress
nextAction: Ship DM mode
blockedBy: null
lastActivity: 2026-02-11
---

Detailed content about the project...
```

For projects without `localPath`, the dashboard entry itself is the source of truth (all fields live in the dashboard entry).

### ROADMAP.md Format (Phase 6 Ready)

This format is defined now so repos can adopt it. Parsing and rendering happens in Phase 6.

```yaml
# ~/memestr/ROADMAP.md
---
items:
  - title: Public @mention flow
    status: complete
  - title: Zap-to-generate
    status: complete
  - title: DM mode
    status: in-progress
    nextAction: Figure out payment mechanism
  - title: Bot store integration
    status: pending
---

## Notes

Any markdown content about the roadmap...
```

Each item in `items` conforms to `BoardItem` — it has `title`, `status`, and optionally `priority`, `nextAction`, `blockedBy`, `tags`.

### Schema TypeScript Definitions

```typescript
// lib/schema.ts

export type ProjectStatus =
  | "in-progress"
  | "up-next"
  | "pending"
  | "dormant"
  | "shipped";

export type ProjectType =
  | "project"
  | "sub-project"
  | "idea";

export type ProjectColor = "blue" | "green" | "yellow" | "red" | "purple" | "gray";

// What lives in the dashboard entry's frontmatter
export interface ProjectFrontmatter {
  // Required
  title: string;
  status: ProjectStatus;
  type: ProjectType;

  // Conditionally required
  priority?: number;  // required if status === "in-progress"

  // Optional - External Repo
  localPath?: string;    // filesystem path to repo
  statusFile?: string;   // file in repo to read status from (default: PROJECT.md)
  repo?: string;         // GitHub repo slug for commit tracking (Phase 5)

  // Optional - Hierarchy
  parent?: string;

  // Optional - Tracking
  lastActivity?: string;  // ISO date
  lastReviewed?: string;  // ISO date

  // Optional - Metadata
  tags?: string[];
  icon?: string;
  color?: ProjectColor;

  // Optional - State
  blockedBy?: string;
  nextAction?: string;
}

// Status fields that come from the repo's PROJECT.md (when localPath exists)
export interface RepoStatus {
  title?: string;
  status?: ProjectStatus;
  nextAction?: string;
  blockedBy?: string;
  lastActivity?: string;
}

// What the UI works with — separates file data from derived state
// Prevents accidentally serializing computed fields back to YAML
export interface ProjectViewModel extends BoardItem {
  // Identity
  id: string;           // file path relative to projects/, minus .md
  filePath: string;     // absolute path to dashboard entry

  // File data (safe to serialize back)
  frontmatter: ProjectFrontmatter;
  content: string;      // markdown content after frontmatter

  // Repo data (if localPath exists)
  repoStatus?: RepoStatus;      // live status from repo's PROJECT.md
  repoFilePath?: string;         // absolute path to repo's status file

  // Hierarchy
  children: ProjectViewModel[];

  // Derived (computed, never written to file)
  isStale: boolean;     // lastActivity > 14 days ago
  needsReview: boolean; // lastReviewed > 7 days ago
  hasRepo: boolean;     // whether localPath is set and valid
  commitActivity?: {    // if repo is set, fetched from GitHub (Phase 5)
    lastCommit: string;
    commitsThisWeek: number;
  };
}

// Roadmap item — used in Phase 6 for hierarchical drill-down
// Conforms to BoardItem so the same Board/Column/Card components render it
export type RoadmapStatus = 'pending' | 'in-progress' | 'complete';

export interface RoadmapItem extends BoardItem {
  status: RoadmapStatus;
}
```

### Validation (Type Guard)

The validator narrows `unknown` data from `gray-matter` into typed `ProjectFrontmatter`. Returns the validated data on success so the consumer gets proper types without unsafe casts.

```typescript
// lib/schema.ts

import { differenceInDays, parseISO } from 'date-fns';

export const VALID_STATUSES = [
  "in-progress", "up-next", "pending", "dormant", "shipped"
] as const satisfies readonly ProjectStatus[];

export const VALID_TYPES = [
  "project", "sub-project", "idea"
] as const satisfies readonly ProjectType[];

export const VALID_COLORS = [
  "blue", "green", "yellow", "red", "purple", "gray"
] as const satisfies readonly ProjectColor[];

export type ValidationResult =
  | { valid: true; data: ProjectFrontmatter }
  | { valid: false; errors: string[] };

export function validateProject(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['frontmatter is not an object'] };
  }

  const record = data as Record<string, unknown>;

  // Required fields
  if (typeof record.title !== 'string' || !record.title) {
    errors.push('title is required');
  }
  if (typeof record.status !== 'string' || !record.status) {
    errors.push('status is required');
  }
  if (typeof record.type !== 'string' || !record.type) {
    errors.push('type is required');
  }

  // Status-specific
  if (record.status === 'in-progress' && typeof record.priority !== 'number') {
    errors.push('priority is required for in-progress projects');
  }

  // Type-specific
  if (record.type === 'sub-project' && typeof record.parent !== 'string') {
    errors.push('parent is required for sub-projects');
  }

  // Value validation
  if (typeof record.status === 'string' && !VALID_STATUSES.includes(record.status)) {
    errors.push(`invalid status: ${record.status}`);
  }
  if (typeof record.type === 'string' && !VALID_TYPES.includes(record.type)) {
    errors.push(`invalid type: ${record.type}`);
  }
  if (record.color !== undefined) {
    if (typeof record.color !== 'string' || !VALID_COLORS.includes(record.color)) {
      errors.push(`invalid color: ${String(record.color)}`);
    }
  }

  if (record.icon !== undefined && typeof record.icon !== 'string') {
    errors.push('icon must be a string');
  }

  if (record.tags !== undefined) {
    if (!Array.isArray(record.tags) || !record.tags.every(t => typeof t === 'string')) {
      errors.push('tags must be an array of strings');
    }
  }

  if (record.priority !== undefined && (typeof record.priority !== 'number' || !Number.isFinite(record.priority))) {
    errors.push('priority must be a finite number');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Safe to cast — all required fields validated above
  return { valid: true, data: record as unknown as ProjectFrontmatter };
}

// Staleness helpers
export function isStale(lastActivity: string | undefined): boolean {
  if (!lastActivity) return true;
  return differenceInDays(new Date(), parseISO(lastActivity)) > 14;
}

export function needsReview(lastReviewed: string | undefined): boolean {
  if (!lastReviewed) return true;
  return differenceInDays(new Date(), parseISO(lastReviewed)) > 7;
}

export function validateRepoStatus(data: unknown): RepoStatus | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const result: RepoStatus = {};

  if (typeof record.title === 'string') result.title = record.title;
  if (typeof record.status === 'string') {
    if (!VALID_STATUSES.includes(record.status as ProjectStatus)) return null;
    result.status = record.status as ProjectStatus;
  }
  if (typeof record.nextAction === 'string') result.nextAction = record.nextAction;
  if (record.blockedBy === null || typeof record.blockedBy === 'string') {
    result.blockedBy = record.blockedBy ?? undefined;
  }
  if (typeof record.lastActivity === 'string') result.lastActivity = record.lastActivity;

  return result;
}
```

---

## Field Ownership & Write Routing

When a project has `localPath`, fields are split between two files. The dashboard entry owns organizational fields; the repo's status file owns operational fields.

### Field Ownership Table

| Field | Owner | Read From | Write To |
|-------|-------|-----------|----------|
| `title` | Repo (if exists) | Repo's PROJECT.md | Repo's PROJECT.md |
| `status` | Repo (if exists) | Repo's PROJECT.md | Repo's PROJECT.md |
| `nextAction` | Repo (if exists) | Repo's PROJECT.md | Repo's PROJECT.md |
| `blockedBy` | Repo (if exists) | Repo's PROJECT.md | Repo's PROJECT.md |
| `lastActivity` | Repo (if exists) | Repo's PROJECT.md | Repo's PROJECT.md |
| `priority` | Dashboard | Dashboard entry | Dashboard entry |
| `tags` | Dashboard | Dashboard entry | Dashboard entry |
| `icon` | Dashboard | Dashboard entry | Dashboard entry |
| `color` | Dashboard | Dashboard entry | Dashboard entry |
| `type` | Dashboard | Dashboard entry | Dashboard entry |
| `localPath` | Dashboard | Dashboard entry | Dashboard entry |
| `repo` (GitHub) | Dashboard | Dashboard entry | Dashboard entry |
| `statusFile` | Dashboard | Dashboard entry | Dashboard entry |
| `parent` | Dashboard | Dashboard entry | Dashboard entry |
| `lastReviewed` | Dashboard | Dashboard entry | Dashboard entry |

### Merge Rule

**If a project has `localPath`, repo-owned fields are read from the repo's status file and written back to it. Dashboard-owned fields always read from and write to the dashboard entry.**

**If no `localPath`, everything reads from and writes to the dashboard entry** (current simple behavior).

### Fallback Behavior

If `localPath` is set but the status file (PROJECT.md) doesn't exist:
- Treat as dashboard-only mode (use dashboard entry for all fields)
- Show a warning indicator on the card (not an error — the repo might be new)
- Log to console: `"Status file not found at {localPath}/{statusFile}, using dashboard entry only"`

---

## UI Design System

### Color Scheme — Revival Theme

Brand identity: **monochromatic black/white with `#DFFF00` (chartreuse) accent.** This is the Revival Fightwear color language — high contrast, bold, clean.

#### Brand Palette

Tailwind CSS custom colors configured in `tailwind.config.js`. shadcn/ui's CSS variables are mapped to these.

```
revival-accent:
  50:  #FAFFC2   (lightest tint — subtle highlights, hover backgrounds)
  100: #F5FF85
  200: #EEFF52
  300: #E7FF29
  400: #DFFF00   ← PRIMARY ACCENT (buttons, active states, focus rings, links)
  500: #C8E600   (slightly muted — secondary accent, pressed states)
  600: #A3BB00
  700: #7E9100
  800: #596600
  900: #343C00   (darkest shade — accent text on light backgrounds)

neutral:
  0:   #FFFFFF   (light mode background)
  50:  #FAFAFA   (light mode card/surface)
  100: #F5F5F5   (light mode secondary surface)
  200: #E5E5E5   (borders, dividers in light mode)
  300: #D4D4D4
  400: #A3A3A3   (muted text)
  500: #737373   (secondary text)
  600: #525252
  700: #404040   (dark mode secondary surface)
  800: #262626   (dark mode card/surface)
  900: #171717   (dark mode background)
  950: #0A0A0A   (darkest — dark mode deep background)
```

#### Semantic Colors (Override brand when meaning matters)

These diverge from the monochrome scheme because they carry universal UI meaning. Don't fight convention here.

```
status-active:    #22C55E  (green-500  — active, healthy, connected)
status-warning:   #EAB308  (yellow-500 — stale, needs attention)
status-danger:    #EF4444  (red-500    — very stale, error, destructive)
status-info:      #3B82F6  (blue-500   — informational, links in content)
status-blocked:   #F97316  (orange-500 — blocked state)

gateway-connected:    #22C55E
gateway-disconnected: #EF4444
```

#### Theme Application

| Element | Light Mode | Dark Mode |
|---------|------------|-----------|
| Background | `neutral-0` (#FFF) | `neutral-950` (#0A0A0A) |
| Surface (cards, panels) | `neutral-50` | `neutral-800` |
| Secondary surface | `neutral-100` | `neutral-700` |
| Borders | `neutral-200` | `neutral-700` |
| Primary text | `neutral-900` | `neutral-50` |
| Secondary text | `neutral-500` | `neutral-400` |
| Accent (buttons, focus, active) | `revival-accent-400` | `revival-accent-400` |
| Accent hover | `revival-accent-500` | `revival-accent-300` |
| Accent text (on accent bg) | `neutral-900` | `neutral-900` (dark text on bright accent) |
| Column headers | `neutral-100` | `neutral-800` |
| Card hover | `neutral-100` | `neutral-700` |
| Drag ghost | `revival-accent-50` border | `revival-accent-900` border |

#### shadcn/ui CSS Variable Mapping

shadcn uses HSL CSS variables. Map them in `globals.css`:

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 9%;
    --card: 0 0% 98%;
    --card-foreground: 0 0% 9%;
    --primary: 72 100% 50%;        /* revival-accent-400 (#DFFF00) */
    --primary-foreground: 0 0% 9%; /* dark text on bright accent */
    --secondary: 0 0% 96%;
    --secondary-foreground: 0 0% 9%;
    --muted: 0 0% 96%;
    --muted-foreground: 0 0% 45%;
    --accent: 72 100% 50%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84% 60%;
    --border: 0 0% 90%;
    --ring: 72 100% 50%;
  }

  .dark {
    --background: 0 0% 4%;
    --foreground: 0 0% 98%;
    --card: 0 0% 15%;
    --card-foreground: 0 0% 98%;
    --primary: 72 100% 50%;
    --primary-foreground: 0 0% 9%;
    --secondary: 0 0% 25%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 25%;
    --muted-foreground: 0 0% 64%;
    --accent: 72 100% 50%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84% 60%;
    --border: 0 0% 25%;
    --ring: 72 100% 50%;
  }
}
```

### Dark / Light Mode

- **Default:** Follow system preference via `prefers-color-scheme`
- **Override:** Toggle in settings (Header → Settings gear)
- **Implementation:** `class` strategy on `<html>` element (Tailwind's `darkMode: 'class'`)
- **Persistence:** Store preference in Zustand → persist to `localStorage`
- **Three states:** `system` (default) | `light` | `dark`

```typescript
// In lib/store.ts
type ThemePreference = 'system' | 'light' | 'dark';

// In DashboardState
themePreference: ThemePreference;
setThemePreference: (pref: ThemePreference) => void;
```

On app load, apply the resolved theme class. When `system`, listen to `matchMedia('(prefers-color-scheme: dark)')` changes.

### Responsive Design

Desktop-first, but functional at all widths down to mobile.

#### Breakpoints

```
sm:  640px   — mobile landscape / narrow window
md:  768px   — tablet / half-screen
lg:  1024px  — comfortable desktop
xl:  1280px  — full desktop with chat panel
```

#### Layout Behavior by Breakpoint

| Width | Board | Chat Panel | Columns |
|-------|-------|------------|---------|
| `xl+` (1280+) | Full board + chat panel side by side | Visible sidebar, collapsible | All columns visible, scroll if needed |
| `lg` (1024-1279) | Full board, chat overlays or collapses | Overlay panel (slide-in from right) | All columns visible |
| `md` (768-1023) | Board with horizontal scroll | Full-screen overlay | Columns scroll horizontally |
| `sm` (<768) | Single column view OR horizontal swipe | Full-screen overlay, hamburger toggle | One column at a time with swipe/tabs |

#### Mobile-Specific Behavior

- **Navigation:** Hamburger menu replaces header controls
- **Chat:** Full-screen modal triggered from floating action button
- **Cards:** Full-width, stacked vertically within column
- **Detail view:** Full-screen slide-up instead of modal
- **Drag & drop:** Works via touch (dnd-kit supports touch), but also provide column-change dropdown as fallback
- **Column switching:** Tab bar at top showing column names, swipe between

#### Key Responsive Components

```
Header:
  xl-lg: Full bar with title, breadcrumb, search, settings, chat toggle
  md:    Title + breadcrumb, search collapses to icon, settings in menu
  sm:    Hamburger → slide-out menu with all controls

Board:
  xl-lg: CSS grid with all columns visible
  md:    Flex row with overflow-x-auto
  sm:    Single column with tab navigation

Chat Panel:
  xl:    Fixed sidebar (resizable, default 320px)
  lg:    Slide-in overlay panel
  md-sm: Full-screen overlay

Card Detail:
  xl-lg: Modal dialog (max-width 640px)
  md-sm: Full-screen slide-up panel
```

### Typography

- **Font:** System font stack (native feel in Tauri) — `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Monospace:** For code/file paths — `'SF Mono', 'Fira Code', 'Cascadia Code', monospace`
- **Scale:** Tailwind defaults (`text-sm` for card body, `text-base` for detail view, `text-lg` for headings)

---

## UI Structure

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────┐ ┌────┐│
│  │ 📋 Dashboard                          [⚙️] [🔍]     │ │ 💬 ││
│  │ ▸ Dashboard                                          │ └────┘│
│  └──────────────────────────────────────────────────────┘       │
├──────────────────────────────────────────────────────────────────┤
│                                                        │         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │  Chat   │
│  │IN FLIGHT│ │ UP NEXT │ │SIMMERING│ │ SHIPPED │      │  Panel  │
│  │         │ │         │ │         │ │         │      │         │
│  │ ┌─────┐ │ │ ┌─────┐ │ │ ┌─────┐ │ │         │      │  ┌───┐  │
│  │ │Card1│ │ │ │Card │ │ │ │Card │ │ │         │      │  │   │  │
│  │ └─────┘ │ │ └─────┘ │ │ └─────┘ │ │         │      │  │   │  │
│  │ ┌─────┐ │ │ ┌─────┐ │ │ ┌─────┐ │ │         │      │  │   │  │
│  │ │Card2│ │ │ │Card │ │ │ │Card │ │ │         │      │  │   │  │
│  │ └─────┘ │ │ └─────┘ │ │ └─────┘ │ │         │      │  │   │  │
│  │ ┌─────┐ │ │         │ │         │ │         │      │  └───┘  │
│  │ │Card3│ │ │         │ │         │ │         │      │  ┌───┐  │
│  │ └─────┘ │ │         │ │         │ │         │      │  │ > │  │
│  │         │ │         │ │         │ │         │      │  └───┘  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘      │         │
│                                                        │         │
└──────────────────────────────────────────────────────────────────┘
```

### Components

#### Breadcrumb Navigation
- Always visible below the header
- Top-level: `Dashboard`
- Phase 6: `Dashboard > Revival Fightwear > Club Shop UI Overhaul`
- Clicking any breadcrumb segment navigates to that level
- Built from day one with a single segment; Phase 6 adds depth

#### Header
- App title
- Settings button (opens preferences)
- Search/filter input
- Toggle chat panel button
- Error badge (shows count of parse failures, clickable for details)

#### Kanban Board (Generic)
- Receives `columns: ColumnDefinition[]` and `items: BoardItem[]`
- Renders columns dynamically based on current view context
- Cards are draggable between columns
- Column headers show count
- "Add" button at bottom of each column

#### Project Card (Collapsed)
```
┌────────────────────────────────────────┐
│ 🚀 Memestr                       #2   │  ← icon, title, priority
│ Live on DO, next: DM mode             │  ← nextAction or first line
│ ─────────────────────────────────────  │
│ 🟢 3 commits this week                │  ← activity indicator
│ nostr · bot · live                     │  ← tags
│                              ~/memestr │  ← repo indicator (if localPath)
└────────────────────────────────────────┘
```

Visual states:
- 🟢 Active (commits in last 7 days OR reviewed in last 7 days)
- 🟡 Stale (no activity 7-14 days)
- 🔴 Very stale (no activity 14+ days)
- ⚠️ Blocked (has `blockedBy` set)

#### Project Card (Expanded / Detail View)

Opens as modal or slide-over panel:

```
┌──────────────────────────────────────────────────────────┐
│  🚀 Memestr                                    [✏️] [×] │
│  nostr/memestr.md → ~/memestr/PROJECT.md                │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Status: [In Progress ▼]    Priority: [2 ▼]               │
│  Type: [Project ▼]        Tags: [nostr] [bot] [+]       │
│                                                          │
│  ─────────────────────────────────────────────────────  │
│                                                          │
│  Last Activity: 2026-02-07 (4 days ago)                 │
│  Last Reviewed: 2026-02-11 (today)                      │
│  Repo: piercekearns/memestr (3 commits this week)       │
│  Local: ~/memestr                                        │
│                                                          │
│  ─────────────────────────────────────────────────────  │
│                                                          │
│  Next Action:                                            │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Ship DM mode                                       │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ─────────────────────────────────────────────────────  │
│                                                          │
│  Content:                                                │
│  ┌────────────────────────────────────────────────────┐ │
│  │ *Nostr-native meme generator bot.*                 │ │
│  │                                                    │ │
│  │ **Status:** 🟢 Live                                │ │
│  │ **Hosting:** DigitalOcean...                       │ │
│  │                                   [Open Full ↗]   │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ─────────────────────────────────────────────────────  │
│                                                          │
│  Sub-projects: (none)                                    │
│                                                          │
│  ─────────────────────────────────────────────────────  │
│                                                          │
│  [Mark Reviewed]  [Request Update]  [Archive]  [Delete] │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### Chat Panel
- Collapsible sidebar (right side)
- Message history
- Input field at bottom
- Shows OpenClaw responses
- Gateway connection status indicator (connected/disconnected badge)
- Actions taken show as system messages ("✓ Moved ClawOS to Shipped")

---

## Core Features

### P0 — Must Have

| Feature | Description |
|---------|-------------|
| **Board View** | Generic kanban with columns defined by view context |
| **Card Display** | Show project cards with key info, implements `BoardItem` |
| **Drag & Drop** | Move cards between columns, persist to correct file (dashboard entry or repo) |
| **Card Detail** | Click to expand, see full info |
| **Inline Edit** | Edit status, priority, tags, nextAction directly |
| **Repo Reading** | If `localPath` set, read status from repo's PROJECT.md and merge |
| **Write Routing** | Updates write to correct file based on field ownership |
| **File Sync** | All changes write back to markdown files via Tauri commands |
| **File Watch** | Detect external changes via `@tauri-apps/plugin-fs`, refresh UI |
| **Chat Panel** | Embedded OpenClaw chat |
| **Basic Mutations** | OpenClaw writes files directly, dashboard watches for changes |
| **Breadcrumb Nav** | Navigation breadcrumb (single level now, multi-level Phase 6) |
| **Error Feedback** | Toast on save failure (revert card), error badge for parse failures |

### P1 — Should Have

| Feature | Description |
|---------|-------------|
| **Sub-projects** | Nested cards or expandable sections |
| **Search/Filter** | Filter by tag, status, text |
| **Stale Indicators** | Visual cues for inactive projects |
| **Quick Add** | Add new project/idea from board |
| **Mark Reviewed** | Reset staleness clock |
| **Request Update** | Button that prompts OpenClaw to check status |

### P2 — Nice to Have

| Feature | Description |
|---------|-------------|
| **GitHub Integration** | Fetch commit counts, show activity |
| **Keyboard Shortcuts** | Navigate, open, close with keyboard |
| **Dark Mode** | Toggle or system-preference |
| **Custom Columns** | Add/rename columns beyond defaults |
| **Bulk Actions** | Multi-select, batch status change |
| **Export View** | Export current board as image or markdown |

---

## OpenClaw Integration

### Mutation Model

OpenClaw (Clawdbot) already has filesystem access to the workspace. The mutation flow:

1. User sends message via chat panel to OpenClaw gateway (REST)
2. OpenClaw processes the request and edits the markdown file directly
3. Tauri file watcher (`@tauri-apps/plugin-fs`) detects the change
4. Dashboard refetches projects and re-renders

No special mutation API is needed. The dashboard doesn't need to understand what OpenClaw did — it just watches for file changes and reflects current state.

### REST Connection

```typescript
// lib/gateway.ts

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

function isChatCompletionResponse(data: unknown): data is ChatCompletionResponse {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.choices) || obj.choices.length === 0) return false;
  const firstChoice = obj.choices[0] as Record<string, unknown>;
  if (typeof firstChoice?.message !== 'object' || firstChoice.message === null) return false;
  const message = firstChoice.message as Record<string, unknown>;
  return typeof message.content === 'string';
}

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:18789';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function sendMessage(messages: ChatMessage[]): Promise<string> {
  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    throw new Error(`Gateway error: ${response.status}`);
  }

  const data: unknown = await response.json();

  if (!isChatCompletionResponse(data)) {
    throw new Error('Unexpected response shape from gateway');
  }

  return data.choices[0].message.content;
}
```

### Context Injection

When sending messages, include what the user is currently viewing:

```typescript
// lib/gateway.ts

export async function sendMessageWithContext(
  messages: ChatMessage[],
  context: { view: string; selectedProject?: string }
): Promise<string> {
  const contextMessage: ChatMessage = {
    role: 'system',
    content: context.selectedProject
      ? `User is viewing project: ${context.selectedProject}`
      : 'User is viewing: kanban board',
  };

  return sendMessage([contextMessage, ...messages]);
}
```

### System Messages

When the file watcher detects changes, surface them in the chat panel:

```typescript
// In the Zustand store or component
function onFileChange(filePath: string, changeType: string) {
  addSystemMessage(`✓ ${changeType}: ${filePath}`);
  refetchProjects();
}
```

---

## File Operations

### Type-Safe Tauri Invoke

The frontend calls Tauri commands for all file I/O. A typed invoke wrapper ensures compile-time checking of command names and argument shapes.

```typescript
// lib/tauri.ts

import { invoke } from '@tauri-apps/api/core';

// Type map: command name → { args, return }
// Keeps TypeScript and Rust command signatures in sync
type TauriCommands = {
  get_projects_dir: { args: Record<string, never>; return: string };
  read_file: { args: { path: string }; return: string };
  write_file: { args: { path: string; content: string }; return: void };
  list_files: { args: { dir: string }; return: string[] };
  delete_file: { args: { path: string }; return: void };
  resolve_path: { args: { path: string }; return: string };
};

async function typedInvoke<T extends keyof TauriCommands>(
  cmd: T,
  ...args: TauriCommands[T]['args'] extends Record<string, never>
    ? []
    : [args: TauriCommands[T]['args']]
): Promise<TauriCommands[T]['return']> {
  return invoke<TauriCommands[T]['return']>(cmd, args[0]);
}

// Public API
export async function getProjectsDir(): Promise<string> {
  return typedInvoke('get_projects_dir');
}

export async function readFile(path: string): Promise<string> {
  return typedInvoke('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return typedInvoke('write_file', { path, content });
}

export async function listFiles(dir: string): Promise<string[]> {
  return typedInvoke('list_files', { dir });
}

export async function deleteFile(path: string): Promise<void> {
  return typedInvoke('delete_file', { path });
}

// Resolves ~ and relative paths to absolute paths
export async function resolvePath(path: string): Promise<string> {
  return typedInvoke('resolve_path', { path });
}
```

### Rust Commands

```rust
// src-tauri/src/lib.rs

#[tauri::command]
fn get_projects_dir() -> Result<String, String> {
    // Hardcoded for MVP — personal tool
    Ok("/Users/piercekearns/clawdbot-sandbox/projects".to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_files(dir: String) -> Result<Vec<String>, String> {
    // Recursively list .md files, excluding PIPELINE.md, SPEC.md, etc.
    let mut files = Vec::new();
    list_files_recursive(&dir, &mut files)?;
    Ok(files)
}

fn list_files_recursive(dir: &str, files: &mut Vec<String>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            list_files_recursive(&path.to_string_lossy(), files)?;
        } else if path.extension().map_or(false, |ext| ext == "md") {
            let name = path.file_name().unwrap().to_string_lossy();
            // Skip non-project reference files
            if !["PIPELINE.md", "SPEC.md", "OVERVIEW.md", "SCHEMA.md", "USAGE.md", "README.md", "REVIEW-FIXES.md"]
                .contains(&name.as_ref())
            {
                files.push(path.to_string_lossy().to_string());
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn resolve_path(path: String) -> Result<String, String> {
    // Expand ~ to home directory, resolve relative paths
    let expanded = if path.starts_with("~/") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        format!("{}/{}", home, &path[2..])
    } else {
        path
    };
    std::fs::canonicalize(&expanded)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}
```

### Tauri Entry Point & Plugin Registration

```rust
// src-tauri/src/main.rs
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_projects_dir,
            read_file,
            write_file,
            list_files,
            delete_file,
            resolve_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Note:** `Cargo.toml` must include `tauri-plugin-fs` as a dependency, and `tauri.conf.json` must include fs plugin permissions for the projects directory and any `localPath` directories.

### Reading Projects (Frontend) — With Repo Merging

Uses the type guard validator — no unsafe `as` casts. When `localPath` exists, reads and merges status from the repo's PROJECT.md.

```typescript
// lib/projects.ts

import matter from 'gray-matter';
import { readFile, listFiles, getProjectsDir, resolvePath } from './tauri';
import { validateProject, validateRepoStatus, isStale, needsReview, VALID_STATUSES } from './schema';
import type { ProjectViewModel, RepoStatus, ProjectFrontmatter } from './schema';
import { buildHierarchy } from './hierarchy';

// Try to read status from a repo's PROJECT.md (or configured statusFile)
async function readRepoStatus(
  localPath: string,
  statusFile: string = 'PROJECT.md'
): Promise<{ status: RepoStatus; content: string; resolvedPath: string } | null> {
  try {
    const resolvedDir = await resolvePath(localPath);
    const filePath = `${resolvedDir}/${statusFile}`;
    const raw = await readFile(filePath);
    const { data, content } = matter(raw);
    const validated = validateRepoStatus(data);
    if (!validated) return null;
    return {
      status: validated,
      content,
      resolvedPath: filePath,
    };
  } catch {
    // Status file doesn't exist — use dashboard entry only
    return null;
  }
}

export async function getProjects(): Promise<ProjectViewModel[]> {
  const projectsDir = await getProjectsDir();
  const filePaths = await listFiles(projectsDir);
  const projects: ProjectViewModel[] = [];

  // Batch file reads in parallel
  const rawFiles = await Promise.all(filePaths.map(fp => readFile(fp)));

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const raw = rawFiles[i];
    const { data, content } = matter(raw);

    const result = validateProject(data);
    if (!result.valid) {
      console.warn(`Invalid project ${filePath}:`, result.errors);
      // TODO: surface as error-state card (see Error Handling)
      continue;
    }

    const dashboardFrontmatter = result.data;  // NEVER mutated
    const id = filePath
      .replace(projectsDir + '/', '')
      .replace(/\.md$/, '');

    // If localPath exists, read live status from repo
    let repoStatus: RepoStatus | undefined;
    let repoContent = content;
    let repoFilePath: string | undefined;

    if (dashboardFrontmatter.localPath) {
      const repoData = await readRepoStatus(
        dashboardFrontmatter.localPath,
        dashboardFrontmatter.statusFile
      );
      if (repoData) {
        repoStatus = repoData.status;
        repoContent = repoData.content;
        repoFilePath = repoData.resolvedPath;
      } else {
        console.warn(
          `Status file not found at ${dashboardFrontmatter.localPath}/${dashboardFrontmatter.statusFile ?? 'PROJECT.md'}, using dashboard entry only`
        );
      }
    }

    // Merge for display only — doesn't touch dashboardFrontmatter
    const mergedTitle = repoStatus?.title ?? dashboardFrontmatter.title;
    const mergedStatus = repoStatus?.status ?? dashboardFrontmatter.status;
    const mergedNextAction = repoStatus?.nextAction !== undefined ? repoStatus.nextAction : dashboardFrontmatter.nextAction;
    const mergedBlockedBy = repoStatus?.blockedBy !== undefined ? (repoStatus.blockedBy ?? undefined) : dashboardFrontmatter.blockedBy;
    const mergedLastActivity = repoStatus?.lastActivity ?? dashboardFrontmatter.lastActivity;

    projects.push({
      id,
      filePath,
      frontmatter: dashboardFrontmatter,  // always reflects dashboard file only
      content: repoContent,
      repoStatus,
      repoFilePath,
      children: [],
      isStale: isStale(mergedLastActivity),
      needsReview: needsReview(dashboardFrontmatter.lastReviewed),
      hasRepo: !!dashboardFrontmatter.localPath && !!repoStatus,

      // BoardItem fields use MERGED values for display
      title: mergedTitle,
      status: mergedStatus,
      priority: dashboardFrontmatter.priority,
      icon: dashboardFrontmatter.icon,
      nextAction: mergedNextAction,
      blockedBy: mergedBlockedBy,
      tags: dashboardFrontmatter.tags,
    });
  }

  return buildHierarchy(projects);
}
```

### Writing Projects (Frontend) — With Write Routing

Updates write to the correct file based on field ownership.

```typescript
// lib/projects.ts

// Allow null as sentinel for "clear this field"
type ProjectUpdate = {
  [K in keyof ProjectFrontmatter]?: ProjectFrontmatter[K] | null;
};

// Fields that are owned by the repo's PROJECT.md
const REPO_OWNED_FIELDS: ReadonlySet<keyof ProjectFrontmatter> = new Set([
  'title', 'status', 'nextAction', 'blockedBy', 'lastActivity'
] as const);

export async function updateProject(
  project: ProjectViewModel,
  updates: ProjectUpdate
): Promise<void> {
  // Split updates into repo-owned and dashboard-owned
  const repoUpdates: Record<string, unknown> = {};
  const dashboardUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;       // skip untouched fields
    if (project.hasRepo && REPO_OWNED_FIELDS.has(key as keyof ProjectFrontmatter)) {
      repoUpdates[key] = value;
    } else {
      dashboardUpdates[key] = value;
    }
  }

  // Write repo-owned fields to repo's PROJECT.md
  if (Object.keys(repoUpdates).length > 0 && project.repoFilePath) {
    // Validate status if being updated
    if (repoUpdates.status !== undefined && repoUpdates.status !== null
        && !VALID_STATUSES.includes(repoUpdates.status as string)) {
      throw new Error(`Invalid status: ${repoUpdates.status}`);
    }
    const raw = await readFile(project.repoFilePath);
    const { data, content } = matter(raw);
    const newData = { ...data };
    for (const [key, value] of Object.entries(repoUpdates)) {
      if (value === null) {
        delete newData[key];                  // clear the field
      } else {
        newData[key] = value;                 // set the field
      }
    }
    newData.lastActivity = new Date().toISOString().split('T')[0];
    const newContent = matter.stringify(content, newData);
    await writeFile(project.repoFilePath, newContent);
  }

  // Write dashboard-owned fields to dashboard entry
  if (Object.keys(dashboardUpdates).length > 0) {
    const raw = await readFile(project.filePath);
    const { data, content } = matter(raw);
    const newData = { ...data };
    for (const [key, value] of Object.entries(dashboardUpdates)) {
      if (value === null) {
        delete newData[key];                  // clear the field
      } else {
        newData[key] = value;                 // set the field
      }
    }

    // Only update lastActivity on dashboard entry if no repo
    if (!project.hasRepo) {
      newData.lastActivity = new Date().toISOString().split('T')[0];
    }

    const result = validateProject(newData);
    if (!result.valid) {
      throw new Error(`Invalid update: ${result.errors.join(', ')}`);
    }

    const newContent = matter.stringify(content, result.data);
    await writeFile(project.filePath, newContent);
  }
}

export async function createProject(
  id: string,
  frontmatter: ProjectFrontmatter,
  content: string
): Promise<void> {
  const projectsDir = await getProjectsDir();
  const filePath = `${projectsDir}/${id}.md`;

  const result = validateProject(frontmatter);
  if (!result.valid) {
    throw new Error(`Invalid project: ${result.errors.join(', ')}`);
  }

  const fileContent = matter.stringify(content, result.data);
  await writeFile(filePath, fileContent);
}

export async function deleteProject(id: string): Promise<void> {
  const projectsDir = await getProjectsDir();
  await deleteFile(`${projectsDir}/${id}.md`);
}
```

### Reorder Logic

When a card is dragged to a new position within a column:

```typescript
// lib/projects.ts

export async function reorderProjects(
  orderedIds: string[],
  allProjects: ProjectViewModel[]
): Promise<void> {
  const updates = orderedIds
    .map((id, i) => {
      const project = allProjects.find(p => p.id === id);
      if (project && project.frontmatter.priority !== i + 1) {
        return updateProject(project, { priority: i + 1 });
      }
      return null;
    })
    .filter(Boolean);

  await Promise.all(updates);
}
```

### File Watching

```typescript
// lib/watcher.ts

import { watch } from '@tauri-apps/plugin-fs';

export async function watchProjects(
  projectsDir: string,
  onChanged: () => void
): Promise<() => void> {
  let timeout: ReturnType<typeof setTimeout>;
  const unwatch = await watch(projectsDir, () => {
    clearTimeout(timeout);
    timeout = setTimeout(onChanged, 150);
  }, { recursive: true });

  return unwatch;
}
```

### Hierarchy Resolution

```typescript
// lib/hierarchy.ts

import type { ProjectViewModel } from './schema';

export function buildHierarchy(projects: ProjectViewModel[]): ProjectViewModel[] {
  // Create lookup map by id — children initialized as empty array
  const lookup = new Map<string, ProjectViewModel & { children: ProjectViewModel[] }>();
  for (const project of projects) {
    lookup.set(project.id, { ...project, children: [] });
  }

  const roots: ProjectViewModel[] = [];

  for (const project of lookup.values()) {
    if (project.frontmatter.parent) {
      // parent: "revival/REVIVAL" looks for project with id: "revival/REVIVAL"
      const parent = lookup.get(project.frontmatter.parent);
      if (parent) {
        parent.children.push(project);
      } else {
        // Parent not found, treat as root with warning
        console.warn(`Parent "${project.frontmatter.parent}" not found for "${project.id}"`);
        roots.push(project);
      }
    } else {
      roots.push(project);
    }
  }

  // Sort children by priority
  for (const project of lookup.values()) {
    if (project.children.length) {
      project.children.sort((a, b) =>
        (a.frontmatter.priority ?? 99) - (b.frontmatter.priority ?? 99)
      );
    }
  }

  // Sort roots by priority
  roots.sort((a, b) =>
    (a.frontmatter.priority ?? 99) - (b.frontmatter.priority ?? 99)
  );

  return roots;
}
```

### Navigation State (Phase 6 Ready)

```typescript
// lib/views.ts

import type { ColumnDefinition } from './schema';
import { PROJECT_COLUMNS, ROADMAP_COLUMNS } from './schema';

export type ViewContext =
  | {
      breadcrumbs: Array<{ id: string; label: string }>;
      columns: ColumnDefinition[];
      type: 'projects';
    }
  | {
      breadcrumbs: Array<{ id: string; label: string }>;
      columns: ColumnDefinition[];
      type: 'roadmap';
      projectId: string;
    };

// Default view: top-level project board
export function defaultView(): ViewContext {
  return {
    breadcrumbs: [{ id: 'root', label: 'Dashboard' }],
    columns: PROJECT_COLUMNS,
    type: 'projects',
  };
}

// Phase 6: drill into a project's roadmap
// Not implemented yet, but the structure is ready
export function projectRoadmapView(projectId: string, projectTitle: string): ViewContext {
  return {
    breadcrumbs: [
      { id: 'root', label: 'Dashboard' },
      { id: projectId, label: projectTitle },
    ],
    columns: ROADMAP_COLUMNS,
    type: 'roadmap',
    projectId,
  };
}
```

---

## Error Handling

### Error Types

```typescript
// lib/errors.ts

export type DashboardError =
  | { type: 'gateway_down'; message: string }
  | { type: 'parse_failure'; file: string; error: string }
  | { type: 'save_failure'; file: string; error: string }
  | { type: 'file_not_found'; file: string }
  | { type: 'repo_status_missing'; localPath: string; statusFile: string };
```

### Zustand Store Integration

```typescript
// In lib/store.ts

type ThemePreference = 'system' | 'light' | 'dark';

interface DashboardState {
  projects: ProjectViewModel[];
  errors: DashboardError[];
  gatewayConnected: boolean;
  viewContext: ViewContext;
  chatMessages: ChatMessage[];
  themePreference: ThemePreference;

  // Actions
  addError: (error: DashboardError) => void;
  clearError: (error: DashboardError) => void;  // clear by reference, not index
  setGatewayConnected: (connected: boolean) => void;
  setViewContext: (view: ViewContext) => void;
  setThemePreference: (pref: ThemePreference) => void;
}
```

### UI Error Responses

| Scenario | UI Response |
|----------|-------------|
| Gateway down | Chat panel shows "Disconnected" badge, input disabled, "Retry" button. Rest of dashboard works fine. |
| File parse failure | Skip file, add to errors array, show warning badge on header ("1 file failed to load"), click for details. |
| Save failure on drag | Toast notification "Failed to save [project]", revert card to original position, "Retry" in toast. |
| External file deleted | Remove card from board, optional toast "[Project] was deleted". |
| Malformed frontmatter | Treat as parse failure, surface in error list so user can fix manually. |
| Repo status file missing | Card shows warning indicator, uses dashboard entry fields, not an error. |
| Previously valid file becomes invalid | Show card in error state (red border, "Parse error" label) rather than removing it. Include file path so user can fix manually. |

---

## Schema Governance

### The Rule

**No schema changes without visualization decisions.**

When adding a new field to the schema:
1. Define the field in `lib/schema.ts`
2. Decide: Where does it show on the card? In detail view? Both?
3. Decide: Is it editable? How? (dropdown, text, toggle)
4. Update the UI components
5. Document in `SCHEMA.md`

### Adding New Fields

When OpenClaw (or anyone) wants to add a field:

1. **Prompt questions:**
   - "You want to add `estimatedHours`. Where should this display?"
   - "Should it be editable in the UI?"
   - "What's the input type? (number, text, dropdown)"

2. **Update schema** in `lib/schema.ts`

3. **Update UI** — add to card if important at-a-glance, add to detail view with appropriate input

4. **Update `docs/SCHEMA.md`**

### ROADMAP.md Governance

The ROADMAP.md format is defined in the Data Model section. When repos adopt it:
- Items must have `title` and `status` (conforms to `BoardItem`)
- Valid statuses: `pending`, `in-progress`, `complete`
- Optional: `priority`, `nextAction`, `blockedBy`, `tags`

### Planning Docs Are Branch-Agnostic

`PROJECT.md` and `ROADMAP.md` are planning documents, not code. They should be kept consistent across all branches in a repo. When agents or the dashboard update these files, they commit to the current branch with the understanding that planning docs are universal.

---

## Project Structure

```
pipeline-dashboard/
├── src/
│   ├── App.tsx                   # Root component, layout
│   ├── main.tsx                  # Vite entry point
│   ├── components/
│   │   ├── ui/                   # shadcn components
│   │   ├── Board.tsx             # Generic kanban board (renders BoardItem[])
│   │   ├── Column.tsx            # Generic column (renders ColumnDefinition)
│   │   ├── Card.tsx              # Generic card (renders BoardItem)
│   │   ├── CardDetail.tsx        # Project detail modal
│   │   ├── ChatPanel.tsx
│   │   ├── Header.tsx
│   │   ├── Breadcrumb.tsx        # Navigation breadcrumb
│   │   ├── ErrorBadge.tsx
│   │   └── AddProjectDialog.tsx
│   ├── lib/
│   │   ├── store.ts              # Zustand store (includes viewContext)
│   │   ├── schema.ts             # Types + validation + BoardItem + ColumnDefinition
│   │   ├── projects.ts           # CRUD with repo merging + write routing
│   │   ├── hierarchy.ts          # buildHierarchy()
│   │   ├── gateway.ts            # OpenClaw REST client (typed response)
│   │   ├── tauri.ts              # Type-safe Tauri invoke wrappers
│   │   ├── watcher.ts            # File watching via Tauri plugin
│   │   ├── views.ts              # ViewContext, breadcrumb state, column definitions
│   │   └── errors.ts             # Error types
│   └── styles/
│       └── globals.css
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                # Tauri commands (file I/O + resolve_path)
│   │   └── main.rs               # Entry point
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/
│   ├── SCHEMA.md                 # Field documentation
│   └── USAGE.md                  # How to use the dashboard
├── index.html                    # Vite entry HTML
├── vite.config.ts
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

**Note:** No `api/` routes directory. All data access goes through Tauri invoke commands. No `next.config.js` — Vite replaces Next.js.

---

## Build Phases

### Phase 1: Tauri + Core Board with Repo Reading (P0)
**Goal:** Tauri app with functional kanban that reads from dashboard entries AND external repos, with basic error feedback

- [x] Tauri project setup (Rust toolchain, `tauri init`)
- [x] Vite + React with shadcn/ui, Tailwind
- [x] Revival theme: Tailwind config with `revival-accent` + `neutral` palette, shadcn CSS variables (light + dark)
- [x] Dark/light mode: `darkMode: 'class'`, system detection via `matchMedia`, toggle persisted in Zustand/localStorage
- [x] Responsive layout: mobile-first breakpoints (sm/md/lg/xl), Board horizontal scroll at md, single-column at sm
- [x] Rust commands: `get_projects_dir`, `read_file`, `write_file`, `list_files`, `resolve_path`
- [x] Frontend: `lib/tauri.ts` type-safe invoke wrappers (including `resolvePath`)
- [x] Frontend: `lib/schema.ts` — `BoardItem`, `ColumnDefinition`, `ProjectFrontmatter`, `RepoStatus`, `ProjectViewModel`, validation, staleness helpers
- [x] Frontend: `lib/views.ts` — `ViewContext` type, `defaultView()`, `PROJECT_COLUMNS`
- [x] Frontend: `lib/projects.ts` — CRUD with repo reading and merge logic
- [x] Frontend: `lib/projects.ts` — write routing (repo-owned fields → repo file, dashboard-owned → dashboard entry)
- [x] Frontend: `lib/projects.ts` — `reorderProjects()` for drag reorder within columns
- [x] Frontend: `lib/hierarchy.ts` — `buildHierarchy()`
- [x] Frontend: `lib/errors.ts` — error types (including `repo_status_missing`)
- [x] Zustand store with projects state + error state + viewContext
- [x] Breadcrumb component (single level: "Dashboard")
- [x] Board component — generic, receives `ColumnDefinition[]` and `BoardItem[]`
- [x] Column component — generic, renders any `BoardItem[]`
- [x] Card component — generic, renders `BoardItem` (collapsed view)
- [x] Drag and drop between columns (status change) and within columns (reorder)
- [x] Invoke calls for persistence with write routing
- [x] File watching via `@tauri-apps/plugin-fs`
- [x] Basic error feedback: toast on save failure (revert card), error badge for parse failures, warning for missing repo status files

**Deliverable:** Tauri app that shows kanban, reads live from repos, drag works, changes persist to correct files, errors surface to the user.

### Phase 2: Detail & Edit (P0)
**Goal:** Full project management

- [x] Card detail modal/panel (shows both dashboard and repo source)
- [x] Inline editing (status, priority, tags, nextAction) — writes to correct file per field ownership
- [x] Markdown content display (react-markdown) — shows repo content if available
- [x] Sub-project display (nested or linked)
- [x] Add new project dialog
- [x] Delete/archive functionality
- [x] Rust commands: `delete_file` (create uses existing `write_file`)

**Deliverable:** Full CRUD on projects via UI, with correct write routing.

### Phase 3: Chat Integration (P0)
**Goal:** OpenClaw embedded

- [x] Chat panel component
- [x] REST client for OpenClaw gateway (`http://localhost:18789/v1/chat/completions`) with typed response
- [x] Message history display
- [x] Context injection (current view)
- [x] Gateway connection status indicator
- [x] System messages when file watcher detects changes

**Deliverable:** Can chat with OpenClaw, file watcher picks up its changes.

### Phase 4: Polish + Git Sync (P1)
**Goal:** Feels good to use, with git visibility

- [x] Stale indicators (🟢🟡🔴)
- [x] Search/filter
- [x] Keyboard navigation
- [x] Mark reviewed button
- [x] Request update button
- [x] Git status per repo (🟢 clean, 🟡 uncommitted, 🔵 unpushed, 🔴 behind)
- [x] Explicit commit button (not auto-commit — user clicks "Commit" after reviewing changes)
- [x] Push button (per-repo or "Push All")
- [x] Descriptive commit messages: `[Dashboard] Marked "Phase 2" as complete`
- [x] Commit to current branch (planning docs are branch-agnostic)
- [x] New Rust commands: `get_git_status`, `git_commit`, `git_push`

**Deliverable:** Production-quality UX with git sync visibility.

### Phase 5: Project SDK + GitHub Integration (P2)
**Goal:** Standardization tooling + automated activity tracking

- [x] Project templates: `PROJECT.md`, `ROADMAP.md`, `AGENTS.md` templates
- [x] Bootstrap command or OpenClaw skill: "Create a new project called X"
- [x] Agent context enforcement: `AGENTS.md` template includes dashboard schema rules
- [x] GitHub API client (via JS fetch from frontend)
- [x] Fetch commit counts for repos with `repo` field (GitHub slug)
- [x] Display activity in cards and detail view
- [x] Auto-update lastActivity from commits

**Deliverable:** New projects come pre-configured. Cards show real commit activity.

### Phase 6: Hierarchical Navigation (P2)
**Goal:** Drill-down into project roadmaps

- [x] `lib/views.ts` — `projectRoadmapView()`, `ROADMAP_COLUMNS`
- [x] Parse ROADMAP.md from repos (items array → `RoadmapItem[]`)
- [x] "View Roadmap" button on project cards (if ROADMAP.md exists)
- [x] Breadcrumb updates: `Dashboard > Revival > Roadmap`
- [x] Board renders roadmap items using same generic components
- [x] Drag roadmap items between columns (pending → in-progress → complete)
- [x] Write changes back to ROADMAP.md
- [x] Navigation back via breadcrumb

**Deliverable:** Click into any project, see and manage its roadmap as a kanban.

---

## Future Considerations

### D-Ready Architecture

If this ever becomes multi-user/hosted:

1. **Abstract data layer** — `lib/projects.ts` becomes an interface, swap Tauri invoke for HTTP API
2. **Auth layer** — Add auth provider
3. **API security** — Token-based auth on API routes
4. **Sync** — Bi-directional sync between local and cloud

For now, none of this is built — but the clean separation makes it possible later.

### Dashboard as Skill

Once built, create a skill for OpenClaw:

```
skills/pipeline-dashboard/
├── SKILL.md
├── schema/
│   └── project.schema.json
└── scripts/
    └── validate.ts
```

This standardizes how OpenClaw interacts with the dashboard, reduces token usage, and keeps knowledge from going stale.

### Self-Modifying

Because the dashboard code lives in the workspace:
- OpenClaw can edit components when asked
- Changes are tracked in git
- You can review diffs before accepting
- The dashboard evolves via conversation

### Post-Build: Repo Standardization

After the dashboard is built, add this as a dashboard card:

```yaml
title: "Standardize all repos for dashboard schema"
status: up-next
type: project
priority: 1
nextAction: "Audit all repos for PROJECT.md, ROADMAP.md, agent context"
```

This task covers:
- Auditing every existing repo for dashboard compatibility
- Adding `PROJECT.md` where missing (with correct frontmatter)
- Standardizing `ROADMAP.md` format across repos
- Updating agent context docs (`CLAUDE.md` / `AGENTS.md`) to enforce schema compliance
- Ensuring agents cannot make changes without reading schema requirements (via GetUpToSpeed or equivalent)
- Hard-enforcing that these docs are loaded as context before any agent operates on a repo

### Auto-Commit Across Branches (Future)

Currently: commit to current branch. Future consideration:
- "Commit to all branches" toggle for planning docs
- Since `PROJECT.md` and `ROADMAP.md` are branch-agnostic, they should ideally be consistent everywhere
- Implementation: stash → checkout each branch → cherry-pick commit → checkout original
- Complex enough to defer until demand is proven

---

## Appendix: Migration of Existing Projects

Existing project files already have frontmatter added (commit `8507ba4`). Schema-compliant YAML frontmatter was added to all 21 project files:

- In-flight: ClawOS, Memestr, Revival
- Up-next: Pipeline Dashboard, Restricted Section, BotFather, Dating
- Pending: Personal site, ideas, sub-projects

Reference docs (PIPELINE.md, SPEC.md, etc.) were left without frontmatter — the dashboard filters these out by only including files that pass validation.

**Next step after build:** Add `localPath` to project entries that have external repos (Memestr, ClawOS, Revival, etc.) and create `PROJECT.md` in each repo.

---

*End of specification.*
