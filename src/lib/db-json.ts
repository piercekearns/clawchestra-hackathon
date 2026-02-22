/**
 * db-json.ts — Zod schemas for the global ~/.openclaw/clawchestra/db.json file.
 *
 * Per-field __updatedAt sibling convention: every mutable field "foo" has a
 * sibling "foo__updatedAt" (HLC timestamp). This schema encodes both explicitly
 * so that corrupt values are caught at validation time, not at sync time.
 *
 * Phase 1.2 of the Architecture Direction plan.
 */

import { z } from 'zod';
import { ROADMAP_ITEM_STATUSES, PROJECT_STATUSES } from './constants';

// ---------------------------------------------------------------------------
// Project data (with per-field __updatedAt siblings)
// ---------------------------------------------------------------------------

export const DbProjectDataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  title__updatedAt: z.number(),
  status: z.enum(PROJECT_STATUSES),
  status__updatedAt: z.number(),
  description: z.string(),
  description__updatedAt: z.number(),
  parentId: z.string().nullable(),
  parentId__updatedAt: z.number(),
  tags: z.array(z.string()),
  tags__updatedAt: z.number(),
});

export type DbProjectData = z.infer<typeof DbProjectDataSchema>;

// ---------------------------------------------------------------------------
// Roadmap item (with per-field __updatedAt siblings)
// ---------------------------------------------------------------------------

export const DbRoadmapItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  title__updatedAt: z.number(),
  status: z.enum(ROADMAP_ITEM_STATUSES),
  status__updatedAt: z.number(),
  priority: z.number().int(),
  priority__updatedAt: z.number(),
  nextAction: z.string().optional(),
  nextAction__updatedAt: z.number().optional(),
  tags: z.array(z.string()).optional(),
  tags__updatedAt: z.number().optional(),
  icon: z.string().optional(),
  icon__updatedAt: z.number().optional(),
  blockedBy: z.string().nullable().optional(),
  blockedBy__updatedAt: z.number().optional(),
  specDoc: z.string().optional(),
  specDoc__updatedAt: z.number().optional(),
  planDoc: z.string().optional(),
  planDoc__updatedAt: z.number().optional(),
  specDocBranch: z.string().optional(),
  specDocBranch__updatedAt: z.number().optional(),
  planDocBranch: z.string().optional(),
  planDocBranch__updatedAt: z.number().optional(),
  specDocContent: z.string().optional(),
  specDocContent__updatedAt: z.number().optional(),
  planDocContent: z.string().optional(),
  planDocContent__updatedAt: z.number().optional(),
  completedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  completedAt__updatedAt: z.number().optional(),
});

export type DbRoadmapItem = z.infer<typeof DbRoadmapItemSchema>;

// ---------------------------------------------------------------------------
// Per-project container (path + project data + roadmap items)
// ---------------------------------------------------------------------------

export const DbProjectSchema = z.object({
  projectPath: z.string(),
  stateJsonMigrated: z.boolean().default(false),
  project: DbProjectDataSchema,
  roadmapItems: z.record(z.string(), DbRoadmapItemSchema),
});

export type DbProject = z.infer<typeof DbProjectSchema>;

// ---------------------------------------------------------------------------
// Client identity
// ---------------------------------------------------------------------------

export const DbClientSchema = z.object({
  hostname: z.string(),
  platform: z.string(),
  lastSeenAt: z.number(),
});

export type DbClient = z.infer<typeof DbClientSchema>;

// ---------------------------------------------------------------------------
// Top-level db.json schema
// ---------------------------------------------------------------------------

export const DbJsonSchema = z.object({
  _schemaVersion: z.number().int(),
  _lastSyncedAt: z.number(),
  _hlcCounter: z.number().int(),
  projects: z.record(z.string(), DbProjectSchema),
  clients: z.record(z.string(), DbClientSchema),
});

export type DbJson = z.infer<typeof DbJsonSchema>;
