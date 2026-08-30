# Office Renderer Specification

## Purpose

Renders the hub's broadcast world state as a 3D scene: character overlays, camera modes, and
animation blending. The renderer invents no state of its own.

## Requirements

### Requirement: Overlay Label Content

Each visible character MUST display an overlay label showing its machine identifier, its
current agent state, and its current task summary truncated to at most 80 characters.

#### Scenario: Label shows machine, state, and truncated task

- GIVEN an agent with machine `foo-laptop`, state `ACTIVE`, and a 120-character task summary
- WHEN its overlay label renders
- THEN the label shows `foo-laptop`, `ACTIVE`, and no more than 80 characters of the task
  summary

### Requirement: Prompt Redaction Switch

When the environment variable `OFFICE_REDACT_PROMPTS` is set to `true`, every overlay label
and speech bubble MUST omit task/prompt text entirely and show only the tool name and
metadata (machine, state). Default (unset or any other value) MUST show the full truncated
task summary.

#### Scenario: Redaction hides task text

- GIVEN `OFFICE_REDACT_PROMPTS=true`
- WHEN an overlay label renders for an agent running a tool
- THEN the label shows the tool name and metadata only, with no task/prompt text

#### Scenario: Default shows task text

- GIVEN `OFFICE_REDACT_PROMPTS` is unset
- WHEN an overlay label renders
- THEN the label includes the truncated task summary

### Requirement: Camera Modes

The renderer MUST support two camera modes: a Free-Orbital camera that lets the viewer orbit,
pan, and zoom over the whole floor, and a Focus-Agent camera that follows one selected
character. The renderer MUST provide a way to switch between the two modes.

#### Scenario: Free-orbital camera views the whole floor

- GIVEN the renderer is in Free-Orbital mode
- WHEN the viewer orbits the camera
- THEN the camera is not locked to any single character

#### Scenario: Focus-agent camera follows the selected character

- GIVEN the renderer is in Focus-Agent mode with character C selected
- WHEN C moves across the floor
- THEN the camera moves to keep C in view

### Requirement: Animation Crossfade on Clip Change

When a character's animation clip changes (e.g. `Walk_Loop` to `Sitting_Enter`), the renderer
MUST blend between the outgoing and incoming clip rather than cutting instantly, so no single
frame shows an unblended pose swap.

#### Scenario: Transition from walking to sitting is blended

- GIVEN a character playing `Walk_Loop`
- WHEN it transitions to `Sitting_Enter`
- THEN the renderer crossfades between the two clips over a non-zero duration

### Requirement: Ship-It Event Labeled as Inferred

When the HUD displays a ship-it celebration event, it MUST label that event as inferred, not
as verified, since the hook only observes command shape and exit code, not test semantics.

#### Scenario: Celebration banner shows "inferred"

- GIVEN a command matching a known test-runner shape exits 0
- WHEN the HUD displays the resulting celebration
- THEN the displayed label marks the event as inferred
