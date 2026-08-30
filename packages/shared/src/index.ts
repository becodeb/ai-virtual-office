export * from './wire.js';
export * from './protocol.js';
export * from './state.js';
export * from './skins.js';
export * from './classify.js';

// NOTE: `normalize.ts` is intentionally NOT re-exported here. It uses
// `node:crypto` to compute `identityKey`, which is a Node-only, server-side
// concern — the hub normalises the sh hook's raw passthrough payload. This
// barrel is also imported by `client/` (browser), so pulling `node:crypto`
// in here would leak a Node built-in into the client bundle. Import it via
// the `@virtual-office/shared/normalize` subpath instead.
