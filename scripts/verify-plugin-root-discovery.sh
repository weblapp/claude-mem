#!/bin/bash
# Verify the plugin-root discovery fix WITHOUT building or installing anything.
#
# Runs the discovery prelude of the UserPromptSubmit hook standalone — the same
# shell Claude Code runs, truncated just before `node ... worker-service.cjs` —
# on this branch and on its merge-base with main, and prints what each resolved.
#
#   bash scripts/verify-plugin-root-discovery.sh            # from the worktree
#   bash scripts/verify-plugin-root-discovery.sh <worktree> # from anywhere
#
# Touches nothing outside a mktemp dir. Never writes to ~/.claude-mem or
# ~/.claude/plugins.
set -u
WT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BEFORE=$(git -C "$WT" merge-base HEAD main)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

extract() { # $1=ref  $2=outfile
  git -C "$WT" show "$1:plugin/hooks/hooks.json" | python3 -c '
import json,sys
c = json.load(sys.stdin)["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"]
m = "; node \"$_P/scripts/bun-runner.js\""
print("#!/bin/bash"); print(c.split(m)[0] + "; printf \"RESOLVED=%s\\n\" \"$_P\"")' > "$2"
}
extract HEAD     "$TMP/after.sh"
extract "$BEFORE" "$TMP/before.sh"
echo "worktree: $WT"
echo "before:   $BEFORE   after: $(git -C "$WT" rev-parse --short HEAD)"

echo
echo "== 1. BEFORE, both env vars unset — expect 'not found', exit 1, NO trace on disk =="
env -u CLAUDE_PLUGIN_ROOT -u PLUGIN_ROOT CLAUDE_MEM_DATA_DIR="$TMP/md1" bash "$TMP/before.sh"; echo "   exit=$?"
echo "   files under CLAUDE_MEM_DATA_DIR: $(find "$TMP/md1" -type f 2>/dev/null | wc -l | tr -d ' ')   <- expect 0"

echo
echo "== 2. AFTER, both env vars unset — expect RESOLVED=<installed root>, exit 0 =="
env -u CLAUDE_PLUGIN_ROOT -u PLUGIN_ROOT bash "$TMP/after.sh"; echo "   exit=$?"

echo
echo "== 3. AFTER, nothing installed anywhere — expect exit 1 AND one ERROR line on disk =="
mkdir -p "$TMP/emptycfg"
env -u CLAUDE_PLUGIN_ROOT -u PLUGIN_ROOT CLAUDE_CONFIG_DIR="$TMP/emptycfg" \
    CLAUDE_MEM_DATA_DIR="$TMP/md2" bash "$TMP/after.sh"; echo "   exit=$?"
sed 's/^/   /' "$TMP/md2/logs/"*.log 2>/dev/null || echo "   NO TRACE WRITTEN  <- fix is not working"

echo
echo "== 4. AFTER, this fork must win over an upstream install at a HIGHER version =="
F="$TMP/fx"
for v in weblapp-claude-mem/claude-mem/13.18.0-weblapp.1 thedotmack/claude-mem/99.0.0; do
  mkdir -p "$F/plugins/cache/$v/scripts"
  : > "$F/plugins/cache/$v/scripts/bun-runner.js"
  : > "$F/plugins/cache/$v/scripts/worker-service.cjs"
done
env -u CLAUDE_PLUGIN_ROOT -u PLUGIN_ROOT CLAUDE_CONFIG_DIR="$F" bash "$TMP/after.sh" | sed "s|$F|<cfg>|"
echo "   expect .../weblapp-claude-mem/claude-mem/13.18.0-weblapp.1, NOT thedotmack/99.0.0"

echo
echo "== 5. AFTER, every generated hook payload parses =="
git -C "$WT" show HEAD:plugin/hooks/hooks.json | python3 -c '
import json,sys,subprocess,tempfile,os
d=json.load(sys.stdin)["hooks"]; bad=n=0
for ev,gs in d.items():
  for g in gs:
    for h in g["hooks"]:
      n+=1; p=tempfile.mktemp(); open(p,"w").write(h["command"]+"\n")
      r=subprocess.run(["bash","-n",p],capture_output=True); os.unlink(p)
      if r.returncode: bad+=1; print("   SYNTAX ERROR",ev,r.stderr.decode())
print(f"   {n} hook commands, {bad} syntax errors  <- expect 0")'
