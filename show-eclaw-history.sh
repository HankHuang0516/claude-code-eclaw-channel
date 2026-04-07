#!/bin/bash
# 顯示 EClaw → Claude Code 的訊息歷史
# Usage: ./show-eclaw-history.sh [count]
#   count: 顯示最後 N 筆訊息（預設 10）

COUNT="${1:-10}"

echo "=== Bridge 收到的 webhook 推送（最近 $COUNT 筆）==="
tail -n "$((COUNT * 2))" /tmp/eclaw-bridge.log 2>/dev/null | grep "Webhook received" | tail -n "$COUNT"
echo ""

echo "=== Claude Code 完整對話歷史 ==="

# Auto-detect: scan all Claude project sessions and pick the one that
# is the actual eclaw-bot recipient. Heuristic: highest count of
# "[EClaw from" markers, modified within the last 7 days. This avoids
# hardcoding a project dir — the eclaw-bot Claude Code can run from any
# cwd — and avoids confusing it with sessions where you merely *quoted*
# a bridge log line.
SESSION=$(python3 - <<'PYEOF'
import os, glob, time
candidates = glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl"))
cutoff = time.time() - 7 * 86400
best = None
best_score = 0
for path in candidates:
    try:
        if os.path.getmtime(path) < cutoff:
            continue
        with open(path, 'rb') as f:
            data = f.read()
        score = data.count(b'[EClaw from')
        if score > best_score:
            best_score = score
            best = path
    except Exception:
        pass
print(best or "")
PYEOF
)

if [ -z "$SESSION" ]; then
    echo "找不到含 bridge 訊息的 Claude session 檔"
    exit 1
fi

echo "Session: $(basename $SESSION) ($(du -h $SESSION | cut -f1))"
echo "Path: $SESSION"
echo ""

python3 <<PYEOF
import json
session = "$SESSION"
count = $COUNT

with open(session) as f:
    msgs = [json.loads(l) for l in f if l.strip()]

# Collect user messages (excluding tool results) and assistant text replies
events = []
for m in msgs:
    msg = m.get('message', {})
    content = msg.get('content', '')
    role = msg.get('role', m.get('type', ''))
    ts = m.get('timestamp', '')

    if role == 'user' and isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get('type') == 'text':
                txt = c.get('text', '')
                if txt:
                    events.append({'ts': ts, 'role': 'USER (EClaw)', 'text': txt})
    elif role == 'user' and isinstance(content, str) and content:
        events.append({'ts': ts, 'role': 'USER (EClaw)', 'text': content})
    elif role == 'assistant' and isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get('type') == 'text':
                txt = c.get('text', '')
                if txt:
                    events.append({'ts': ts, 'role': 'CLAUDE', 'text': txt})

print(f"Total events: {len(events)}")
print()
for e in events[-count:]:
    print(f"[{e['ts']}] {e['role']} ({len(e['text'])} chars)")
    print(e['text'])
    print("---")
PYEOF
