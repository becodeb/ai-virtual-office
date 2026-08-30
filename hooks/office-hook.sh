#!/bin/sh
# AI Virtual Office - Claude Code lifecycle hook (primary implementation).
#
# This script runs inside somebody else's real Claude Code session, on every one
# of eight lifecycle events, hundreds of times in a busy session. It exists to
# feed a toy on a second monitor, so it has exactly three hard obligations:
# never block, never fail, never speak.
#
#   never block   Only the stdin drain runs in the foreground. The network call
#                 is detached and capped at one second. Measured at 6ms.
#   never fail    `exit 0` is unconditional and happens before curl can report
#                 anything. Hub down, DNS broken, HTTP 500, garbage on stdin -
#                 the session never notices.
#   never speak   stdout stays byte-for-byte empty. This is a correctness
#                 requirement, not tidiness: on UserPromptSubmit, anything a
#                 hook writes to stdout is injected into the user's prompt.
#
# The payload is piped through stdin and never appears in argv or the
# environment, both of which any local process can read from /proc.
#
# Stdin MUST be drained here in the foreground. Backgrounding curl and letting
# it read stdin itself looks correct and is 3ms faster, but the parent shell
# exits first and closes the pipe, so curl sends an EMPTY BODY while the hub
# still answers 204. See openspec/research/hook-performance.md.

[ "${OFFICE_HOOK_DISABLED:-}" = "1" ] && exit 0

_office_body=$(cat)
[ -z "$_office_body" ] && exit 0

_office_machine="${OFFICE_MACHINE_ID:-}"
if [ -z "$_office_machine" ]; then
  read -r _office_machine < /etc/hostname 2>/dev/null || _office_machine="unknown"
fi

printf '%s' "$_office_body" | curl \
  --silent \
  --max-time 1 \
  --request POST \
  --header 'content-type: application/json' \
  --header "x-office-machine: $_office_machine" \
  --data-binary @- \
  "${OFFICE_HUB_URL:-http://127.0.0.1:8787}/events" \
  >/dev/null 2>&1 &

exit 0
