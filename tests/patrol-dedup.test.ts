/**
 * Visual/UX patrol — dedup unit tests.
 *
 * Proves the flood-control contract: a finding whose signature is already
 * covered by an OPEN card produces no new card; a finding for a new defect
 * does; a done/closed card does NOT suppress recurrence; and duplicate
 * findings within one run collapse to one.
 */

import { describe, expect, test } from "bun:test";
import {
  dedupeFindings,
  extractSignatures,
  openSignatureSet,
  signatureMarkerLine,
  type OpenCard,
} from "../patrol/dedup.ts";
import { buildSignature, type Finding, type Viewport } from "../patrol/visual-detector.ts";

const MOBILE: Viewport = { width: 390, height: 844 };

function finding(surface: string, selector: string): Finding {
  const sig = buildSignature(surface, MOBILE, "fallback_avatar", selector);
  return {
    surface,
    viewport: MOBILE,
    defectClass: "fallback_avatar",
    selector,
    evidence: "x",
    signature: sig,
  };
}

function cardCovering(sig: string, status = "todo"): OpenCard {
  return {
    id: "card_" + sig.replace(/\W/g, "").slice(0, 8),
    title: "[Auto][視覺巡檢] card-holder — Fallback 頭像 (390x844)",
    description: `some body\n${signatureMarkerLine(sig)}\nmore`,
    status,
  };
}

describe("signature extraction", () => {
  test("recovers the embedded signature from a card body", () => {
    const sig = buildSignature("card-holder", MOBILE, "fallback_avatar", "sel-a");
    const card = cardCovering(sig);
    expect(extractSignatures(card)).toEqual([sig]);
  });

  test("returns [] for a card with no marker", () => {
    expect(extractSignatures({ id: "c", title: "x", description: "no marker here", status: "todo" })).toEqual([]);
  });
});

describe("openSignatureSet", () => {
  test("only OPEN statuses contribute signatures", () => {
    const sigOpen = buildSignature("card-holder", MOBILE, "fallback_avatar", "open");
    const sigDone = buildSignature("chat", MOBILE, "fallback_avatar", "done");
    const set = openSignatureSet([cardCovering(sigOpen, "in_progress"), cardCovering(sigDone, "done")]);
    expect(set.has(sigOpen)).toBe(true);
    expect(set.has(sigDone)).toBe(false); // done card does NOT suppress recurrence
  });
});

describe("dedupeFindings", () => {
  test("finding matching an open card → duplicate, no new card", () => {
    const f = finding("card-holder", "sel-1");
    const { newFindings, duplicateFindings } = dedupeFindings([f], [cardCovering(f.signature)]);
    expect(newFindings).toHaveLength(0);
    expect(duplicateFindings).toHaveLength(1);
  });

  test("finding with no matching card → new", () => {
    const f = finding("card-holder", "sel-2");
    const { newFindings } = dedupeFindings([f], []);
    expect(newFindings).toHaveLength(1);
  });

  test("a done card does NOT suppress a recurrence", () => {
    const f = finding("card-holder", "sel-3");
    const { newFindings } = dedupeFindings([f], [cardCovering(f.signature, "done")]);
    expect(newFindings).toHaveLength(1); // reopens because prior card is closed
  });

  test("duplicate findings within one run collapse to one new card", () => {
    const a = finding("card-holder", "same-sel");
    const b = finding("card-holder", "same-sel"); // identical signature
    const { newFindings, duplicateFindings } = dedupeFindings([a, b], []);
    expect(newFindings).toHaveLength(1);
    expect(duplicateFindings).toHaveLength(1);
  });
});
