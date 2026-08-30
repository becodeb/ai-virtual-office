# Hook Performance — Measured

Measured on the actual target host (Raspberry Pi, aarch64), 20 sequential invocations each,
against both a dead port and a live listener. This is the slowest realistic hardware any friend
on the network will run, so these are worst-case numbers.

| Implementation | Dead port | Live listener |
|---|---|---|
| Bare `node -e ''` (startup floor, unavoidable) | 28 ms | — |
| Node hook (stdin + JSON + detached HTTP) | 44 ms | 40 ms |
| **POSIX `sh` + `curl`** | **3 ms** | **3 ms** |

## Decision: the hook ships as POSIX sh + curl

The Node implementation is **13x slower**, and almost all of that is Node's own process startup
— 28 ms of the 44 ms is gone before a single line of our code runs. No amount of optimising the
script recovers it.

This matters more than a normal performance number. The hook executes inside other people's
real Claude Code sessions, on every one of eight lifecycle events. On a heavily-tooled session
that is hundreds of invocations. 3 ms is invisible; 44 ms is a tax on someone else's work for
the sake of a toy on a second monitor.

```sh
#!/bin/sh
# stdin goes straight to curl. Detached, bounded, silent, always exit 0.
curl -s -m 1 -X POST -H 'content-type: application/json' \
     --data-binary @- "$OFFICE_HUB_URL/e" >/dev/null 2>&1 &
exit 0
```

Properties this shape gets for free:

- **stdin only.** The payload never touches argv or the environment, so prompt text is not
  readable from `/proc` by other local processes.
- **Silent stdout.** Required, not cosmetic: a hook that writes to stdout on
  `UserPromptSubmit` has its output injected into the user's prompt context.
- **`exit 0` unconditionally**, before curl can even fail. Hub down, DNS broken, 500, malformed
  stdin — the session never notices.
- **Bounded.** `-m 1` caps curl, and it is backgrounded anyway, so the foreground path is a
  fork and an exit.

## Fallback

`hooks/office-hook.js` (Node, zero dependencies) ships alongside for machines without `curl`.
The example `.claude/settings.json` wires the shell version by default and documents the swap
in one line. curl 8.14.1 is present on this host; Windows 10+ ships `curl.exe`, so the fallback
is genuinely an edge case rather than the common path.
