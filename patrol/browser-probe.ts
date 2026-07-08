/**
 * Visual/UX patrol — in-browser DOM/pixel extractor.
 *
 * `extractSnapshot` runs INSIDE the page (via Playwright page.evaluate). It reads
 * the live DOM + canvas pixels and returns a plain-object `PageSnapshot` that the
 * pure `visual-detector` then reasons over. Keeping all DOM access here (and none
 * in the detector) is what lets the detector be tested with fixtures and no browser.
 *
 * The function is written to run against a minimal DOM contract so it can also be
 * exercised in tests with a tiny document shim (see probe-extract.test.ts). It only
 * uses: document.documentElement, querySelectorAll, getBoundingClientRect,
 * getAttribute, dataset, naturalWidth, and a canvas 2d getImageData probe.
 */

import type { PageSnapshot, Viewport } from "./visual-detector.ts";

/**
 * Minimal DOM contract the extractor needs. Real browsers satisfy this; the
 * test shim implements just these members.
 */
export interface ProbeDocument {
  documentElement: { scrollWidth: number; clientWidth: number };
  querySelectorAll(sel: string): ProbeElement[];
}
export interface ProbeElement {
  tagName: string;
  getAttribute(name: string): string | null;
  dataset: Record<string, string | undefined>;
  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number };
  // img
  naturalWidth?: number;
  // canvas pixel probe: returns true if any non-transparent pixel exists
  __canvasHasPixels?(): boolean;
  // computed display for onerror-hidden detection
  __displayNone?: boolean;
  // scroll metrics for text overflow
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
  // empty-state helpers
  __isEmpty?: boolean;
  __loadErrored?: boolean;
}

export interface ProbeConfig {
  surface: string;
  url: string;
  viewport: Viewport;
  activeEntityId: number | null;
  /** entityIds that are OUR bound partners (must render real avatars). */
  boundEntityIds: number[];
}

/**
 * Extract a PageSnapshot from a document. Pure w.r.t. the injected `document`
 * (no global reads besides the passed doc), so it is unit-testable with a shim
 * and runs verbatim inside page.evaluate in production.
 */
export function extractSnapshot(doc: ProbeDocument, cfg: ProbeConfig): PageSnapshot {
  const bound = new Set(cfg.boundEntityIds);
  const viewportW = cfg.viewport.width;

  // ── Avatars ──────────────────────────────────────────────────────────────
  const avatars = [];
  const canvasEls = doc.querySelectorAll("canvas.entity-avatar-canvas");
  for (const el of canvasEls) {
    const eid = numAttr(el, "data-entity-id");
    const petdx = numAttr(el, "data-petdx-entity-id");
    avatars.push({
      entityId: eid,
      kind: "canvas" as const,
      petdxEntityId: petdx,
      canvasDrawn: typeof el.__canvasHasPixels === "function" ? el.__canvasHasPixels() : true,
      imgNaturalWidth: null,
      imgSrc: null,
      emojiText: null,
      isBoundPartner: eid != null && bound.has(eid),
    });
  }
  const imgAvatarEls = doc.querySelectorAll("img.entity-avatar-img");
  for (const el of imgAvatarEls) {
    const eid = numAttr(el, "data-entity-id");
    avatars.push({
      entityId: eid,
      kind: "img" as const,
      petdxEntityId: null,
      canvasDrawn: false,
      imgNaturalWidth: el.naturalWidth ?? null,
      imgSrc: el.getAttribute("src"),
      emojiText: null,
      isBoundPartner: eid != null && bound.has(eid),
    });
  }
  const emojiEls = doc.querySelectorAll("span.entity-avatar-emoji");
  for (const el of emojiEls) {
    const eid = numAttr(el, "data-entity-id");
    avatars.push({
      entityId: eid,
      kind: "emoji" as const,
      petdxEntityId: null,
      canvasDrawn: false,
      imgNaturalWidth: null,
      imgSrc: null,
      emojiText: (el.getAttribute("data-emoji") ?? el.dataset?.emoji ?? null),
      isBoundPartner: eid != null && bound.has(eid),
    });
  }

  // ── Broken images (all imgs, not just avatars) ───────────────────────────
  const images = [];
  for (const el of doc.querySelectorAll("img")) {
    images.push({
      src: el.getAttribute("src"),
      naturalWidth: el.naturalWidth ?? null,
      hiddenByError: el.__displayNone === true,
      selector: describeSelector(el),
    });
  }

  // ── Horizontal overflow: elements whose right edge exceeds the viewport ───
  const overflowingSelectors: string[] = [];
  for (const el of doc.querySelectorAll("[data-patrol-track]")) {
    const r = el.getBoundingClientRect();
    if (r.right > viewportW + 1 && r.width > 0) overflowingSelectors.push(describeSelector(el));
  }

  // ── Text overflow (C5) ────────────────────────────────────────────────────
  const textBoxes = [];
  for (const el of doc.querySelectorAll("[data-patrol-textbox]")) {
    const ow = (el.scrollWidth ?? 0) > (el.clientWidth ?? 0) + 1;
    const oh = (el.scrollHeight ?? 0) > (el.clientHeight ?? 0) + 1;
    textBoxes.push({ selector: describeSelector(el), overflows: ow || oh });
  }

  // ── Empty placeholders masking load failure (C6) ──────────────────────────
  const emptyStates = [];
  for (const el of doc.querySelectorAll("[data-patrol-emptystate]")) {
    emptyStates.push({
      selector: describeSelector(el),
      isEmpty: el.__isEmpty === true,
      loadErrored: el.__loadErrored === true || el.getAttribute("data-load-error") === "true",
    });
  }

  return {
    surface: cfg.surface,
    url: cfg.url,
    viewport: cfg.viewport,
    activeEntityId: cfg.activeEntityId,
    documentScrollWidth: doc.documentElement.scrollWidth,
    documentClientWidth: doc.documentElement.clientWidth,
    overflowingSelectors,
    avatars,
    images,
    textBoxes,
    emptyStates,
  };
}

function numAttr(el: ProbeElement, name: string): number | null {
  const v = el.getAttribute(name);
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function describeSelector(el: ProbeElement): string {
  const cls = el.getAttribute("class");
  const id = el.getAttribute("id");
  const tag = (el.tagName || "el").toLowerCase();
  if (id) return `${tag}#${id}`;
  if (cls) return `${tag}.${cls.trim().split(/\s+/).slice(0, 2).join(".")}`;
  return tag;
}
