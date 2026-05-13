# Islandflow Desktop Shell

This workspace packages a thin Electron shell around the hosted Islandflow app.

## What It Does

- Loads `https://flow.deltaisland.io` by default.
- Supports local UI development against `http://127.0.0.1:3000`.
- Preserves the existing remote API and WebSocket behavior from the web app.
- Keeps Electron privileges locked down for remote content.

## What It Does Not Do

- Bundle a local backend.
- Ship a packaged local Next.js renderer in v1.
- Add desktop-native features beyond launch, windowing, and packaging.

## Workspace Commands

- `bun run start` builds the main process and launches Electron Forge in dev mode.
- `bun run package` creates a packaged unsigned macOS app bundle.
- `bun run make` creates a macOS zip distributable for the current host architecture.
- `bun run test` runs the desktop URL-policy tests.

## Development Notes

- `ISLANDFLOW_DESKTOP_START_URL` controls which trusted app URL Electron loads.
- `NEXT_PUBLIC_API_URL` remains a web-app setting and should typically be `https://flow.deltaisland.io` when developing the local UI inside Electron.
- `assets/` currently contains placeholders only; a real `.icns` icon is deferred.
