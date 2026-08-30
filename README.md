# AI Virtual Office

A live 3D isometric office where every Claude Code session on your network is a little person
at a desk.

It is a window, not a dashboard. Nothing in it can stop, steer, or slow a session — it only
watches. Put it on a spare monitor and forget about it. The point is that a friend starts
Claude Code somewhere in the house, and a few seconds later somebody rides the elevator in and
takes a desk.

Every gag is driven by a real lifecycle event. Nothing is random. When a character sprints for
the fire exit, somebody really did type something alarming.

## What you will actually see

Sessions arrive by elevator, path around the furniture, and sit down to type. Subagents walk to
their parent's desk, get handed a task in a speech bubble, take a nearby desk, report back, slump
on a lounge couch for fifteen seconds, and leave.

The role classifier dresses each character from what it is doing:

| What the session did | Who shows up |
|---|---|
| `docker compose up`, `make`, an install | Builder, in a hard hat |
| ran the test suite | Medic, with a stethoscope |
| `git push --force` | **Pirate** 🏴‍☠️ |
| touched auth, secrets, a security review | Ninja |
| a build or a bundle | Cook |
| `Read` / `Grep` / `Glob` | Detective |
| `Edit` / `Write` | Scribe |
| a delete-heavy refactor | Viking |
| web search, planning, architecture | Wizard |
| anything touching a model or an embedding | Witch |
| a subagent running on Haiku | **Intern**, with a juice box |
| nothing recognisable yet | Temp — a faceless grey placeholder |

Roles update live. A character walks in as a nobody and visibly turns into a pirate the moment
it force-pushes.

Then there is the rest of it:

- **Coffee runs.** An idle character wanders to the kitchen and back. There is a leaderboard.
  Nobody asked for the leaderboard. It is the most-watched number in the app.
- **Teddy bear debugging.** Three failing `Bash` commands in a row and the character gets up,
  walks to the bear on the windowsill, and explains the problem to it. If the next command
  succeeds, it bows to the bear. Nobody else ever acknowledges the bear.
- **Ship it.** A green-looking test run sets off a ten-second office-wide dance with confetti.
  The HUD labels it *inferred*, because the hook sees exit codes, not test semantics — it will
  occasionally celebrate something that was not really a green suite.
- **Zombie hour.** A session that goes quiet for fifteen minutes falls asleep at its desk. Two
  minutes later it turns, takes the Revenant skin, and does one slow lap of the floor before
  dissolving. Long-running sessions are supposed to be unsettling.
- **The Architect.** A permanent NPC in the corner office who does nothing but fold his arms.
  When a diff introduces an `any`, a `// TODO`, or a file over 500 lines, he plays one slow head
  shake and goes back to folding his arms. He never speaks. He does not have to.

And a few things that are not documented anywhere else. The cow is real.

## Run it locally

```sh
docker compose up --build
open http://localhost:8787
```

That is the whole thing — one container, one port. The hub serves the world and the client, so
the WebSocket shares the page's origin and there is nothing to configure between them.

Then point a Claude Code session at it: see **[hooks/README.md](hooks/README.md)**. Copy one
shell script, merge one settings block, done.

## Deploy it

Production publishes **no host ports** and declares **no external network**:

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

The measured deploy target runs Coolify, whose Traefik proxy attaches the service and writes the
routing labels itself. If you instead run a manually managed reverse proxy on an external
`reverse_proxy_network` — the convention in some of the sibling repos — add the overlay:

```sh
docker compose -f docker-compose.prod.yml -f docker-compose.proxy.yml up -d
```

The base file deliberately does not reference that network, because `up` fails outright on a host
where it does not exist.

Copy `.env.production.example` to `.env.production` first. Everything is optional; the defaults
work.

## Privacy, before you put this on a wall

By default the label above each character shows a truncated summary of what that session is
working on. This usually runs on a monitor other people can see.

```sh
OFFICE_REDACT_PROMPTS=true
```

That strips every task and prompt summary, leaving tool names and metadata. The office still
works and still reads well — you just lose the speech bubbles.

The hook itself never puts your payload in argv or environment variables, so it is not readable
from `/proc` by other processes on your machine.

## Development

```sh
pnpm install
pnpm dev:server      # the hub, on :8787
pnpm dev:client      # Vite, with HMR
pnpm test            # 259 tests
pnpm typecheck
```

### Rebuilding the assets

The committed GLBs under `client/public/assets/` are generated. You only need this if you want
to change which of the 52 character skins ship, or add animation clips.

```sh
pnpm assets:build    # ~25s
```

It needs the raw `assets/` directory (267MB of FBX and GLB source), which is **gitignored** — a
fresh clone consumes the committed output and cannot regenerate it. The pipeline retargets 84
animation clips from the Unreal Mannequin skeleton onto the Quaternius character rig, merges
each character to a single draw call, and normalises everything to the world scale.

That retargeting is the interesting part of this repo and it is written up in
[`openspec/research/animation-retargeting.md`](openspec/research/animation-retargeting.md),
including the several assumptions that turned out to be wrong.

## Layout

```
hooks/                    the Claude Code hook — POSIX sh, 6ms, cannot fail your session
server/                   the hub: world state, agent state machine, A*, role classifier
client/                   React Three Fiber renderer
packages/shared/          wire types, WebSocket protocol, the classifier
packages/assets-pipeline/ offline FBX to GLB conversion and animation retargeting
openspec/                 how this was designed, and what was measured to get there
```

## Credits

Characters and animations by [Quaternius](https://quaternius.com/). Furniture from
[Kenney](https://kenney.nl/). Both CC0. The cow was their idea, not mine.
