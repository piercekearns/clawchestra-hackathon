# Pipeline Dashboard Usage

## Start in browser mode

```bash
pnpm install
pnpm dev
```

## Start in Tauri mode

```bash
pnpm install
pnpm tauri:dev
```

## Environment variables

- `VITE_GATEWAY_URL` (optional): defaults to `http://localhost:18789`
- `PIPELINE_PROJECTS_DIR` (optional, Rust side): overrides catalog entries directory resolution when set. Default behavior uses Dashboard settings (`catalogRoot`, then `catalogRoot/projects` when present).
