# Branch-Aware Spec/Plan Viewing

Read spec and plan documents from non-checked-out branches using `git show <branch>:<path>`, and from non-local devices using db.json content snapshots. Users can view docs referenced in db.json regardless of which branch they're on or which device they're using.

## Key Deliverables
- New `git_read_file_at_ref` Tauri command in commands/git.rs (uses existing `run_git_capture`)
- `specDocBranch` / `planDocBranch` optional fields in state.rs and db.json Zod schema
- `specDocContent` / `planDocContent` content snapshot fields for cross-device document access
- Frontend fallback chain: local file → staleness check → db.json content → gitReadFileAtRef → branch scan → "not found"
- "Viewing from branch: X" banner in doc viewer
- DocBadge renders even when file is on another branch
- Staleness detection via `__updatedAt` timestamp comparison (replaces cut blob SHA approach)
- Continuous sync (Phase 6.6) keeps content snapshots current across devices
- Write-back mechanism (simplified): content edits via mobile auto-update git files on device with repo (non-conflict case; LWW for conflicts — conflict UI deferred to Phase 8+)
- `?fields=index` extension param (backend only — frontend doesn't use progressive loading for v1)

## Spec
See `docs/specs/branch-aware-spec-viewing-spec.md` for full analysis.

## Status
in-progress — now part of Phases 5.20, 5.21, 6.6 of the architecture-direction plan (Phases 6.8 and 7.4 were cut during architectural review)

## Next Action
Phase 5.20 code implemented (Rust command, TS wrapper, schema fields, frontend fallback, UI indicators). Phase 5.21 revised: content fields with `__updatedAt` timestamps replace blob SHA freshness. Round 4+5 reviews applied: CAS cut, write-back simplified (LWW for conflicts), progressive loading frontend cut, Phase 7.5 cut, extension versioning simplified, LRU cache cut, clock skew detection cut, force re-migrate cut, specDocBranch fields verified (already exist). Awaiting Phase 5 frontend alignment completion for full integration.

## Dependencies
- Phase 5 frontend alignment (DocBadge rendering must be wired up first)
- Phase 5.18 (useProjectModal.ts rewrite — fetchDocContent fallback is wired here)
- Phase 6.6 (continuous sync — delivers cross-device content sync)

## Key Files
- `src-tauri/src/commands/git.rs` — git_read_file_at_ref command
- `src/lib/tauri.ts` — TypeScript bindings
- `src/hooks/useProjectModal.ts` — fetchDocContent fallback logic
- `src/components/modal/DocBadge.tsx` — sourceBranch indicator
- `src/components/modal/RoadmapItemDetail.tsx` — branch banner
- `src-tauri/src/state.rs` — branch and content fields
- `src-tauri/src/merge.rs` — auto-capture content during merge (5.21.2)
- `src-tauri/src/sync.rs` — continuous sync + write-back mechanism
