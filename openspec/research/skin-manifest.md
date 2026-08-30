# Curated Skin Manifest

Every filename below was verified to exist in `assets/models/` (52 files total). The pipeline
converts **only these 27**; the other 25 stay available for regeneration from the gitignored
raw assets but are not committed.

At the measured 592 KB per merged/indexed character, 27 skins is about **16 MB**, plus the
shared 2.8 MB `animations.glb` — roughly **19 MB committed**. That supersedes the earlier
"~16 skins / 12 MB" estimate, which was made before the cast table was reconciled against the
actual file list.

| Role | Skin file(s) | Badge |
|---|---|---|
| Builder | `Worker_Male`, `Worker_Female` | hard hat |
| Cook | `Chef_Male`, `Chef_Female` | pot |
| Scribe | `Casual_Male`, `Casual_Female` | keyboard |
| Detective | `OldClassy_Male`, `OldClassy_Female` | magnifier |
| Medic | `Doctor_Male_Young`, `Doctor_Female_Young` | stethoscope |
| Pirate | `Pirate_Male`, `Pirate_Female` | flag |
| Ninja | `Ninja_Male`, `Ninja_Female` | shuriken |
| Wizard | `Wizard` | crystal ball |
| Viking | `Viking_Male`, `Viking_Female` | axe |
| Witch | `Witch` | sparkles |
| Intern | `Casual_Bald` | juice box |
| Revenant | `Zombie_Male`, `Zombie_Female` | tombstone |
| Promoted | `Suit_Male`, `Suit_Female` | tie |
| **Temp (fallback)** | `BaseCharacter` | `?` |

Easter-egg extras, not part of classification:

| Purpose | File |
|---|---|
| 1-in-1000 spawn | `Cowboy_Male` |
| Office dog | `Pug` |
| The cow (`moo`) | `Cow` |

`Pug` and `Cow` share the same rig as every other character, so they animate from the same
shared clip set. A dog playing `Walk_Loop` on a humanoid rig is a known and accepted
consequence, and is funnier than rigging a correct quadruped gait.
