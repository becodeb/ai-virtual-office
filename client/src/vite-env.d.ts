/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the WS hub URL derived from `window.location`. See `net/config.ts`. */
  readonly VITE_OFFICE_HUB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
