# Role Classification Specification

## Purpose

A deterministic function mapping the tool or prompt signal that triggered a lifecycle event
to a role (skin family and badge), so the office reads at a glance.

## Requirements

### Requirement: Deterministic Classification

Given the same input signal (tool name, command text, and/or prompt content), the classifier
MUST always return the same role. It MUST NOT depend on randomness, wall-clock time, or any
state outside the given input.

#### Scenario: Same input yields the same role every time

- GIVEN the input signal `{ tool: "Bash", command: "docker build ." }`
- WHEN the classifier is invoked twice with that identical input
- THEN both invocations return the same role

### Requirement: Total Function With Documented Fallback

The classifier MUST return exactly one role for every possible input, including signals that
match none of the documented cast-table triggers. When no rule matches, the classifier MUST
return a documented fallback role rather than an error, `null`, or `undefined`.

#### Scenario: Unrecognized tool falls back

- GIVEN a tool name and command that match no cast-table rule
- WHEN the classifier is invoked
- THEN it returns the documented fallback role, not an error

### Requirement: Cast Table Mapping

The classifier MUST implement the following trigger-to-role mapping, sourced from the
creative brief cast table:

| Role | Trigger |
|---|---|
| Builder | `Bash`, `docker`, `make`, install commands |
| Cook | build / compile / bundle commands |
| Scribe | `Edit`, `Write`, `NotebookEdit` |
| Detective | `Read`, `Grep`, `Glob` |
| Medic | test runs (`vitest`, `pytest`, etc.) |
| Pirate | `git push`, especially `--force` |
| Ninja | auth, secrets, or security-review signals |
| Wizard | `WebSearch`, `WebFetch`, planning signals |
| Viking | refactor, delete, rename signals |
| Witch | anything touching a model or an embedding |
| Intern | subagent running on a Haiku-class model |

#### Scenario: Bash install command classifies as Builder

- GIVEN input `{ tool: "Bash", command: "npm install" }`
- WHEN classified
- THEN the result role is Builder

#### Scenario: Force push classifies as Pirate

- GIVEN input `{ tool: "Bash", command: "git push --force" }`
- WHEN classified
- THEN the result role is Pirate

### Requirement: Fixed Precedence for Overlapping Triggers

When an input signal matches more than one cast-table rule simultaneously, the classifier
MUST apply one fixed, documented precedence order across all rules so the result stays
deterministic.

#### Scenario: A command matching two rules resolves via precedence

- GIVEN an input signal matching both the Ninja rule (secrets) and the Builder rule (`Bash`)
- WHEN classified
- THEN the classifier returns the single role defined by the documented precedence order,
  consistently across repeated invocations

### Requirement: Heartbeat-Timeout Override

The `ZOMBIE` agent state (see world-state-hub) MUST override any tool/prompt-derived role
with the Revenant role, regardless of what signal last classified the agent.

#### Scenario: Timed-out agent displays as Revenant

- GIVEN an agent last classified as Builder before going quiet
- WHEN the hub transitions that agent to `ZOMBIE`
- THEN the effective displayed role is Revenant, not Builder
