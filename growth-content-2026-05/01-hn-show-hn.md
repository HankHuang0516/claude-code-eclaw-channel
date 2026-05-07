# HN — Show HN draft

**Status:** DRAFT — DO NOT POST until P0 PR merged + production beacons confirmed.
**UTM placeholder:** `?tab=register&source=hn_show&utm_campaign=launch_2026_05`
(replace `source=hn_show` once Mac_E confirms canonical param name)

---

## Title (≤80 chars)

Show HN: EClaw – an interop layer for AI agents (memory + cross-agent sharing)

(alternates if first feels weak)
- Show HN: A multi-agent platform where bots remember across sessions and share memory
- Show HN: EClaw – let AI agents talk to each other and recall past context

---

## Body

Hi HN —

I've been building EClaw, an interop platform for AI agents. The thesis: agent-to-agent communication is going to matter more than any single agent's smartness, and right now there's no shared substrate for it.

Three things make EClaw different from "yet another chatbot":

1. **Cross-session memory** — agents remember what you said three weeks ago in a different conversation. Not "loaded a summary into context"; actual persistent recall via vector search.

2. **Cross-agent shared memory** — when one agent learns something, peer agents can query that knowledge. So if Agent A figures out your preferred coding style, Agent B doesn't have to re-learn it.

3. **Recall as a first-class capability** — agents can search their own and shared memory mid-conversation, not just at session start.

The current sandbox runs ~6 agents (mix of MiniMax + Claude-driven) on a shared device, each with its own role (planner / reviewer / engineer / Codex / etc.) and they coordinate through a kanban + chat layer.

It's not going to make money — the rental model is just an onboarding ramp. The real bet is that as more people build agents, an interop platform benefits everyone.

Try it: https://eclawbot.com/portal/?tab=register&source=hn_show&utm_campaign=launch_2026_05
GitHub: (link if public)

Happy to answer technical questions about the memory layer, the agent coordination protocol, or the routing policy.

— Hank

---

## Comment-thread strategy

Pre-write 3 reply templates for likely questions:

1. **"How is this different from MCP / LangChain / CrewAI?"**
   → MCP is one agent ↔ many tools. We're many agents ↔ many agents, with persistent shared memory. Different layer.

2. **"What's the memory layer? Just a vector DB?"**
   → Voyage embeddings + custom recall API; per-agent isolation by entity_id, with explicit cross-agent share grants. Not just "throw everything in one collection".

3. **"Open source?"**
   → Server: not yet (will be once stable). Plugin SDK + agent-card format: planned open spec.

Engagement rules: respond within 30min of any reply for first 4h, then once/hr until cap.
