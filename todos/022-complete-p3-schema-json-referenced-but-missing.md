---
status: complete
priority: p3
issue_id: "022"
tags: [code-review, agent-native, architecture-direction-v2]
dependencies: []
---

# schema.json referenced in agent injection but never generated

## Problem Statement

The CLAUDE.md injection text (injection.rs:28) tells agents: `**Schema:** See .clawchestra/schema.json for the full JSON Schema definition.` But no code generates this file — it does not exist. Agents following this instruction waste a tool call on a missing file and get no schema reference.

Additionally, `_schemaVersion` is a required field (no `#[serde(default)]`) but is not mentioned in the injection text. An agent omitting it will cause a silent parse failure.

## Proposed Solutions

### Option A: Generate schema.json during ensure_clawchestra_dir
- **Pros:** Agents get a real schema reference; self-documenting
- **Effort:** Medium (need to define JSON Schema)

### Option B: Remove the schema.json reference from injection text
- **Pros:** No false promises; simple
- **Effort:** Small

### Option C: Add full state.json example to CLAUDE.md injection instead
- **Pros:** Agents see a complete valid document; no separate file needed
- **Effort:** Small

## Technical Details

**Affected files:** `src-tauri/src/injection.rs` (line 28)

## Acceptance Criteria

- [ ] Agent injection text does not reference nonexistent files
- [ ] OR schema.json is generated and available
- [ ] Required envelope fields (_schemaVersion, _generatedAt, _generatedBy) are documented

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by Agent-Native agent |
