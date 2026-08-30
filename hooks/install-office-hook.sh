#!/bin/sh
# AI Virtual Office — friend installer.
# Installs the hook globally (~/.claude) so every LOCAL Claude Code session on
# THIS machine reports to the shared office. It cannot see or report any other
# machine's session — the hook only ever reads this machine's own hostname.
set -eu

HUB_URL="${1:-https://office.mastropietro.work.gd}"
DEST="$HOME/.claude"
mkdir -p "$DEST"

cat > "$DEST/office-hook.sh" <<'HOOK_EOF'
#!/bin/sh
[ "${OFFICE_HOOK_DISABLED:-}" = "1" ] && exit 0
_office_body=$(cat)
[ -z "$_office_body" ] && exit 0
_office_machine="${OFFICE_MACHINE_ID:-}"
if [ -z "$_office_machine" ]; then
  read -r _office_machine < /etc/hostname 2>/dev/null || _office_machine="unknown"
fi
printf '%s' "$_office_body" | curl \
  --silent --max-time 1 --request POST \
  --header 'content-type: application/json' \
  --header "x-office-machine: $_office_machine" \
  --data-binary @- \
  "${OFFICE_HUB_URL:-http://127.0.0.1:8787}/events" \
  >/dev/null 2>&1 &
exit 0
HOOK_EOF
chmod +x "$DEST/office-hook.sh"

HOOK_BLOCK=$(cat <<JSON
{
  "env": { "OFFICE_HUB_URL": "$HUB_URL" },
  "hooks": {
    "SessionStart":  [ { "matcher": "", "hooks": [ { "type": "command", "command": "\"\$HOME\"/.claude/office-hook.sh || true" } ] } ],
    "UserPromptSubmit": [ { "matcher": "", "hooks": [ { "type": "command", "command": "\"\$HOME\"/.claude/office-hook.sh || true" } ] } ],
    "PreToolUse":    [ { "matcher": "*", "hooks": [ { "type": "command", "command": "\"\$HOME\"/.claude/office-hook.sh || true" } ] } ],
    "PostToolUse":   [ { "matcher": "*", "hooks": [ { "type": "command", "command": "\"\$HOME\"/.claude/office-hook.sh || true" } ] } ],
    "SubagentStart": [ { "matcher": "", "hooks": [ { "type": "command", "command": "\"\$HOME\"/.claude/office-hook.sh || true" } ] } ],
    "SubagentStop":  [ { "matcher": "", "hooks": [ { "type": "command", "command": "\"\$HOME\"/.claude/office-hook.sh || true" } ] } ],
    "Stop":          [ { "matcher": "", "hooks": [ { "type": "command", "command": "\"\$HOME\"/.claude/office-hook.sh || true" } ] } ],
    "SessionEnd":    [ { "matcher": "", "hooks": [ { "type": "command", "command": "\"\$HOME\"/.claude/office-hook.sh || true" } ] } ]
  }
}
JSON
)

SETTINGS="$DEST/settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo "$HOOK_BLOCK" > "$SETTINGS"
  echo "Listo: se creo $SETTINGS desde cero."
else
  echo ""
  echo "Ya tenes un $SETTINGS. No lo toco para no romper tu config."
  echo "Sumale este bloque a mano (mergeando 'env' y 'hooks' con lo que ya tengas):"
  echo ""
  echo "$HOOK_BLOCK"
fi

echo ""
echo "Hook instalado en $DEST/office-hook.sh, apuntando a $HUB_URL"
