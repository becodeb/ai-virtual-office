# Proposal: AI Virtual Office

## Intent

Claude Code sessions on a home network are invisible to each other. Build a live 3D isometric office where each session is a character at a desk, driven only by real lifecycle events, running unattended on a spare monitor. A window, not a dashboard: it never controls a session.

Success: seconds after a friend starts Claude Code, a character rides the elevator in and takes a desk, at zero cost to their session.

## Scope

### In Scope
- **P0** Baseline simulation: spawn, A* path, sit, type, subagent delegation, idle, heartbeat timeout
- **P0** Zero-dependency hook script plus example `.claude/settings.json`
- **P0** WebSocket hub owning world state and the agent state machine
- **P0** Offline asset pipeline: FBX→GLB, retargeting, shared clip set
- **P0** Role classifier, HTML overlay labels, free-orbital and focus-agent cameras
- **P0** Local and production Docker Compose
- **P1** Personality wave 1: coffee runs, rubber duck, ship-it dance, zombie hour, The Architect NPC

### Out of Scope
- Auth, accounts, multi-tenant, mobile layout, control over sessions, persistence beyond in-memory state
- **P2, deferred**: merge duel, fire drill, promotion, pets, night mode, easter eggs

## Capabilities

### New Capabilities
- `session-event-hook`: payload contract, fire-and-forget, failure isolation
- `world-state-hub`: WebSocket protocol, state ownership, agent state machine, heartbeats
- `role-classification`: tool/prompt signal to role, skin, badge
- `office-simulation`: grid, A* pathfinding, desk allocation, seat sockets, subagent choreography
- `office-renderer`: R3F scene, animation blending, overlays, camera modes
- `asset-pipeline`: offline conversion, retargeting, shared clip set
- `deployment`: local versus production Compose

### Modified Capabilities
- None (greenfield)

## Approach

pnpm workspaces monorepo. `hooks/` posts an event and forgets it. `server/` is the single source of truth: classify, advance the state machine, broadcast. `client/` renders that state and invents nothing. `packages/assets-pipeline/` runs at build time only, so the browser never sees an FBX; it reuses `openspec/research/retarget-validated.mjs`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hooks/` | New | Hook script, settings example |
| `server/` | New | Hub, state machine, classifier, pathfinding |
| `client/` | New | R3F scene, overlays, cameras |
| `packages/assets-pipeline/` | New | Conversion and retargeting |
| `client/public/assets/` | New | Committed optimized GLBs |
| repo root | New | Workspace config, Compose files |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Hook degrades a friend's real session | Med | Single-digit-ms budget, detached, swallows every error, never exits non-zero |
| Retargeting never viewed in a renderer | High | Measured baselines are the regression contract; visual check gates the pipeline |
| Asset payload balloons (52 skins x 86 clips) | Med | Shared clip set plus per-skin meshes, never a cross product |
| P1 creep past the review budget | Med | Strict P0/P1/P2 ordering; P2 stays out |

## Rollback Plan

Greenfield, no consumers: revert the branch. The only external artifact is the hook entry in each user's `.claude/settings.json`; removing that line fully detaches the office, and sessions are unaffected either way. Raw `assets/` is never touched.

## Dependencies

- Raw `assets/` present locally (267MB, gitignored) to run the pipeline
- External `reverse_proxy_network` for production Compose

## Success Criteria

- [ ] A live session spawns, paths, sits, and types within seconds of `SessionStart`
- [ ] Hook cannot add perceptible latency or fail a session, even with the hub down
- [ ] Retargeted clips match the measured pelvis and foot baselines
- [ ] Subagent delegation, idle, and 15-min timeout to zombie to despawn all render
- [ ] `docker compose up` works locally; production publishes no host ports
