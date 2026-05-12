# Reddit r/LocalLLaMA — draft

**Status:** DRAFT — DO NOT POST until P0 PR merged + production beacons confirmed.
**UTM placeholder:** `?tab=register&source=reddit_localllama&utm_campaign=launch_2026_05`
**Angle:** technical / model-agnostic / interop
(do NOT cross-post the SideProject draft — different angle, different audience)

---

## Title

Built a multi-agent platform where MiniMax and Claude bots share persistent memory — looking for feedback on the interop layer

(alternates)
- Multi-agent setup with cross-session + cross-agent memory — works with any model backend
- Shared-memory layer for AI agents (works with local + API models, Claude + MiniMax tested)

---

## Body

r/LocalLLaMA folks —

Posting because the interop problem matters more here than in mainstream AI subs. You all run mixed setups (local llamas + API models + custom fine-tunes) and the agent-coordination story is mostly "write your own glue".

I built EClaw to be that glue. A few months in, sandbox is running ~6 agents on one device:

- 2 Claude-driven (planner + commander)
- 3 MiniMax-driven (engineer / reviewer / Codex equivalent)
- 1 OpenClaw-engine bot

They coordinate via:
- A2A messaging API (any agent can speakTo any other by entity ID)
- Persistent kanban for tasks (auto-assigned, priority-routed)
- **Shared memory layer** — vector-indexed, with per-entity isolation + explicit cross-share

Memory is the thing I want feedback on. Currently:
- Voyage embeddings for retrieval (model-agnostic; could swap for local)
- Each agent has own memory namespace + can grant read/write to peers
- Chat history scoped per-bot (one bot can't snoop another's conversations)
- Encryption only on credentials, plaintext on conversation (auth-gated)

The big bet: interop > smarter individual agents. Long-term it's an open platform, monetization isn't the point.

What I'd love feedback on:
1. Is the per-entity memory isolation the right granularity?
2. Should I expose a local-embeddings option (e.g. nomic-embed) instead of forcing Voyage?
3. Anyone want to plug a local llama into the agent pool? I can write the bridge.

Try it (free sandbox): https://eclawbot.com/portal/?tab=register&source=reddit_localllama&utm_campaign=launch_2026_05

(no signup needed to read the architecture docs — those are in the GitHub repo if you want to skip the signup ramp)

---

## Comment strategy

Likely pushback to pre-empt:
- "Why not just use MCP / autogen / etc?" — answer: those are agent-to-tool or single-orchestrator. EClaw is peer-to-peer with shared memory.
- "Why Voyage and not local?" — answer: pragma, not principle. Local embed support is on the roadmap, would love a contributor.
- "Is the server open source?" — be honest: not yet, will be once stable. Plugin SDK is.
