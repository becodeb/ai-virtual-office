# AI Virtual Office — Creative Brief

A live 3D diorama of an office where every Claude Code session on the network is a little
person at a desk. It runs on a second monitor all day. It is meant to be *watched*, not
operated — the joke has to land without anyone touching a control.

The rule that governs every feature below: **the office is funny because it is honest**.
Every gag is driven by a real event from a real session. Nothing is random. When a character
sprints for the exit, somebody really did type something alarming.

## Props note

Every prop named in this brief was verified to exist in `assets/office/kenneykit` as a `.glb`:
`desk`, `deskCorner`, `chairDesk`, `computerScreen`, `computerKeyboard`, `laptop`,
`kitchenCoffeeMachine`, `loungeSofa`, `loungeSofaCorner`, `loungeChairRelax`, `tableCoffee`,
`wall`, `wallWindow`, `wallDoorway`, `doorwayOpen`, `floorFull`, `pottedPlant`, `plantSmall1`,
`bookcaseOpen`, `trashcan`, `lampSquareFloor`, `rugRectangle`, `stoolBar`, `kitchenBar`,
`televisionModern`, `cardboardBoxOpen`, `bear`, `ceilingFan`.

## Cast

52 character skins ship in the asset pack. The role classifier picks one from the tool or
prompt that triggered the event, so the office reads at a glance.

| Role | Trigger | Skin | Badge |
|---|---|---|---|
| Builder | `Bash`, `docker`, `make`, install | `Worker_Male` / `Worker_Female` | hard hat |
| Cook | build / compile / bundle | `Chef_Male` / `Chef_Female` | pot |
| Scribe | `Edit`, `Write`, `NotebookEdit` | `Casual_Male` / `Casual_Female` | keyboard |
| Detective | `Read`, `Grep`, `Glob` | `OldClassy_Male` / `OldClassy_Female` | magnifier |
| Medic | test runs, `vitest`, `pytest` | `Doctor_*_Young` | stethoscope |
| Pirate | `git push`, especially `--force` | `Pirate_Male` / `Pirate_Female` | flag |
| Ninja | auth, secrets, security review | `Ninja_Male` / `Ninja_Female` | shuriken |
| Wizard | `WebSearch`, `WebFetch`, planning | `Wizard` | crystal ball |
| Viking | refactor, delete, rename | `Viking_Male` / `Viking_Female` | axe |
| Witch | anything touching a model or an embedding | `Witch` | sparkles |
| Intern | Haiku-model subagents | `Casual_Bald` | juice box |
| Revenant | heartbeat timeout | `Zombie_Male` / `Zombie_Female` | tombstone |

## The floor

An isometric diorama on a 1x1m grid, furnished from the 140 Kenney props. Desks with chairs
that have a seat socket the character aligns to. A lounge with couches. A kitchen with a
coffee machine. A meeting room with a delegation screen (`televisionModern`, since the kit ships no
whiteboard). An elevator that dings on arrival, and a fire exit that only ever gets used for
one reason.

## Behaviour, in ascending order of ridiculousness

**Baseline.** Spawn from the elevator, A* to a free desk, sit, type. Subagents walk to their
parent's desk, get handed a task in a speech bubble, then take a nearby desk. When they
finish they report back, slump on a lounge couch for 15 seconds, and leave. Sessions that go
quiet for 15 minutes fall asleep at the desk before fading out.

**Coffee runs.** An idle character walks to the kitchen and comes back. A per-character
coffee counter runs in the HUD. Nobody asked for this leaderboard; it is the most-watched
number in the app.

**Teddy bear debugging.** The Kenney kit has no rubber duck, but it does have `bear`. Three
consecutive failing `Bash` exits and the character stands up, walks to the bear on the
windowsill, and explains the problem to it with `Idle_Talking_Loop`. If the next command
succeeds, it bows to the bear. The bear is never acknowledged by anyone else.

**The merge conflict duel.** Two sessions editing the same file inside the same window walk
to the centre of the floor and fight it out with `Sword_Regular_Combo`. The one whose write
landed first wins. The loser goes to the lounge.

**Fire drill.** A destructive command pattern (`rm -rf`, `DROP TABLE`, `--force` onto a
protected branch) sets off the alarm. Every character on the floor drops to `Sprint_Loop`
and evacuates through the fire exit, then sheepishly files back in.

**Ship it.** A green test suite or a successful commit triggers `Dance_Loop` across the whole
office for ten seconds. Confetti. This is the reward loop and it must feel earned, so it only
fires on a real pass, never on a retry.

**Zombie hour.** A session past the heartbeat timeout does not simply vanish. It turns, gets
the Revenant skin, and does one slow `Zombie_Walk_Fwd_Loop` lap of the floor before
dissolving. Long-running sessions are supposed to be unsettling.

**The Architect.** A permanent NPC in the corner office who does nothing but
`Idle_FoldArms_Loop`. When a diff introduces `any`, a `// TODO`, or a file over 500 lines, he
plays `Idle_No_Loop` — a single slow head shake — and goes back to folding his arms. He never
speaks. He does not have to.

**Promotion.** Accumulated completed tasks upgrade a returning session's skin to `Suit_Male` /
`Suit_Female` and reserve it a desk by the window. Corner office is earned, never assigned.

**Pets.** `Pug.fbx` is in the asset pack, so there is an office dog. It follows whichever
character has been busiest for the last minute. `Cow.fbx` is also in the asset pack. There is
no good reason for the cow. Typing `moo` spawns it.

**Night mode.** Real wall-clock after hours: lights dim, the floor empties, and anyone still
working gets a desk lamp. Weekend sessions get it too, with a slightly sadder lamp.

## Easter eggs

- Konami code forces a dance party.
- `moo` spawns the cow.
- Clicking the coffee machine five times makes every character stop and stare at you.
- A character that has been idle for a very long time starts `Idle_TalkingPhone_Loop`.
- The delegation screen in the meeting room shows the last delegated subagent task, verbatim.
- One in a thousand spawns arrives as `Cowboy_Male`. No trigger, no explanation, no repeat.

## Non-goals

- No control over the sessions. This is a window, not a dashboard. Nothing here can stop,
  start, or steer a Claude Code run.
- No login, no accounts, no multi-tenant. It runs on a home network among friends.
- No mobile layout. It lives on a spare monitor.
