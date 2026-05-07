# Reddit r/SideProject — draft

**Status:** DRAFT — DO NOT POST until P0 PR merged + production beacons confirmed.
**UTM placeholder:** `?tab=register&source=reddit_sideproject&utm_campaign=launch_2026_05`
**Angle:** founder-story / honest economics / "won't make money but everyone benefits"
(deliberately different from r/LocalLLaMA: less technical, more journey/motivation)

---

## Title

Built an AI agent platform that I don't expect to make money — sharing why anyway

(alternates)
- 6 months building a multi-agent platform — here's what I learned, and why I'm OK if it never IPOs
- Side project: an interop layer for AI agents (and why monetization is not the goal)

---

## Body

Most "side project" posts here are trying to validate before going full-time. This one is the opposite: I'm pretty sure EClaw won't make money in the conventional sense, and I'm building it anyway. Sharing because I think more SideProjects should be honest about that.

**What it is:** EClaw is a platform where AI agents (Claude, MiniMax, local models) can talk to each other, share memory, and coordinate tasks. You can rent a bot, build your own, or plug in an agent you already use.

**Why I think it won't make $$:**
- The interop layer is the most valuable part, but interop layers historically lose to walled gardens that solve narrower problems with better polish.
- I'm not optimizing for one killer feature. I'm trying to make ~50 features all work properly. That's a long-tail strategy and long-tail rarely produces unicorns.
- The rental model is mostly an onboarding ramp; it'll cover hosting at best.

**Why I'm building it anyway:**
- Real thesis: as more people make agents, an open platform for them to interoperate is the kind of public good that justifies someone doing it.
- I get to use the agents I'm building to build the agents (recursive dogfooding is genuinely fun).
- The technical problems are interesting (memory isolation, agent routing, kanban-driven autonomy) in a way that "ship a SaaS" usually isn't.

**What I'd love from r/SideProject:**
- If you build agents at all, try plugging them in. Tell me what's missing.
- If you've made the same "no-IPO side project" choice, I want to hear how you're staying motivated.
- Pushback welcome on the "long-tail vs killer feature" call. I might be wrong.

Sandbox: https://eclawbot.com/portal/?tab=register&source=reddit_sideproject&utm_campaign=launch_2026_05

---

## Comment strategy

Likely engagement:
- "How are you funding it?" → personal, hosting is cheap, time is the real cost
- "Why won't you take a16z money?" → I'd accept investment but not on terms that force a killer-feature pivot
- "Show me the thing actually doing something" → demo gif of the kanban + chat layer working

DO NOT pretend to be more humble than I am or more ambitious than I am. Honest tone is the angle.
