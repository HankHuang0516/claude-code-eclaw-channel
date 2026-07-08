/**
 * Visual/UX patrol — browser-probe extractor unit tests.
 *
 * The extractor runs in-page in production, but it's written against a minimal
 * DOM contract so we can drive it here with a hand-rolled shim (no jsdom). We
 * build shim elements that mirror the REAL portal markup from entity-utils.js:
 *   healthy:  <canvas class="entity-avatar-canvas" data-entity-id=2 data-petdx-entity-id=2>  (drawn)
 *   fallback: <span   class="entity-avatar-emoji"  data-entity-id=2 data-emoji=🦞>
 * and confirm the resulting snapshot feeds the detector to the right verdict.
 */

import { describe, expect, test } from "bun:test";
import { extractSnapshot, type ProbeDocument, type ProbeElement, type ProbeConfig } from "../patrol/browser-probe.ts";
import { detectAll } from "../patrol/visual-detector.ts";

function el(tag: string, attrs: Record<string, string>, extra: Partial<ProbeElement> = {}): ProbeElement {
  const dataset: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const m = k.match(/^data-(.+)$/);
    if (m) dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return {
    tagName: tag.toUpperCase(),
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
    dataset,
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }),
    ...extra,
  };
}

/** Minimal document shim: a css-class matcher over a flat element list. */
function shimDoc(els: ProbeElement[], scrollWidth = 390, clientWidth = 390): ProbeDocument {
  const matches = (e: ProbeElement, sel: string): boolean => {
    // Support "tag.class", ".class", "tag", "[data-x]" — enough for the probe.
    if (sel === "img") return e.tagName === "IMG";
    const attrMatch = sel.match(/^\[([a-z-]+)\]$/);
    if (attrMatch) return e.getAttribute(attrMatch[1]) != null;
    const clsMatch = sel.match(/\.([a-zA-Z0-9_-]+)$/);
    const tagPart = sel.split(".")[0];
    const cls = e.getAttribute("class") || "";
    const tagOk = !tagPart || e.tagName === tagPart.toUpperCase();
    const clsOk = !clsMatch || cls.split(/\s+/).includes(clsMatch[1]);
    return tagOk && clsOk;
  };
  return {
    documentElement: { scrollWidth, clientWidth },
    querySelectorAll: (sel: string) => els.filter((e) => matches(e, sel)),
  };
}

const CFG: ProbeConfig = {
  surface: "card-holder",
  url: "https://eclawbot.com/portal/card-holder.html",
  viewport: { width: 390, height: 844 },
  activeEntityId: 2,
  boundEntityIds: [2],
};

describe("extractSnapshot — healthy drawn canvas", () => {
  test("bound entity canvas with pixels → detector finds nothing", () => {
    const canvas = el(
      "canvas",
      { class: "entity-avatar-canvas", "data-entity-id": "2", "data-petdx-entity-id": "2" },
      { __canvasHasPixels: () => true },
    );
    const snap = extractSnapshot(shimDoc([canvas]), CFG);
    expect(snap.avatars).toHaveLength(1);
    expect(snap.avatars[0].kind).toBe("canvas");
    expect(snap.avatars[0].canvasDrawn).toBe(true);
    expect(snap.avatars[0].isBoundPartner).toBe(true);
    expect(detectAll(snap)).toHaveLength(0);
  });
});

describe("extractSnapshot — fallback emoji span (the real regression)", () => {
  test("bound entity showing emoji-span → detector flags fallback_avatar", () => {
    // Real portal markup: the glyph is the span's TEXT CONTENT (entity-utils.js:225).
    const span = el(
      "span",
      { class: "entity-avatar-emoji", "data-entity-id": "2" },
      { textContent: "\u{1F99E}" },
    );
    const snap = extractSnapshot(shimDoc([span]), CFG);
    expect(snap.avatars[0].kind).toBe("emoji");
    expect(snap.avatars[0].emojiText).toBe("\u{1F99E}");
    const findings = detectAll(snap);
    expect(findings).toHaveLength(1);
    expect(findings[0].defectClass).toBe("fallback_avatar");
  });
});

describe("extractSnapshot — blank canvas (drew nothing)", () => {
  test("bound canvas with no pixels → flagged", () => {
    const canvas = el(
      "canvas",
      { class: "entity-avatar-canvas", "data-entity-id": "2", "data-petdx-entity-id": "2" },
      { __canvasHasPixels: () => false },
    );
    const snap = extractSnapshot(shimDoc([canvas]), CFG);
    expect(snap.avatars[0].canvasDrawn).toBe(false);
    expect(detectAll(snap)[0].defectClass).toBe("fallback_avatar");
  });
});

describe("extractSnapshot — broken img", () => {
  test("img with naturalWidth 0 → broken_image", () => {
    const img = el("img", { src: "https://r2/x.webp", "data-entity-id": "2" }, { naturalWidth: 0 });
    const snap = extractSnapshot(shimDoc([img]), CFG);
    expect(snap.images).toHaveLength(1);
    expect(snap.images[0].naturalWidth).toBe(0);
    const findings = detectAll(snap);
    expect(findings.some((f) => f.defectClass === "broken_image")).toBe(true);
  });
});

describe("extractSnapshot — document horizontal overflow", () => {
  test("scrollWidth > clientWidth → horizontal_overflow", () => {
    const snap = extractSnapshot(shimDoc([], 520, 390), CFG);
    expect(snap.documentScrollWidth).toBe(520);
    expect(detectAll(snap).some((f) => f.defectClass === "horizontal_overflow")).toBe(true);
  });
});
