/**
 * state-json.ts — Zod schemas for per-project .clawchestra/state.json files.
 *
 * Single source of truth for the state.json schema. All validation of
 * agent-written state files passes through these schemas.
 *
 * Phase 1.2 of the Architecture Direction plan.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ROADMAP_ITEM_STATUSES, PROJECT_STATUSES } from './constants';

// ---------------------------------------------------------------------------
// Roadmap item schema
// ---------------------------------------------------------------------------

export const RoadmapItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(ROADMAP_ITEM_STATUSES),
  priority: z.number().int().optional(),
  nextAction: z.string().optional(),
  tags: z.array(z.string()).optional(),
  icon: z.string().optional(),
  blockedBy: z.string().nullable().optional(),
  specDoc: z.string().optional(),
  planDoc: z.string().optional(),
  completedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

// ---------------------------------------------------------------------------
// Full state.json document schema (Clawchestra-generated)
// ---------------------------------------------------------------------------

export const StateJsonDocumentSchema = z.object({
  _schemaVersion: z.number().int(),
  _generatedAt: z.number(),
  _generatedBy: z.literal('clawchestra'),
  project: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(PROJECT_STATUSES),
    description: z.string(),
    parentId: z.string().nullable(),
    tags: z.array(z.string()),
  }),
  roadmapItems: z.array(RoadmapItemSchema),
});

export type StateJsonDocument = z.infer<typeof StateJsonDocumentSchema>;
export type RoadmapItemState = z.infer<typeof RoadmapItemSchema>;

// ---------------------------------------------------------------------------
// Agent input schema (metadata fields stripped, partial allowed)
// ---------------------------------------------------------------------------
//
// .strip() enforces Section 2.4: "unknown top-level fields: warn and strip."
// Unknown fields are silently removed during parsing — warnings are logged
// separately in the merge logic (2.5) by comparing raw keys against schema keys.

export const AgentStateJsonInputSchema = StateJsonDocumentSchema.omit({
  _generatedAt: true,
  _generatedBy: true,
})
  .partial({
    _schemaVersion: true,
  })
  .strip();

export type AgentStateJsonInput = z.infer<typeof AgentStateJsonInputSchema>;

// ---------------------------------------------------------------------------
// Schema migration function pattern
// ---------------------------------------------------------------------------

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Schema migration functions. Each key is the source version, and the function
 * migrates from that version to version+1. Run sequentially.
 */
export const schemaMigrations: Record<number, (doc: unknown) => unknown> = {
  // 1 -> 2: add example field
  // 2: (doc) => ({ ...doc, newField: defaultValue, _schemaVersion: 2 }),
};

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

export type StateJsonParseResult =
  | { ok: true; data: StateJsonDocument }
  | { ok: false; error: z.ZodError };

export function parseStateJson(raw: unknown): StateJsonParseResult {
  const result = StateJsonDocumentSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

export type AgentInputParseResult =
  | { ok: true; data: AgentStateJsonInput }
  | { ok: false; error: z.ZodError };

export function parseAgentStateJson(raw: unknown): AgentInputParseResult {
  const result = AgentStateJsonInputSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

// ---------------------------------------------------------------------------
// JSON Schema export (Phase 1.5)
// ---------------------------------------------------------------------------

/**
 * Generate JSON Schema from the Zod definition. Called during state.json
 * projection to write .clawchestra/schema.json for agent self-validation.
 */
export function generateStateJsonSchema(): Record<string, unknown> {
  // Cast needed because zod-to-json-schema types reference zod/v3 internally,
  // while we use zod v4 classic mode. Runtime behavior is identical.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return zodToJsonSchema(StateJsonDocumentSchema as any, {
    name: 'StateJsonDocument',
    $refStrategy: 'none',
  });
}

// ---------------------------------------------------------------------------
// Tauri event payload types (Phase 2.9 — defined here for single import)
// ---------------------------------------------------------------------------

/** Payload for 'state-json-merged' event (emitted after watcher merge cycle) */
export interface StateJsonMergedPayload {
  projectId: string;
  project: {
    id: string;
    title: string;
    status: 'in-progress' | 'up-next' | 'pending' | 'dormant' | 'archived';
    description: string;
    parentId: string | null;
    tags: string[];
  };
  roadmapItems: RoadmapItemState[];
  appliedChanges: string[];
  rejectedFields: string[];
}

/** Payload for 'clawchestra-ready' event (emitted after startup sequence completes) */
export interface ClawchestraReadyPayload {
  projectCount: number;
  migratedCount: number;
  syncStatus: 'ok' | 'failed' | 'disabled';
}

// ---------------------------------------------------------------------------
// Tauri command response types (Phase 5.0.8)
// ---------------------------------------------------------------------------

/** Roadmap item with all DB fields including branch, content, and timestamps.
 * Returned by `get_project` Tauri command (distinct from event payloads which
 * exclude content fields for size). Content fields are Phase 5.21 additions. */
export interface RoadmapItemWithContent extends RoadmapItemState {
  /** Per-field HLC timestamps (present in DB responses, absent from event payloads) */
  title__updatedAt: number;
  status__updatedAt: number;
  priority__updatedAt: number;
  nextAction__updatedAt?: number;
  tags__updatedAt?: number;
  icon__updatedAt?: number;
  blockedBy__updatedAt?: number;
  specDoc__updatedAt?: number;
  planDoc__updatedAt?: number;
  completedAt__updatedAt?: number;
  /** Branch where spec doc lives (for cross-branch git show) */
  specDocBranch?: string;
  specDocBranch__updatedAt?: number;
  /** Branch where plan doc lives (for cross-branch git show) */
  planDocBranch?: string;
  planDocBranch__updatedAt?: number;
  /** Snapshot of spec doc content for cross-device access */
  specDocContent?: string;
  specDocContent__updatedAt?: number;
  /** Snapshot of plan doc content for cross-device access */
  planDocContent?: string;
  planDocContent__updatedAt?: number;
}

/** Full project detail returned by `get_project` Tauri command.
 * Includes content and branch fields on roadmap items. */
export interface ProjectWithContent {
  id: string;
  projectPath: string;
  stateJsonMigrated: boolean;
  project: {
    id: string;
    title: string;
    title__updatedAt: number;
    status: string;
    status__updatedAt: number;
    description: string;
    description__updatedAt: number;
    parentId: string | null;
    parentId__updatedAt: number;
    tags: string[];
    tags__updatedAt: number;
  };
  roadmapItems: RoadmapItemWithContent[];
}

/** Project summary returned by `get_all_projects` Tauri command.
 * Lightweight — no roadmap items, no content. */
export interface ProjectSummary {
  id: string;
  projectPath: string;
  title: string;
  status: string;
  description: string;
  parentId: string | null;
  tags: string[];
  roadmapItemCount: number;
  stateJsonMigrated: boolean;
  /** Full roadmap items (metadata only — content fields excluded). */
  roadmapItems: RoadmapItemState[];
}
