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

// ---------------------------------------------------------------------------
// Roadmap item schema
// ---------------------------------------------------------------------------

export const RoadmapItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['pending', 'up-next', 'in-progress', 'complete']),
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
    status: z.enum(['in-progress', 'up-next', 'pending', 'dormant', 'archived']),
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
