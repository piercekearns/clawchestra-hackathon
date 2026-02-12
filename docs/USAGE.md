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
- `PIPELINE_PROJECTS_DIR` (optional, Rust side): defaults to `/Users/piercekearns/clawdbot-sandbox/projects`
