/**
 * start-tunnel.sh — cold-start regression test.
 *
 * On 2026-10-21 `ECLAW_TUNNEL_MODE=named ./start-tunnel.sh` died with exit 1
 * after printing only its "mode=named ..." line whenever the host had no
 * cloudflared running yet — i.e. exactly the first launch of a new bot.
 * find_existing_cloudflared()'s last command was a pgrep that exits 1 on "no
 * match"; under `set -euo pipefail` that status reached the caller's
 * `pids=$(find_existing_cloudflared)` and errexit killed the script before it
 * ever created the tmux session. quick mode hid the bug because its brace
 * group ends with an `if` that returns 0 when TUNNEL_NAME is empty, so both
 * modes are pinned here.
 *
 * The script KILLS any cloudflared whose argv matches the port or the tunnel
 * name, so this test may only ever use a port no bridge listens on and a
 * UUID no tunnel owns. Never put a live bridge port (18800-18803) or a real
 * tunnel UUID in here — it would take down a serving bot.
 *
 * cloudflared and tmux are stubbed on PATH: nothing real is launched, and the
 * tmux stub fakes the registration line so the script's 15s wait returns at
 * once. ECLAW_TUNNEL_DRY_RUN is deliberately NOT used — it exits before the
 * kill step, which is the step that used to fail.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "start-tunnel.sh");
const FAKE_PORT = "19977";
const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

let dir: string;
let tunnelLog: string;
let tmuxCalls: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "start-tunnel-test-"));
  tunnelLog = join(dir, "tunnel.log");
  tmuxCalls = join(dir, "tmux-calls.log");
  const bin = join(dir, "bin");
  mkdirSync(bin);

  // Never executed — start-tunnel.sh only `command -v`s it — but it has to
  // exist and be executable for the pre-flight check to pass.
  writeFileSync(join(bin, "cloudflared"), "#!/usr/bin/env bash\nexit 0\n");
  // Records what the script asked tmux to do, and stands in for a
  // cloudflared that registered successfully.
  writeFileSync(
    join(bin, "tmux"),
    [
      "#!/usr/bin/env bash",
      'echo "$*" >> "$STUB_TMUX_CALLS"',
      'if [ "${1:-}" = "send-keys" ]; then',
      '  echo "INF Registered tunnel connection connIndex=0" >> "$STUB_TUNNEL_LOG"',
      "fi",
      "exit 0",
    ].join("\n") + "\n",
  );
  chmodSync(join(bin, "cloudflared"), 0o755);
  chmodSync(join(bin, "tmux"), 0o755);

  writeFileSync(
    join(dir, "cred.json"),
    JSON.stringify({ AccountTag: "test", TunnelSecret: "test", TunnelID: FAKE_UUID }),
  );
  // Pre-create the call log so a script that dies before its first tmux call
  // fails on the assertion that matters (exit code) rather than on a read.
  writeFileSync(tmuxCalls, "");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(env: Record<string, string>) {
  // Strip every inherited ECLAW_* var before layering ours on: dev boxes here
  // export entity-specific ones from the shell profile, and a stray
  // ECLAW_TUNNEL_DRY_RUN or ECLAW_TUNNEL_CONFIG would quietly route the
  // script around the code under test.
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("ECLAW_")) base[k] = v;
  }
  const proc = Bun.spawnSync(["bash", SCRIPT], {
    env: {
      ...base,
      PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
      STUB_TMUX_CALLS: tmuxCalls,
      STUB_TUNNEL_LOG: tunnelLog,
      ECLAW_BRIDGE_PORT: FAKE_PORT,
      ECLAW_TUNNEL_LOG: tunnelLog,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stderr: proc.stderr.toString(),
    tmux: readFileSync(tmuxCalls, "utf8"),
  };
}

describe("start-tunnel.sh cold start (no cloudflared running)", () => {
  test(
    "named mode reaches the tmux launch instead of dying in the kill step",
    () => {
      const r = run({
        ECLAW_TUNNEL_MODE: "named",
        ECLAW_TUNNEL_NAME: FAKE_UUID,
        ECLAW_TUNNEL_CRED_FILE: join(dir, "cred.json"),
      });

      // The regression: this used to be 1, with stderr ending at "mode=named".
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain(`no existing cloudflared bound to localhost:${FAKE_PORT}`);
      expect(r.tmux).toContain(`new-session -d -s eclaw-tunnel-${FAKE_PORT}`);
      expect(r.tmux).toContain(`run ${FAKE_UUID}`);
      expect(r.stderr).toContain("tunnel up");
    },
    30_000,
  );

  test(
    "quick mode keeps working (it only passed before by accident)",
    () => {
      const r = run({ ECLAW_TUNNEL_MODE: "quick" });

      expect(r.exitCode).toBe(0);
      expect(r.tmux).toContain(`new-session -d -s eclaw-tunnel-${FAKE_PORT}`);
      expect(r.tmux).toContain(`--url http://localhost:${FAKE_PORT}`);
    },
    30_000,
  );

  test(
    "named mode survives a cold start even with a stale TUNNEL_NAME exported in quick mode",
    () => {
      // The brace group's `if` is what used to mask the bug in quick mode; with
      // TUNNEL_NAME set, quick mode runs the same failing pgrep as named mode.
      const r = run({ ECLAW_TUNNEL_MODE: "quick", ECLAW_TUNNEL_NAME: FAKE_UUID });

      expect(r.exitCode).toBe(0);
      expect(r.tmux).toContain(`new-session -d -s eclaw-tunnel-${FAKE_PORT}`);
    },
    30_000,
  );
});
