# Joining the office

Point your Claude Code at a running hub and a character shows up at a desk within seconds.

## 1. Copy the hook

The hook can live anywhere. Two common choices:

```sh
# per project
mkdir -p .claude && cp /path/to/ai-virtual-office/hooks/office-hook.sh .claude/

# or once, for every project on your machine
mkdir -p ~/.claude && cp /path/to/ai-virtual-office/hooks/office-hook.sh ~/.claude/
```

## 2. Wire it up

Merge `settings.example.json` into your `.claude/settings.json` (project) or
`~/.claude/settings.json` (global), adjusting the path to wherever you put the script, and
`OFFICE_HUB_URL` to wherever the hub is running.

All eight lifecycle events are wired. Drop any you would rather not send — the office degrades
gracefully and simply shows less.

## 3. That's it

There is no login and nothing to configure per person. Your character is derived from your
hostname and the project path, so the same project on the same machine is always the same
character, across restarts.

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `OFFICE_HUB_URL` | `http://127.0.0.1:8787` | Where the hub lives |
| `OFFICE_MACHINE_ID` | your hostname | Overrides the name shown on your character's label |
| `OFFICE_REDACT_PROMPTS` | unset | `true` strips all task and prompt text, leaving tool names only |
| `OFFICE_HOOK_DISABLED` | unset | `1` makes the hook a no-op without unwiring it |

`OFFICE_REDACT_PROMPTS` is worth knowing about before you turn the office on: by default,
labels above your character show a truncated summary of what you are working on, and this
usually runs on a monitor other people can see.

## Which script?

`office-hook.sh` is the default and what you want. It is POSIX `sh` plus `curl`, measured at
**6 ms** per invocation.

`office-hook.js` is a fallback for hosts without `curl`. It is correct and equally safe, but
**44 ms** per invocation — almost entirely Node's own process startup, which no amount of
optimisation recovers. On a busy session that is hundreds of invocations, so prefer the shell
version unless you cannot run it. Swap the `command` value in your settings to the `.js` path.

## What this can and cannot do to your session

The hook is built so that its worst day is invisible to you:

- It **always** exits 0. Hub down, DNS broken, HTTP 500, garbage on stdin — same result.
- It **never** writes to stdout. This matters more than it sounds: on `UserPromptSubmit`,
  anything a hook prints to stdout gets injected straight into your prompt context.
- Your payload goes through **stdin only**, never argv or environment variables, so it is not
  readable from `/proc` by other processes on your machine.
- The network call is detached and capped at one second. Only draining stdin is synchronous.

It observes. It cannot stop, steer, or slow a session — there is no path in the code that
returns a blocking decision to Claude Code.

## Older Claude Code builds

`SubagentStart` is verified present in Claude Code 2.1.251. On builds without it, subagents
appear when they *finish* rather than when they start — the hub distinguishes events by name,
so an absent event degrades instead of breaking. To approximate the spawn on an older build,
add a `PreToolUse` entry with `"matcher": "Task"`.
