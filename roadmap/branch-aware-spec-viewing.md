# Branch-Aware Spec/Plan Viewing

Read spec and plan documents from non-checked-out branches using `git show <branch>:<path>`, so users can view docs referenced in db.json even when the file only exists on another branch.

## Key Deliverables
- New `git_read_file_at_ref` Tauri command in commands/git.rs (uses existing `run_git_capture`)
- `specDocBranch` / `planDocBranch` optional fields in state.rs and db.json Zod schema
- Frontend fallback: if `readFile(path)` fails, try `gitReadFileAtRef` with recorded branch or scan all branches
- "Viewing from branch: X" banner in doc viewer
- DocBadge renders even when file is on another branch

## Spec
See `docs/specs/branch-aware-spec-viewing-spec.md` for full analysis.

## Status
pending

## Dependencies
- Phase 5 frontend alignment (DocBadge rendering must be wired up first)

## Key Files
- `src-tauri/src/commands/git.rs` — new command
- `src/lib/tauri.ts` — TypeScript binding
- `src/components/useProjectModal.ts` — fetchDocContent fallback logic
- `src/components/DocBadge.tsx` — sourceBranch indicator
- `src-tauri/src/state.rs` — new optional fields
