#!/usr/bin/env bun
/**
 * EClaw usage sync — reads ~/.claude/projects/**\/*.jsonl and
 * ~/.claude/usage-status.json, then POSTs a snapshot to /api/usage/snapshot.
 *
 * Enabled by setting ECLAW_USAGE_SYNC=true in the environment.
 * Called on a 60-second interval from bridge.ts.
 *
 * The snapshot schema mirrors what eclaw-usage-daemon/daemon.py produces,
 * so the EClaw portal usage widget displays Claude Code token consumption
 * without requiring a separate Python daemon process.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const STATUS_FILE  = join(homedir(), ".claude", "usage-status.json");
const HOURS_BACK   = 24;
const DAEMON_VER   = "bridge-builtin-1.0.0";

// ── helpers ──────────────────────────────────────────────────────────────────

function asInt(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? Math.max(0, Math.trunc(v)) : 0;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseTs(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const ms = Date.parse(v.replace("Z", "+00:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(ms) ? ms : null;
}

function projectFromCwd(cwd: string): string {
  if (!cwd) return "unknown";
  return basename(cwd.replace(/\/$/, "")) || "unknown";
}

// ── JSONL scanner ─────────────────────────────────────────────────────────────

interface SessionRow {
  session_id:            string;
  project:               string;
  model:                 string;
  first_seen:            string;
  last_seen:             string;
  input_tokens:          number;
  output_tokens:         number;
  cache_creation_tokens: number;
  cache_read_tokens:     number;
  messages:              number;
  cost_usd:              number;
}

function scanJsonl(
  filePath: string,
  cutoffMs: number | null,
  sessions: Map<string, SessionRow>,
  seen: Set<string>,
): void {
  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!d || typeof d !== "object" || d["type"] !== "assistant") continue;
    const msg = (d["message"] && typeof d["message"] === "object" ? d["message"] : {}) as Record<string, unknown>;
    const usage = (msg["usage"] && typeof msg["usage"] === "object" ? msg["usage"] : null) as Record<string, unknown> | null;
    if (!usage) continue;

    const tsMs = parseTs(d["timestamp"]);
    if (tsMs === null) continue;
    if (cutoffMs !== null && tsMs < cutoffMs) continue;

    const sessionId = asStr(d["sessionId"]);
    const messageId = asStr(msg["id"]);
    const requestId = asStr(d["requestId"]);
    const dedup = (messageId || requestId)
      ? `m:${messageId}:${requestId}`
      : `e:${sessionId}:${tsMs}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const inp = asInt(usage["input_tokens"]);
    const out = asInt(usage["output_tokens"]);
    const cc  = asInt(usage["cache_creation_input_tokens"]);
    const cr  = asInt(usage["cache_read_input_tokens"]);
    if (inp + out + cc + cr === 0) continue;

    const cwd    = asStr(d["cwd"]);
    const project = cwd ? projectFromCwd(cwd) : "unknown";
    const model   = asStr(msg["model"]) || "unknown";
    const tsIso   = new Date(tsMs).toISOString();

    let s = sessions.get(sessionId);
    if (!s) {
      s = {
        session_id: sessionId,
        project,
        model,
        first_seen: tsIso,
        last_seen:  tsIso,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        messages: 0,
        cost_usd: 0,
      };
      sessions.set(sessionId, s);
    }
    if (tsIso < s.first_seen) s.first_seen = tsIso;
    if (tsIso > s.last_seen)  s.last_seen  = tsIso;
    s.input_tokens          += inp;
    s.output_tokens         += out;
    s.cache_creation_tokens += cc;
    s.cache_read_tokens     += cr;
    s.messages              += 1;
    if (project !== "unknown") s.project = project;
    if (model   !== "unknown") s.model   = model;
  }
}

function walkDir(dir: string, cb: (f: string) => void): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, cb);
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      cb(full);
    }
  }
}

function loadSessions(): SessionRow[] {
  const cutoffMs = HOURS_BACK > 0 ? Date.now() - HOURS_BACK * 3_600_000 : null;
  const sessions = new Map<string, SessionRow>();
  const seen     = new Set<string>();

  walkDir(PROJECTS_DIR, (filePath) => {
    if (cutoffMs !== null) {
      try {
        if (statSync(filePath).mtimeMs < cutoffMs) return;
      } catch {
        return;
      }
    }
    scanJsonl(filePath, cutoffMs, sessions, seen);
  });

  return [...sessions.values()].sort((a, b) =>
    b.last_seen.localeCompare(a.last_seen),
  );
}

function loadLive(): Record<string, unknown> | null {
  try {
    const text = readFileSync(STATUS_FILE, "utf-8");
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Build and POST a usage snapshot.
 * @param apiBase  EClaw API base URL, e.g. "https://eclawbot.com"
 * @param deviceId device ID (from channel bind)
 * @param entityId entity ID
 * @param botSecret bot secret
 * @param log      logger function
 */
export async function pushUsageSnapshot(
  apiBase: string,
  deviceId: string,
  entityId: number,
  botSecret: string,
  log: (msg: string) => void,
): Promise<void> {
  const sessions = loadSessions();
  const live     = loadLive();

  const body = {
    deviceId,
    entityId,
    botSecret,
    captured_at:    new Date().toISOString(),
    daemon_version: DAEMON_VER,
    pricing_source: "builtin-bridge",
    claude: {
      sessions,
      ...(live ? { live } : {}),
    },
  };

  const url = `${apiBase}/api/usage/snapshot`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      log(`[usage-sync] pushed ${sessions.length} sessions → ${res.status}`);
    } else {
      const text = await res.text().catch(() => "");
      log(`[usage-sync] WARN: snapshot rejected ${res.status}: ${text.slice(0, 120)}`);
    }
  } catch (err: unknown) {
    log(`[usage-sync] WARN: push failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
