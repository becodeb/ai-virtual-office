# Tasks: AI Virtual Office

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~6500-8500 (7 capability specs, 5 workspaces, ~90 new files, ~19MB binary assets excluded from line count) |
| 400-line budget risk | High |
| 800-line budget risk | High |
| Chained PRs recommended | Yes (but overridden — see below) |
| Suggested split | Single PR (`size:exception`), sliced internally into 5 sequential passes |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

Estimate is driven by five greenfield workspaces (`hooks/`, `server/`, `client/`, `packages/shared/`, `packages/assets-pipeline/`), the WebSocket protocol, an 8-stage asset pipeline, an A*/state-machine core, an R3F scene graph, and Compose/Dockerfiles — all authored text, none generated. `review_budget_lines=800` is session-settled and `delivery_strategy=single-pr`, so per the guard this MUST ship as one PR requiring an explicit `size:exception` before `sdd-apply` proceeds. The 5 slices below are **internal implementation passes within that one PR**, not separate PRs — each is independently verifiable so a reviewer can check progress incrementally even though delivery stays single-PR.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Workspace root + assets-pipeline (FBX→GLB, retarget, export) | single PR, pass 1 | `pnpm --filter assets-pipeline test` | `pnpm assets:build` against local `assets/` (gitignored, present dev-only) | Delete `packages/assets-pipeline/`, `pnpm-workspace.yaml`; no other package depends on it at build time |
| 2 | Server/hub (state machine, A*, classifier, desks, WS protocol) | single PR, pass 2 | `pnpm --filter server test` | `pnpm --filter server dev` + `curl localhost:8080/healthz` | Delete `server/`; client/hooks have no import-time dependency |
| 3 | Hooks (sh + Node fallback + settings example) | single PR, pass 3 | `pnpm --filter hooks test` (contract test) | Manually pipe a sample `SessionStart` payload into `hooks/office-hook.sh` with hub up/down | Delete `hooks/`; remove hook line from `.claude/settings.json` |
| 4 | Client (R3F scene, animation, overlays, cameras) | single PR, pass 4 | `pnpm --filter client test` | `pnpm --filter client dev` against a running server from Unit 2 | Delete `client/`; server keeps running headless |
| 5 | Delivery (Compose, Dockerfiles, README) | single PR, pass 5 | `docker compose config` (both files) | `docker compose up` locally end-to-end | Delete Compose/Dockerfiles; workspaces still run via `pnpm dev` |

## Phase 1: Foundation + Asset Pipeline

- [x] 1.1 Create `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `vitest.workspace.ts`.
- [x] 1.2 Create `packages/shared/src/wire.ts` (hook→hub payload types) per design §1 payload shape.
- [x] 1.3 Create `packages/shared/src/protocol.ts` (WS frame types: `hello`, `snapshot`, `delta`, `event`, `pong`, client `hello`/`focus`/`egg`/`ping`) per design §3.
- [x] 1.4 Create `packages/shared/src/state.ts` defining `AgentState` enum matching design §2 transition table (`SPAWNING`, `WALKING`, `QUEUED`, `SEATED_TYPING`, `SEATED_IDLE`, `LOUNGING`, `DELEGATING`, `REPORTING`, `SLEEPING`, `ZOMBIE`, `DESPAWNING`) — 11 states satisfying world-state-hub spec's "at least" list.
- [x] 1.5 Create `packages/shared/src/skins.ts` with the 27-skin manifest from `openspec/research/skin-manifest.md` (role→skin file mapping, badges, easter-egg skins, `BaseCharacter` fallback).
- [x] 1.6 Scaffold `packages/assets-pipeline/` (`package.json`, `src/index.ts` CLI entry `pnpm assets:build`).
- [x] 1.7 Implement `src/discover.ts`: enumerate `assets/models/*.fbx`, compare sorted bone-name signatures, fail loud on >1 distinct rig. RED test: synthetic second rig signature triggers failure (asset-pipeline spec, single-rig invariant).
- [x] 1.8 Implement `src/load.ts`: headless FBX/GLB loading via `loader.parse(buf, '')`, no DOM.
- [x] 1.9 Port `openspec/research/retarget-validated.mjs` into `src/retarget.ts` unchanged in behavior: bone map with three.js-sanitised names (`FistL` not `Fist.L`), `hipBone: 'Body'`, `ikBones: ['FootL','FootR']`, `unitScale` measured at runtime (~105.38).
- [x] 1.10 RED test `src/retarget.test.ts`: assert measured pelvis/foot baselines from `openspec/research/animation-retargeting.md` for `Idle_Loop`, `Walk_Loop`, `Sitting_Idle_Loop`, `Sitting_Enter`, `Dance_Loop` (±2cm tolerance per design testing strategy).
- [x] 1.11 RED test: synthetic clip with constant pelvis Y across all sampled clips MUST fail verification (known failure-mode regression, asset-pipeline spec).
- [x] 1.12 Implement `src/verify.ts`: the pass/fail gate consuming the baselines from 1.10/1.11; wire it as pipeline stage 4.
- [x] 1.13 Implement `src/optimize.ts`: merge 96 geometry groups into 1 primitive; bake each material's flat colour into `COLOR_0`; write a per-vertex `_slot` attribute keyed to that mesh's own material index **before** indexing (decision 9 — not the seam-priority rule from design.md); convert `MeshPhongMaterial`→`MeshStandardMaterial` with `vertexColors: true`. **Deviation**: the research doc's fixed 6-name slot set (`Skin`/`Shirt`/`Pants`/`Belt`/`Face`/`Hair`) only holds for `Casual_Male` — measured across all 27 curated skins, material palettes vary widely (`Vest`, `Hat`, `Guts`, `DarkClothes`, `Bones`, …). `_slot` is recorded as the mesh's own material index instead of an index into a shared global name list; the name lookup (`slotNames[_slot]`) is now carried per-skin in `assets.json`. Decision 9's core guarantee (exact join with the `mergeVertices` dedup key) is unaffected and re-verified against real data.
- [x] 1.14 Index geometry via `mergeVertices()`; assert vertex count drops from 19476 to 8796 for the reference skin, and that `_slot` values remain integral post-merge with zero vertices whose baked colour disagrees with their `_slot` (decision 9's measured guarantee). Verified against real `Casual_Male.fbx` data in `pipeline.reference.test.ts`.
- [x] 1.15 `deleteAttribute('uv')` and `uv1`; assert no UV attribute survives export (asset-pipeline spec).
- [x] 1.16 Normalize character scale to ~1.05 world units (not 1.75 — decision/world-scale.md); apply the same scale factor to hip and IK-foot position tracks. RED test: standing height assertion within tolerance of 1.05.
- [x] 1.17 Implement `src/export.ts`: install the `FileReader` shim over `Blob.arrayBuffer()` (~15-20 lines) before `GLTFExporter`; emit one shared `animations.glb` (84 clips, no mesh) and one mesh-only GLB per curated skin (no clips). Note: the exporter uses `FileReader.onloadend`, not `onload` — the shim must implement both.
- [x] 1.18 Implement `src/props.ts`: copy Kenney prop GLBs by name (creative brief list), no conversion.
- [x] 1.19 Implement `src/manifest.ts`: emit `assets.json` (clip list + durations, per-skin `slotNames`/`_slot` map, sizes, source hashes). `slotRanges` from design.md is superseded by decision 9 (see 1.13 deviation) — ranges are no longer contiguous post-merge, so the manifest carries the per-vertex map's name lookup per skin instead.
- [x] 1.20 Ran the pipeline against the local gitignored `assets/` and generated the full committed set: `animations.glb` (2.8MB, 84 clips, 0 mesh, no `A_TPose`) and all 27 curated skins named in `openspec/research/skin-manifest.md` into `client/public/assets/` (19MB total, matching the research doc's estimate). Full run: 25.1s.
- [x] 1.21 Contract test (`offline-only.test.ts`): no `.fbx` file under the committed `client/public/assets/` output, and no source file outside `packages/assets-pipeline` imports an FBX loader or references a `.fbx` path (asset-pipeline "Offline-Only Execution" requirement). `client/` itself is scaffolded in Phase 4; this test already covers it once that lands, with no changes needed.

## Phase 2: Server / Hub

- [x] 2.1 Scaffold `server/` (`package.json`, `src/index.ts`: HTTP `POST /events` + `GET /healthz` + WS upgrade on one port, 10 Hz tick).
- [x] 2.2 Implement `server/src/world/grid.ts`: `Uint8Array` occupancy (0 free, 1 static, 2 seat), built once from `server/src/world/floor.json` (default 24×18, 12 desks).
- [x] 2.3 Implement `server/src/world/astar.ts`: 8-connected, no corner-cutting, octile heuristic `h = (dx+dy) + (√2-2)·min(dx,dy)`, binary-heap open set, deterministic tie-break (lower `h`, then lower cell index), string-pulled path smoothing.
- [x] 2.4 RED tests `server/src/world/astar.test.ts`: hand-computed octile costs, no corner-cutting through a diagonal wall gap, `null` on unreachable, byte-identical determinism across repeated runs (office-simulation spec: pathfinding + unreachable scenarios).
- [x] 2.5 Implement `server/src/world/desks.ts`: `DeskRegistry` reading `floor.json`, allocation by lowest A* cost from elevator (ties by lowest `deskId`), FIFO free list, hot-desk handoff to longest-waiting queued agent (world-state-hub spec: desk allocation + hot-desking scenarios).
- [x] 2.6 Implement `server/src/world/identity.ts`: `IdentityStore` persisting `identityKey` records (coffee count, completed tasks, rank, skin) to `/data/identities.json`, debounced 5s, flushed on `SIGTERM`; live world state never persisted.
- [x] 2.7 RED test: identity record survives simulated restart; live position state does not (world-state-hub spec, cross-restart persistence scenarios).
- [x] 2.8 Implement `packages/shared/src/classify.ts`: pure `classify(ev)`/`pickSkin(role, identityKey, machineId)`, 14-rule ordered table (role-classification spec cast table + design §7), `Confidence: 'exact'|'inferred'` on rules 2/3, `forcePush` flag on rule 1.
- [x] 2.9 RED tests `classify.test.ts`: one case per rule row, precedence collision (`.env` `Edit` → Ninja not Scribe), default fallback → Temp/`BaseCharacter`/`?` (decision 6), determinism (same input twice → same role).
- [x] 2.10 Implement `server/src/world/machine.ts`: pure `reduce(world, event, now)` reducer implementing the full transition table (design §2), including subagent choreography (walk-to-parent → speech bubble → secondary desk → report → lounge rest 15s → despawn).
- [x] 2.11 RED tests `machine.test.ts`: every transition row in the table; full `15min → SLEEPING → 2min → ZOMBIE → lap(~20s) → 3s dissolve → DESPAWNING` chain (decisions 7 & 10 — 2 min, not design's 5); desk released at `ZOMBIE`, not at removal; any event before `DESPAWNING` cancels the chain back to `SEATED_IDLE`.
- [x] 2.12 RED test: hysteresis — three consecutive same-role classifications required before the hub flips an agent's displayed role; one stray `Read` mid-build does not flip Builder→Detective.
- [x] 2.13 RED test: `ZOMBIE` state overrides displayed role to Revenant regardless of prior classification (role-classification spec, heartbeat-timeout override).
- [x] 2.14 Implement `server/src/net/ring.ts`: 256-entry delta replay ring keyed by `seq`.
- [x] 2.15 Implement `server/src/net/hub.ts`: WS upgrade, subprotocol/`hello.p` version check (`office.v1`, mismatch → `protocol_mismatch` + close 1008), snapshot-then-delta send order, reconnect resync (`lastSeq` in ring → replay; not in ring → full snapshot), `focus`/`egg`(rate-limited 3/10s, refill 1/3s)/`ping` handling, 60s idle close.
- [x] 2.16 RED tests: new client receives snapshot before any delta; reconnect triggers fresh snapshot; `lastSeq` outside ring forces full snapshot, not a partial replay (world-state-hub spec + design §3 reconnect scenarios).
- [x] 2.17 Implement `/events` payload validation: schema check against `packages/shared`, 16KB body cap, reject unknown `event` values, server-side re-truncation of all text fields (design threat-matrix row: untrusted network input). Extended per an in-flight cross-phase contract with Phase 3 (hooks): `/events` also accepts the raw, unnormalised Claude Code envelope the primary `sh` hook pipes straight through (no `v` field), normalising it server-side via `@virtual-office/shared/normalize` before validation.
- [x] 2.18 RED tests: oversized body, unknown event, missing `sessionId`, over-long text field each rejected without mutating existing world state.
- [x] 2.19 [P1] Implement coffee-run behavior: idle-triggered walk to kitchen prop, increment persisted coffee counter on `identities`.
- [x] 2.20 [P1] Implement teddy-bear debugging: 3 consecutive failing `Bash` exits → walk to `bear` prop, `Idle_Talking_Loop`; next success → bow animation state. Deviation: no dedicated "bow" clip exists among the 84 clips in `animations.glb`; uses `Yes` (the closest available affirmative/nod gesture) via a new `agent_anim` delta.
- [x] 2.21 [P1] Implement ship-it detection: command shape matches a known test-runner regex and exits 0 → broadcast `event:{kind:"confetti"}` and `dance_party`, flagged `inferred` in the payload per decision 5 (never on retry).
- [x] 2.22 [P1] Implement zombie-hour NPC behavior already covered by 2.11's state chain — add the Revenant skin swap and one-lap walk target computation (perimeter path).
- [x] 2.23 [P1] Add The Architect NPC: static desk-less agent record, `Idle_FoldArms_Loop` default; on a diff event carrying `any`/`// TODO`/>500-line-file signal (surfaced via classifier metadata), transitions briefly to `Idle_No_Loop`. Partial: the NPC, its default clip, and the reaction/reset timer are fully implemented (`server/src/world/machine.ts`'s `triggerArchitectReaction`); the trigger detector (`server/src/p1/index.ts`'s `checkArchitectSignal`) is a documented best-effort heuristic over `PostToolUse.outputSummary`, because the frozen wire contract (Phase 1's `wire.ts`) carries no actual diff content or file line count — a real implementation needs a new hook-populated `data` field, deferred to avoid an unreviewed wire-contract change while Phase 3 builds against it concurrently.

## Phase 3: Hooks

- [ ] 3.1 Create `hooks/office-hook.sh`: POSIX `sh` + `curl`, stdin piped straight to `curl -s -m 1 -X POST --data-binary @- "$OFFICE_HUB_URL/events"`, backgrounded, `exit 0` unconditional (decision 8 — primary implementation per `openspec/research/hook-performance.md`).
- [ ] 3.2 Create `hooks/office-hook.cjs`: Node fallback for hosts without `curl`, two-stage detached dispatch (stdin→child stdin, never argv/env), `uncaughtException`/`unhandledRejection`→`exit 0`, unref'd 50ms watchdog, imports limited to `node:http`, `node:crypto`, `node:os`, `node:child_process`.
- [ ] 3.3 Create `hooks/settings.example.json`: all 8 lifecycle events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`) wired to `office-hook.sh` by default, with a documented one-line swap to the `.js` fallback, and a `PreToolUse` `Task`-matcher fallback comment for pre-2.1 builds without `SubagentStart` (decision 11).
- [ ] 3.4 RED contract test `hooks/office-hook.test.ts`: spawn `office-hook.sh` (and `.js`) with no hub listening → assert `exit 0`, empty stdout, wall time < 50ms.
- [ ] 3.5 RED contract test: same script against a hub returning HTTP 500 → `exit 0`.
- [ ] 3.6 RED contract test: same script against a hub hostname that fails DNS resolution → `exit 0`.
- [ ] 3.7 RED contract test: malformed/empty stdin → no uncaught exception, `exit 0`.
- [ ] 3.8 RED contract test: assert stdout is byte-for-byte empty across all 8 event types (session-event-hook spec, failure isolation).
- [ ] 3.9 RED contract test: grep `office-hook.js` source for any non-builtin `require`/`import` — must find none (zero-dependency requirement).
- [ ] 3.10 RED contract test: assert emitted JSON payload type-checks against `packages/shared/src/wire.ts` for each of the 8 event types.
- [ ] 3.11 RED contract test: assert spawned child argv contains no payload bytes and `shell` is never enabled (subprocess argument composition, threat matrix).

## Phase 4: Client

- [x] 4.1 Scaffold `client/` (Vite + React + R3F + Tailwind config, `index.html`, `src/main.tsx`).
- [x] 4.2 Implement `client/src/net/useWorld.ts`: WS client, `office.v1` handshake, `hello{lastSeq}`, resync-on-gap logic, exponential backoff 500ms→8s ±20% jitter.
- [x] 4.3 Implement `client/src/state/store.ts`: zustand store written only by the WS client; selector-based subscriptions.
- [x] 4.4 RED integration test (ws harness): connect → snapshot → deltas → forced drop → reconnect with `lastSeq` → replay; `lastSeq` outside ring → full snapshot. Implemented against a fake `WebSocketLike` injected via `useWorld`'s factory param (`net/useWorld.test.ts`) — `server/` is a separate workspace this package must not import, so the live end-to-end path is `pnpm --filter client dev` against a running Unit 2 server, per the runtime-harness column above.
- [x] 4.5 Implement `client/src/scene/Floor.tsx`: instanced `floorFull` tiles from the layout, one grid cell = one world unit (world-scale.md).
- [x] 4.6 Implement `client/src/scene/Props.tsx`: `floorFull`/`wall` instanced via drei `<Instances>` in `Floor.tsx`; desks/chairs/sofas/kitchen/screen/bear (each mixing multiple internal sub-meshes, e.g. `desk`+`drawer`) render as cloned `<primitive>` scene graphs at low counts instead — documented engineering choice, see file header. `minY=0` placement throughout (world-scale.md).
- [x] 4.7 Implement `client/src/scene/Agent.tsx` + `Agents.tsx`: `useGLTF` load-once per skin, `SkeletonUtils.clone` per agent (never plain `.clone()`), geometry/material shared by reference.
- [x] 4.8 Implement `client/src/anim/clipMap.ts`: `AgentState`→clip-name map using verbatim names from `animations.glb`; startup assertion throws on first missing clip name (`assertClipsExist`, wired at boot in `assets/useAssetsManifest.ts`).
- [x] 4.9 Implement `client/src/anim/useAgentAnimator.ts`: one `AnimationMixer` per agent, crossfade 0.25s locomotion↔idle / 0.12s reactions, `LoopOnce`+`clampWhenFinished`+`finished` event for `Sitting_Enter→Sitting_Idle_Loop`, walk playback rate scaled to server move speed.
- [x] 4.10 RED test: transition from `Walk_Loop` to `Sitting_Enter` crossfades over non-zero duration, no single unblended frame (office-renderer spec, animation crossfade). `anim/useAgentAnimator.test.ts` drives the real `THREE.AnimationMixer` and asserts both actions carry partial weight mid-fade.
- [x] 4.11 Implement seat-socket snapping: on arrival, lerp root onto socket `position`/`facingRad` exactly, no clipping (office-simulation spec, seat-socket alignment). See `scene/agentTarget.ts`'s documented deviation: the frozen hub never re-broadcasts `position`/`agent_path` after `agent_add`, so the destination is derived from desk-occupancy + state signals instead of the exact server path.
- [x] 4.12 Implement `client/src/hud/Label.tsx`: drei `<Html occlude distanceFactor center>` anchored to head-height; shows machine id, state, task text truncated to 80 chars; redaction (driven by the hub's `hello.config.redactPrompts`) drops task/prompt text, keeps tool name + metadata.
- [x] 4.13 RED test: label with a 120-char task summary renders ≤80 chars; redaction hides task text and shows tool/metadata only (office-renderer spec: both label scenarios). `lib/label.test.ts`.
- [x] 4.14 Implement `client/src/scene/CameraRig.tsx`: Free-Orbital (`OrthographicCamera` + drei `MapControls`, clamped polar angle/zoom/pan) and Focus-Agent (lerp to `agentPos + fixedIsoOffset`, damping, follow-until-pan-or-despawn); `F` toggles; click-to-focus emits `focus`.
- [x] 4.15 RED test: Free-Orbital camera is not locked to any character; Focus-Agent camera moves to keep the selected character in view as it moves (office-renderer spec, camera modes). Focus-follow math extracted to `scene/cameraMath.ts` and unit-tested (`cameraMath.test.ts`) since mounting a real `<Canvas>`/WebGL context is out of scope for a jsdom vitest run; Free-Orbital's "not locked" property is structural (MapControls owns the camera, no per-frame override runs outside `mode==='focus'`).
- [x] 4.16 Implement `client/src/hud/*.tsx`: connection state badge, redaction badge, ship-it celebration banner explicitly labeled "inferred" (never "verified"), plus the coffee-count leaderboard.
- [x] 4.17 RED test: ship-it banner displays the "inferred" label (office-renderer spec). `hud/shipItBanner.test.ts`.
- [x] 4.18 [P1] Implement `client/src/scene/Npcs.tsx`: The Architect NPC (static, `Idle_FoldArms_Loop`/`Idle_No_Loop`), coffee-machine location marker for coffee-run rendering, bear prop interaction render (teddy-bear debugging, via `agent_anim` one-shot cues in `scene/Agent.tsx`), zombie-hour Revenant skin swap render (`scene/effectiveDisplay.ts`), ship-it `Dance_Loop` + confetti FX. Two deviations documented in-file: the wire protocol has no delta op for NPC state at all (Architect's live reaction can't animate between snapshots), and the exact server-picked Revenant skin variant isn't observable client-side (`identityKey` isn't on the wire) so it's approximated deterministically from `agentId`.
- [x] 4.19 Implement `client/src/scene/Fx.tsx`: confetti, elevator-ding, alarm, and the `moo` cow cosmetic one-shot events from `event` frames.

## Phase 5: Delivery

- [x] 5.1 Create `docker-compose.yml` (local): host port published, `OFFICE_REDACT_PROMPTS` configurable, identity volume mounted.
  - **Deviation:** one service on `8787`, not two on `8080`/`5173`. The hub serves the built client itself (`OFFICE_STATIC_DIR`), which removes the CORS surface, lets the WebSocket share the page origin, and gives a reverse proxy one upstream instead of two that must agree. HMR is `pnpm dev:client`, not a compose concern.
- [x] 5.2 Create `docker-compose.prod.yml`: `expose`-only (no `ports:`), **no external network declared** (Coolify + Traefik wire it — decision override), `restart: always`, `env_file: .env.production` with `required: false`, healthchecks on both `server` and `client`, `office_identity` named volume.
- [x] 5.3 Create `docker-compose.proxy.yml`: opt-in overlay adding `reverse_proxy_network: {external: true}` membership for the sibling-repo (`kodu`/`trellofake`) manual reverse-proxy convention.
- [x] 5.4 Create multi-stage `Dockerfile` on `node:22-alpine` (multi-arch, ARM64-safe); verify no `sharp`/`canvas` or other x86-only prebuilt-binary dependency is pulled in.
  - **Deviation:** one `runtime` target, not separate `server`/`client` targets, following 5.1. The server ships as a single 193KB esbuild bundle, so the runtime image carries no `node_modules` at all. Built and run on the real aarch64 host: 209MB, healthy.
- [x] 5.5 RED test: optional env file (`required: false`) asserted in `packages/deployment/src/compose.test.ts`.
- [x] 5.6 RED test: no service in `docker-compose.prod.yml` declares `ports:`, and none joins an external network.
- [x] 5.7 RED test: every production service defines a `healthcheck` and `restart: always`; the identity volume mounts at the same path in local and prod.
  - Also added: the hook's default hub URL and the hub's default `PORT` must match (they did not — the hook posted to 8787 while the hub listened on 8080, which silently produced an empty office), no BuildKit-only syntax, non-root user, `assets/` excluded from the build context, and no natively-built x86-only dependency installed.
- [x] 5.8 Create `.env.example` (local defaults) and `.env.production.example` (`OFFICE_HUB_URL`, `OFFICE_REDACT_PROMPTS`, `NODE_ENV`, `PORT`).
- [x] 5.9 Write root `README.md`: pnpm install, `pnpm assets:build` prerequisite (needs local gitignored `assets/`), `docker compose up` local walkthrough, production Coolify vs. manual-proxy overlay instructions, and the exact `.claude/settings.json` hook line a friend adds to point their Claude Code at the office.
- [ ] 5.10 Manual gate: visually verify retargeted clips in the running client renderer before considering the change complete (design testing strategy — numbers cannot prove a character looks right).
