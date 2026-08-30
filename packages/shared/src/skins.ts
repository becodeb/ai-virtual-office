/**
 * The curated 27-skin manifest, per `openspec/research/skin-manifest.md`.
 *
 * The pipeline (`packages/assets-pipeline`) converts only these 27 FBX files
 * into `client/public/assets/characters/<Skin>.glb`. The other 25 skins in
 * the raw pack stay available for on-demand regeneration but are not
 * committed.
 */
import type { Role } from './state.js';

/** Base filename (without extension) of every curated skin, as it exists in `assets/models/`. */
export type SkinName =
  | 'Worker_Male'
  | 'Worker_Female'
  | 'Chef_Male'
  | 'Chef_Female'
  | 'Casual_Male'
  | 'Casual_Female'
  | 'OldClassy_Male'
  | 'OldClassy_Female'
  | 'Doctor_Male_Young'
  | 'Doctor_Female_Young'
  | 'Pirate_Male'
  | 'Pirate_Female'
  | 'Ninja_Male'
  | 'Ninja_Female'
  | 'Wizard'
  | 'Viking_Male'
  | 'Viking_Female'
  | 'Witch'
  | 'Casual_Bald'
  | 'Zombie_Male'
  | 'Zombie_Female'
  | 'Suit_Male'
  | 'Suit_Female'
  | 'BaseCharacter'
  | 'Cowboy_Male'
  | 'Pug'
  | 'Cow';

/** The fallback skin for any unclassified worker (decision 6). */
export const FALLBACK_SKIN: SkinName = 'BaseCharacter';

/** The fallback role for any input the classifier does not recognise (decision 6). */
export const FALLBACK_ROLE: Role = 'Temp';

export const FALLBACK_BADGE = '?';

export interface RoleSkinEntry {
  role: Role;
  /** One or more skin variants for this role (e.g. Male/Female pairs). */
  skins: SkinName[];
  badge: string;
}

/** Role -> skin(s) -> badge mapping. `Temp` is listed for completeness; see `FALLBACK_*` above. */
export const ROLE_SKIN_TABLE: readonly RoleSkinEntry[] = [
  { role: 'Builder', skins: ['Worker_Male', 'Worker_Female'], badge: 'hard hat' },
  { role: 'Cook', skins: ['Chef_Male', 'Chef_Female'], badge: 'pot' },
  { role: 'Scribe', skins: ['Casual_Male', 'Casual_Female'], badge: 'keyboard' },
  { role: 'Detective', skins: ['OldClassy_Male', 'OldClassy_Female'], badge: 'magnifier' },
  { role: 'Medic', skins: ['Doctor_Male_Young', 'Doctor_Female_Young'], badge: 'stethoscope' },
  { role: 'Pirate', skins: ['Pirate_Male', 'Pirate_Female'], badge: 'flag' },
  { role: 'Ninja', skins: ['Ninja_Male', 'Ninja_Female'], badge: 'shuriken' },
  { role: 'Wizard', skins: ['Wizard'], badge: 'crystal ball' },
  { role: 'Viking', skins: ['Viking_Male', 'Viking_Female'], badge: 'axe' },
  { role: 'Witch', skins: ['Witch'], badge: 'sparkles' },
  { role: 'Intern', skins: ['Casual_Bald'], badge: 'juice box' },
  { role: 'Revenant', skins: ['Zombie_Male', 'Zombie_Female'], badge: 'tombstone' },
  { role: 'Promoted', skins: ['Suit_Male', 'Suit_Female'], badge: 'tie' },
  { role: 'Temp', skins: [FALLBACK_SKIN], badge: FALLBACK_BADGE },
];

/** Easter-egg skins: not reachable through role classification. */
export interface EasterEggSkin {
  purpose: string;
  skin: SkinName;
}

export const EASTER_EGG_SKINS: readonly EasterEggSkin[] = [
  { purpose: '1-in-1000 spawn', skin: 'Cowboy_Male' },
  { purpose: 'Office dog', skin: 'Pug' },
  { purpose: 'The cow (moo)', skin: 'Cow' },
];

/** All 27 curated skin names, deduplicated, role table + easter eggs. */
export const CURATED_SKINS: readonly SkinName[] = Array.from(
  new Set<SkinName>([
    ...ROLE_SKIN_TABLE.flatMap((entry) => entry.skins),
    ...EASTER_EGG_SKINS.map((entry) => entry.skin),
  ])
);

export function skinsForRole(role: Role): SkinName[] {
  const entry = ROLE_SKIN_TABLE.find((row) => row.role === role);
  return entry ? entry.skins : [FALLBACK_SKIN];
}

export function badgeForRole(role: Role): string {
  const entry = ROLE_SKIN_TABLE.find((row) => row.role === role);
  return entry ? entry.badge : FALLBACK_BADGE;
}
