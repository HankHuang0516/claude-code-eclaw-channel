/**
 * Visual/UX patrol — dedup against currently-open kanban cards.
 *
 * The patrol must NOT re-open a card for a defect it already filed. A single
 * blank-avatar bug that survives a fix cycle should re-nudge the SAME card, not
 * spawn a new one every 6h (flood control). Dedup is by the Finding.signature
 * (surface :: viewport-bucket :: defect-class :: selector), embedded in the
 * card so future patrol runs can recover it from the open-card list.
 *
 * Pure + testable: takes findings + a list of already-open cards, returns the
 * subset of findings that are NEW. No network here.
 */

import type { Finding } from "./visual-detector.ts";

/** Minimal shape of an open kanban card we need for dedup. */
export interface OpenCard {
  id: string;
  title: string;
  description: string;
  status: string; // backlog | todo | in_progress | review | done
}

/** Marker embedded in a patrol-opened card body so we can recover its signature. */
export const SIGNATURE_MARKER = "[patrol-sig]:";

/** Build the marker line stored in a patrol card body. */
export function signatureMarkerLine(signature: string): string {
  return `${SIGNATURE_MARKER} ${signature}`;
}

/** Extract every patrol signature embedded in a card's title or body. */
export function extractSignatures(card: OpenCard): string[] {
  const out: string[] = [];
  const haystack = `${card.title}\n${card.description}`;
  const re = new RegExp(
    SIGNATURE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*([^\\n\\r]+)",
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

/** Cards in these statuses count as "open" for dedup (a done card is closed). */
const OPEN_STATUSES = new Set(["backlog", "todo", "in_progress", "review"]);

/**
 * Collect the set of signatures already covered by an open card.
 * Done/archived cards are excluded so a recurrence after close reopens a card.
 */
export function openSignatureSet(cards: OpenCard[]): Set<string> {
  const set = new Set<string>();
  for (const c of cards) {
    if (!OPEN_STATUSES.has(c.status)) continue;
    for (const sig of extractSignatures(c)) set.add(sig);
  }
  return set;
}

export interface DedupResult {
  /** Findings not covered by any open card — file these. */
  newFindings: Finding[];
  /** Findings already covered by an open card — skip (flood control). */
  duplicateFindings: Finding[];
}

/**
 * Split findings into new vs duplicate against the open-card set.
 *
 * Also dedups WITHIN this run: two findings with the same signature (e.g. the
 * same selector at the same viewport bucket) collapse to one new card.
 */
export function dedupeFindings(findings: Finding[], openCards: OpenCard[]): DedupResult {
  const covered = openSignatureSet(openCards);
  const seenThisRun = new Set<string>();
  const newFindings: Finding[] = [];
  const duplicateFindings: Finding[] = [];

  for (const f of findings) {
    if (covered.has(f.signature) || seenThisRun.has(f.signature)) {
      duplicateFindings.push(f);
    } else {
      seenThisRun.add(f.signature);
      newFindings.push(f);
    }
  }
  return { newFindings, duplicateFindings };
}
