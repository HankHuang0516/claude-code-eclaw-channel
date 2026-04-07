#!/bin/bash
# patch-fakechat.sh
#
# Patches the fakechat plugin instructions to enforce reply tool usage
# when running as an EClaw channel bridge.
#
# The official fakechat plugin's default instructions are too lenient — Claude
# Code may write replies to its transcript instead of calling the reply tool,
# which means EClaw users never see the response.
#
# This script replaces the instructions block with a stronger bilingual
# (English + Traditional Chinese) version that:
#   1. Mandates calling the reply tool for every channel message
#   2. Forbids writing replies only to transcript
#   3. Tells Claude to acknowledge mid-task with a short reply
#   4. Enables auto-i18n based on user message language
#
# Run after: /plugin install fakechat@claude-plugins-official
# Re-run after: any fakechat plugin update
#
# Usage: ./patch-fakechat.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTRUCTIONS_FILE="$SCRIPT_DIR/fakechat-instructions.txt"

if [ ! -f "$INSTRUCTIONS_FILE" ]; then
    echo "❌ Cannot find fakechat-instructions.txt next to this script"
    exit 1
fi

# Locate the fakechat plugin install (cache + marketplace mirror)
CACHE_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/fakechat/0.0.1"
MARKET_DIR="$HOME/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/fakechat"

if [ ! -f "$CACHE_DIR/server.ts" ]; then
    echo "❌ Fakechat plugin not found at $CACHE_DIR"
    echo "   Install it first: claude → /plugin install fakechat@claude-plugins-official"
    exit 1
fi

# Backup original (only once — preserve the truly-original copy)
if [ ! -f "$CACHE_DIR/server.ts.original" ]; then
    cp "$CACHE_DIR/server.ts" "$CACHE_DIR/server.ts.original"
    echo "✅ Backed up original server.ts → server.ts.original"
fi

# Patch using python so we can do multi-line string replacement reliably
python3 - "$CACHE_DIR/server.ts" "$INSTRUCTIONS_FILE" <<'PYEOF'
import sys, re

server_path = sys.argv[1]
instr_path = sys.argv[2]

with open(instr_path) as f:
    new_instructions = f.read().strip()

# Escape backticks and ${} for embedding in a JS template literal
escaped = new_instructions.replace('\\', '\\\\').replace('`', '\\`')
# Preserve ${PORT} as a JS template var (it's intentional in the original)
# Other ${...} would need escaping; we trust the input

with open(server_path) as f:
    content = f.read()

# Match the existing instructions: line. Use a non-greedy match across lines
# until the closing backtick + comma.
pattern = re.compile(
    r"(\s+instructions:\s*`)(?:\\`|[^`])*(`,)",
    re.DOTALL
)

if not pattern.search(content):
    print("❌ Could not find instructions: `...` block in server.ts")
    sys.exit(1)

new_content = pattern.sub(
    lambda m: m.group(1) + escaped + m.group(2),
    content,
    count=1
)

with open(server_path, 'w') as f:
    f.write(new_content)

print(f"✅ Patched {server_path}")
PYEOF

# Mirror to marketplace dir if it exists (Claude Code reads from here at runtime)
if [ -f "$MARKET_DIR/server.ts" ]; then
    cp "$CACHE_DIR/server.ts" "$MARKET_DIR/server.ts"
    echo "✅ Mirrored patched server.ts → marketplace dir"
fi

echo ""
echo "🎉 Fakechat instructions patched. Restart Claude Code to apply:"
echo "   tmux kill-session -t eclaw-bot"
echo "   tmux new-session -d -s eclaw-bot"
echo "   tmux send-keys -t eclaw-bot 'claude --dangerously-skip-permissions --channels plugin:fakechat@claude-plugins-official' Enter"
