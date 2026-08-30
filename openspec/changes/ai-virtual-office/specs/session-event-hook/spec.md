# Session Event Hook Specification

## Purpose

A zero-dependency script invoked by Claude Code's lifecycle hooks that forwards each event
to the world-state hub and immediately returns control to the calling session, regardless of
network outcome.

## Requirements

### Requirement: Zero-Dependency Runtime

The hook script MUST run using only Node.js built-in modules. It MUST NOT declare or require
any npm package dependency.

#### Scenario: No package.json dependencies

- GIVEN the hook script's package manifest (if any)
- WHEN its `dependencies` and `devDependencies` are inspected
- THEN both MUST be empty or absent

### Requirement: Non-Blocking Fire-and-Forget Dispatch

The hook MUST detach its outbound HTTP request to the hub and return control to the calling
Claude Code process within single-digit milliseconds (< 10ms of process start), without
awaiting the hub's response.

#### Scenario: Hook returns before the network call resolves

- GIVEN the hub is reachable but slow to respond
- WHEN the hook script is invoked with a valid lifecycle payload on stdin
- THEN the process exits within 10ms
- AND it does not block on the HTTP response

### Requirement: Universal Exit Success

The hook MUST exit with code 0 under every condition, including a hub that is unreachable, a
hub that returns HTTP 500, DNS resolution failure, and malformed input on stdin. The hook
MUST NOT propagate any error to the calling session.

#### Scenario: Hub unreachable (connection refused)

- GIVEN the hub process is not running
- WHEN the hook attempts to POST the event
- THEN the hook exits 0

#### Scenario: Hub returns HTTP 500

- GIVEN the hub responds with a 500 status
- WHEN the hook receives that response (if it observes it at all)
- THEN the hook exits 0

#### Scenario: DNS resolution failure

- GIVEN the hub hostname does not resolve
- WHEN the hook attempts the request
- THEN the hook exits 0

#### Scenario: Malformed stdin payload

- GIVEN stdin contains invalid JSON or is empty
- WHEN the hook parses it
- THEN the hook does not throw an uncaught exception
- AND the hook exits 0

### Requirement: Lifecycle Event Coverage

The hook MUST handle every Claude Code lifecycle hook event: `SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop`, and
`SessionEnd`. For each, it MUST forward a payload identifying the event type, the session's
`identityKey` inputs (machine identifier and absolute project path), and event-specific data
available on stdin (e.g. tool name for `PreToolUse`/`PostToolUse`, prompt text for
`UserPromptSubmit`).

#### Scenario: Each event type is forwarded

- GIVEN the hook is invoked once for each of the 8 lifecycle events with valid stdin
- WHEN each invocation completes
- THEN each produces a distinct outbound payload tagged with its event type
- AND each invocation exits 0

### Requirement: Failure Isolation From the Calling Session

A hook invocation MUST NOT alter the exit code, stdout, or stderr behavior that the calling
Claude Code session relies on to continue normally, regardless of hub state.

#### Scenario: Session continues unaffected when hub is down for the entire session

- GIVEN the hub is down for an entire Claude Code session
- WHEN every lifecycle event fires and invokes the hook
- THEN the session proceeds exactly as it would with the hook uninstalled
