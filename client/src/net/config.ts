/**
 * Resolves the hub's WebSocket URL. `VITE_OFFICE_HUB_URL` (set at build/dev
 * time) always wins; otherwise the client assumes the hub runs on the same
 * host as the page, on the server's documented default port 8787
 * (`server/src/index.ts`) — the common case for the local/dev Compose file.
 */
export const DEFAULT_HUB_PORT = 8787;

export function resolveHubWsUrl(): string {
  const override = import.meta.env.VITE_OFFICE_HUB_URL;
  if (override !== undefined && override.length > 0) return override;

  const isBrowser = typeof window !== 'undefined';
  const protocol = isBrowser && window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = isBrowser ? window.location.hostname : 'localhost';
  return `${protocol}://${host}:${DEFAULT_HUB_PORT}`;
}
