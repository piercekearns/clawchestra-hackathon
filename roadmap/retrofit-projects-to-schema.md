---
title: Retrofit Existing Projects to Schema
status: up-next
priority: 3
type: deliverable
parent: clawchestra
tags:
  - schema
  - cleanup
  - standardization
---

# Retrofit Existing Projects to Schema

Standardize all existing projects to follow the schema defined in `docs/SCHEMA.md`:

## Tasks

- [ ] Rename `CONTEXT.md` → `PROJECT.md` where used (e.g., ClawOS)
- [ ] Add proper frontmatter to all project files (title, status, type, priority)
- [ ] Move documentation files to `docs/` subdirectories
- [ ] Move roadmap items to `roadmap/` subdirectories  
- [ ] Ensure sub-projects declare `parent:` field
- [ ] Remove/simplify skip lists in app once standardized

## Affected Projects

- `nostr/clawos` — uses CONTEXT.md
- `nostr/memestr` — check structure
- `nostr/botfather` — check structure
- `revival/` — check structure
- `the-restricted-section/` — check structure
- `personal-site/` — check structure

## Success Criteria

- All projects discoverable via `PROJECT.md` with valid frontmatter
- No skip lists needed in `src-tauri/src/lib.rs`
- Clean separation: projects → PROJECT.md, docs → docs/, roadmap → roadmap/
