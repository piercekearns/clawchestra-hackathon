/**
 * state-json.test.ts — Zod schema validation tests for state.json and db.json.
 *
 * Phase 1 verification: schemas parse example documents correctly.
 */

import { describe, it, expect } from 'bun:test';
import {
  parseStateJson,
  parseAgentStateJson,
  generateStateJsonSchema,
  StateJsonDocumentSchema,
  AgentStateJsonInputSchema,
  RoadmapItemSchema,
  CURRENT_SCHEMA_VERSION,
} from './state-json';
import { DbJsonSchema, DbProjectSchema, DbRoadmapItemSchema } from './db-json';

// ---------------------------------------------------------------------------
// Example documents (matching the plan's schema definition)
// ---------------------------------------------------------------------------

const exampleStateJson = {
  _schemaVersion: 1,
  _generatedAt: 1708531200000,
  _generatedBy: 'clawchestra',
  project: {
    id: 'revival-fightwear',
    title: 'Revival Fightwear',
    status: 'in-progress',
    description: 'Shopify Fabric theme for combat sports brand',
    parentId: null,
    tags: ['shopify', 'ecommerce'],
  },
  roadmapItems: [
    {
      id: 'auth-system',
      title: 'Authentication System',
      status: 'in-progress',
      priority: 1,
      nextAction: 'Implement OAuth flow',
      tags: ['feature', 'auth'],
      icon: '\uD83D\uDD10',
      blockedBy: null,
      specDoc: 'docs/specs/auth-system-spec.md',
      planDoc: 'docs/plans/auth-system-plan.md',
      completedAt: null,
    },
  ],
};

const exampleDbJson = {
  _schemaVersion: 1,
  _lastSyncedAt: 1708531200000,
  _hlcCounter: 42,
  projects: {
    'revival-fightwear': {
      projectPath: '/Users/pierce/repos/revival-fightwear',
      project: {
        id: 'revival-fightwear',
        title: 'Revival Fightwear',
        title__updatedAt: 1708531100000,
        status: 'in-progress',
        status__updatedAt: 1708531100000,
        description: 'Shopify Fabric theme for combat sports brand',
        description__updatedAt: 1708531100000,
        parentId: null,
        parentId__updatedAt: 1708531100000,
        tags: ['shopify', 'ecommerce'],
        tags__updatedAt: 1708531100000,
      },
      roadmapItems: {
        'auth-system': {
          id: 'auth-system',
          title: 'Authentication System',
          title__updatedAt: 1708531200000,
          status: 'in-progress',
          status__updatedAt: 1708531200000,
          priority: 1,
          priority__updatedAt: 1708531200000,
          nextAction: 'Implement OAuth flow',
          nextAction__updatedAt: 1708531200000,
          tags: ['feature', 'auth'],
          tags__updatedAt: 1708531200000,
          icon: '\uD83D\uDD10',
          icon__updatedAt: 1708531200000,
          blockedBy: null,
          blockedBy__updatedAt: 1708531200000,
          specDoc: 'docs/specs/auth-system-spec.md',
          specDoc__updatedAt: 1708531200000,
          planDoc: 'docs/plans/auth-system-plan.md',
          planDoc__updatedAt: 1708531200000,
          completedAt: null,
          completedAt__updatedAt: 1708531200000,
        },
      },
    },
  },
  clients: {
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890': {
      hostname: 'pierces-macbook',
      platform: 'darwin',
      lastSeenAt: 1708531200000,
    },
  },
};

// ---------------------------------------------------------------------------
// state.json tests
// ---------------------------------------------------------------------------

describe('StateJsonDocumentSchema', () => {
  it('parses a valid state.json document', () => {
    const result = parseStateJson(exampleStateJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.project.id).toBe('revival-fightwear');
      expect(result.data.roadmapItems).toHaveLength(1);
      expect(result.data.roadmapItems[0].id).toBe('auth-system');
    }
  });

  it('rejects invalid project status', () => {
    const invalid = {
      ...exampleStateJson,
      project: { ...exampleStateJson.project, status: 'banana' },
    };
    const result = parseStateJson(invalid);
    expect(result.ok).toBe(false);
  });

  it('rejects invalid roadmap item status', () => {
    const invalid = {
      ...exampleStateJson,
      roadmapItems: [
        { ...exampleStateJson.roadmapItems[0], status: 'done' },
      ],
    };
    const result = parseStateJson(invalid);
    expect(result.ok).toBe(false);
  });

  it('rejects missing _generatedBy', () => {
    const { _generatedBy, ...rest } = exampleStateJson;
    void _generatedBy;
    const result = parseStateJson(rest);
    expect(result.ok).toBe(false);
  });

  it('rejects wrong _generatedBy value', () => {
    const invalid = { ...exampleStateJson, _generatedBy: 'other' };
    const result = parseStateJson(invalid);
    expect(result.ok).toBe(false);
  });

  it('validates completedAt format when present', () => {
    const withDate = {
      ...exampleStateJson,
      roadmapItems: [
        { ...exampleStateJson.roadmapItems[0], status: 'complete', completedAt: '2026-03-03' },
      ],
    };
    const result = parseStateJson(withDate);
    expect(result.ok).toBe(true);
  });

  it('rejects invalid completedAt format', () => {
    const badDate = {
      ...exampleStateJson,
      roadmapItems: [
        { ...exampleStateJson.roadmapItems[0], status: 'complete', completedAt: 'Feb 21' },
      ],
    };
    const result = parseStateJson(badDate);
    expect(result.ok).toBe(false);
  });

  it('accepts minimal roadmap item (only required fields)', () => {
    const minimal = {
      ...exampleStateJson,
      roadmapItems: [
        { id: 'minimal', title: 'Minimal Item', status: 'pending' },
      ],
    };
    const result = parseStateJson(minimal);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Agent input tests
// ---------------------------------------------------------------------------

describe('AgentStateJsonInputSchema', () => {
  it('parses agent input (no metadata fields required)', () => {
    const agentInput = {
      _schemaVersion: 1,
      project: exampleStateJson.project,
      roadmapItems: exampleStateJson.roadmapItems,
    };
    const result = parseAgentStateJson(agentInput);
    expect(result.ok).toBe(true);
  });

  it('parses agent input without _schemaVersion (optional)', () => {
    const agentInput = {
      project: exampleStateJson.project,
      roadmapItems: exampleStateJson.roadmapItems,
    };
    const result = parseAgentStateJson(agentInput);
    expect(result.ok).toBe(true);
  });

  it('strips unknown fields', () => {
    const agentInput = {
      project: exampleStateJson.project,
      roadmapItems: exampleStateJson.roadmapItems,
      _instructions: 'This should be stripped',
      randomField: true,
    };
    const result = parseAgentStateJson(agentInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('_instructions' in result.data).toBe(false);
      expect('randomField' in result.data).toBe(false);
    }
  });

  it('rejects missing project field', () => {
    const noProject = {
      roadmapItems: exampleStateJson.roadmapItems,
    };
    const result = parseAgentStateJson(noProject);
    expect(result.ok).toBe(false);
  });

  it('rejects missing roadmapItems field', () => {
    const noItems = {
      project: exampleStateJson.project,
    };
    const result = parseAgentStateJson(noItems);
    expect(result.ok).toBe(false);
  });

  it('strips _generatedAt and _generatedBy from agent input', () => {
    const agentInput = {
      _schemaVersion: 1,
      _generatedAt: 9999999999999,
      _generatedBy: 'clawchestra',
      project: exampleStateJson.project,
      roadmapItems: exampleStateJson.roadmapItems,
    };
    const result = parseAgentStateJson(agentInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('_generatedAt' in result.data).toBe(false);
      expect('_generatedBy' in result.data).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// db.json tests
// ---------------------------------------------------------------------------

describe('DbJsonSchema', () => {
  it('parses a valid db.json document', () => {
    const result = DbJsonSchema.safeParse(exampleDbJson);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.projects)).toHaveLength(1);
      expect(result.data.projects['revival-fightwear'].project.id).toBe('revival-fightwear');
      expect(Object.keys(result.data.clients)).toHaveLength(1);
    }
  });

  it('rejects missing __updatedAt siblings', () => {
    const badProject = {
      ...exampleDbJson,
      projects: {
        'test': {
          projectPath: '/test',
          project: {
            id: 'test',
            title: 'Test',
            // missing title__updatedAt
            status: 'pending',
            status__updatedAt: 1,
            description: '',
            description__updatedAt: 1,
            parentId: null,
            parentId__updatedAt: 1,
            tags: [],
            tags__updatedAt: 1,
          },
          roadmapItems: {},
        },
      },
    };
    const result = DbJsonSchema.safeParse(badProject);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JSON Schema export test
// ---------------------------------------------------------------------------

describe('generateStateJsonSchema', () => {
  it('generates a valid JSON Schema', () => {
    const schema = generateStateJsonSchema();
    expect(schema).toBeDefined();
    // Should have a definitions/properties section
    expect(typeof schema).toBe('object');
    // Should be a JSON Schema document
    expect(schema.$schema || schema.type || schema.properties).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Constants test
// ---------------------------------------------------------------------------

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });
});
