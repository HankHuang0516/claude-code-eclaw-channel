/**
 * Visual/UX patrol — pure detection core.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every existing EClaw cron is "API-style": it asserts HTTP 200 and stops.
 * That structurally cannot see a VISUAL regression — a fallback emoji where a
 * real partner avatar should render, a broken <img>, a right column bleeding
 * past the viewport. Three such bugs shipped past every green check because no
 * machine ever LOOKED at the rendered page. This module is the "eye": given a
 * plain-object snapshot of the rendered DOM (produced in-browser by
 * `browser-probe.ts`'s page.evaluate, or by a fixture in tests), it returns a
 * list of Findings — one per visual defect.
 *
 * DESIGN: PURE + DEPENDENCY-FREE
 * ------------------------------
 * The detector takes a normalized `PageSnapshot` (plain JS, no DOM, no jsdom)
 * so it runs identically in Bun tests and in production without a browser.
 * All the DOM/pixel reading lives in `browser-probe.ts` (a string handed to
 * Playwright's page.evaluate); this file only reasons over the extracted data.
 * That split is what makes the criteria closeable + CI-gated: fixtures in →
 * findings out, no live auth required.
 *
 * SIGNATURES ARE FROM REAL SOURCE (not assumptions), verified against
 * EClaw-plazacta/backend/public/portal/shared/entity-utils.js:
 *   - healthy partner avatar  = <canvas class="entity-avatar-canvas"
 *                                 data-petdx-entity-id="N">  (line 214-219)
 *                                 …that has actually DRAWN (non-blank pixels).
 *   - URL avatar              = <img class="entity-avatar-img">        (line 221)
 *   - FALLBACK / broken       = <span class="entity-avatar-emoji"
 *                                 data-entity-id="N">emoji</span>       (line 225)
 *   - default lobster fallback = the emoji "\u{1F99E}" (🦞)             (line 225/227)
 * The blank-canvas case is the exact bug the portal guard test
 * (portal-entity-avatar-canvas-guard.test.js) was written to prevent.
 */

/** The six defect classes the patrol looks for (C1–C6 in the build spec). */
export type DefectClass =
  | "fallback_avatar" // C1: bound entity shows emoji fallback, not a drawn canvas
  | "horizontal_overflow" // C2: page scrolls sideways / column bleeds past viewport
  | "wrong_entity_avatar" // C3: rendered avatar's entity id != the active entity
  | "broken_image" // C4: <img> with naturalWidth 0 / empty src / onerror-hidden
  | "text_overflow" // C5: text content overflows its container box
  | "empty_placeholder"; // C6: empty state masking a silent load failure

export interface Viewport {
  width: number;
  height: number;
}

/** One avatar element as read from the live DOM in the browser. */
export interface AvatarSnapshot {
  /** data-entity-id — the entity this slot is meant to represent. */
  entityId: number | null;
  /** "canvas" | "img" | "emoji" — which branch of renderAvatarHtml fired. */
  kind: "canvas" | "img" | "emoji" | "unknown";
  /** For canvas: data-petdx-entity-id (present only on the healthy branch). */
  petdxEntityId: number | null;
  /** For canvas: did it actually paint? (any non-transparent pixel). */
  canvasDrawn: boolean;
  /** For img: naturalWidth. 0 = broken/not-yet-loaded-and-errored. */
  imgNaturalWidth: number | null;
  /** For img: the src attribute (empty string = definitely broken). */
  imgSrc: string | null;
  /** For emoji: the rendered glyph. */
  emojiText: string | null;
  /** Is this entity one of OUR bound entities (should have a real avatar)? */
  isBoundPartner: boolean;
}

/** One <img> on the page (chat photos, previews, etc.) for broken-image scan. */
export interface ImageSnapshot {
  src: string | null;
  naturalWidth: number | null;
  /** true if style.display was set to none (the onerror fallback in chat.html). */
  hiddenByError: boolean;
  /** A short selector/label so the finding points at the right element. */
  selector: string;
}

/** A text element whose content may overflow its box (C5). */
export interface TextBoxSnapshot {
  selector: string;
  /** true when scrollWidth/scrollHeight exceeds clientWidth/clientHeight. */
  overflows: boolean;
}

/** An empty-state container that may be masking a load failure (C6). */
export interface EmptyStateSnapshot {
  selector: string;
  /** true if this element is visible AND its container has no real content. */
  isEmpty: boolean;
  /** true if a fetch/render for this region errored (data-load-error attr). */
  loadErrored: boolean;
}

/** The full normalized snapshot of one rendered page at one viewport. */
export interface PageSnapshot {
  surface: string; // e.g. "card-holder", "arena", "chat"
  url: string;
  viewport: Viewport;
  /** The entity the page is currently focused on (for C3 wrong-entity check). */
  activeEntityId: number | null;
  /** Page-level horizontal overflow (document.scrollWidth > clientWidth). */
  documentScrollWidth: number;
  documentClientWidth: number;
  /** Elements whose bounding box extends past the right viewport edge. */
  overflowingSelectors: string[];
  avatars: AvatarSnapshot[];
  images: ImageSnapshot[];
  textBoxes: TextBoxSnapshot[];
  emptyStates: EmptyStateSnapshot[];
}

/** A single detected visual regression. */
export interface Finding {
  surface: string;
  viewport: Viewport;
  defectClass: DefectClass;
  /** Stable-ish selector/description of the offending element. */
  selector: string;
  /** Human-readable evidence line for the card body. */
  evidence: string;
  /**
   * Stable dedup signature: page + viewport-class + defect-class + selector.
   * Same signature across runs == same defect == do not open a second card.
   * Deliberately viewport-BUCKETED (mobile/desktop) not exact px so a 390 vs
   * 412 phone doesn't spawn duplicate cards.
   */
  signature: string;
}

const LOBSTER_FALLBACK = "\u{1F99E}"; // 🦞 — entity-utils.js default emoji fallback

/** Bucket a viewport into "mobile" | "desktop" for stable signatures. */
export function viewportBucket(vp: Viewport): "mobile" | "desktop" {
  return vp.width < 768 ? "mobile" : "desktop";
}

/** Build the stable dedup signature for a finding. */
export function buildSignature(
  surface: string,
  viewport: Viewport,
  defectClass: DefectClass,
  selector: string,
): string {
  return [surface, viewportBucket(viewport), defectClass, selector].join("::");
}

function mkFinding(
  snap: PageSnapshot,
  defectClass: DefectClass,
  selector: string,
  evidence: string,
): Finding {
  return {
    surface: snap.surface,
    viewport: snap.viewport,
    defectClass,
    selector,
    evidence,
    signature: buildSignature(snap.surface, snap.viewport, defectClass, selector),
  };
}

/**
 * C1 — fallback avatar. A bound partner is meant to render a DRAWN canvas
 * (<canvas class="entity-avatar-canvas" data-petdx-entity-id>). If instead it
 * shows the emoji-span fallback, OR a canvas that never painted, that is the
 * exact visual defect Hank kept catching by eye. Non-bound rows are ignored —
 * an emoji there is legitimately correct (no companion).
 */
export function detectFallbackAvatars(snap: PageSnapshot): Finding[] {
  const out: Finding[] = [];
  for (const a of snap.avatars) {
    if (!a.isBoundPartner) continue; // only OUR entities must have real avatars
    const eid = a.entityId ?? "?";
    if (a.kind === "emoji") {
      const isDefault = a.emojiText === LOBSTER_FALLBACK;
      out.push(
        mkFinding(
          snap,
          "fallback_avatar",
          `entity-avatar-emoji[data-entity-id="${eid}"]`,
          `Bound entity #${eid} rendered emoji fallback ` +
            `"${a.emojiText ?? ""}"${isDefault ? " (default 🦞)" : ""} instead of a drawn canvas avatar.`,
        ),
      );
    } else if (a.kind === "canvas" && !a.canvasDrawn) {
      out.push(
        mkFinding(
          snap,
          "fallback_avatar",
          `entity-avatar-canvas[data-petdx-entity-id="${eid}"]`,
          `Bound entity #${eid} has a blank <canvas> avatar (no pixels drawn) — ` +
            `the blank-canvas regression the portal guard test prevents.`,
        ),
      );
    }
  }
  return out;
}

/**
 * C2 — horizontal overflow. Either the document scrolls sideways
 * (scrollWidth > clientWidth) or a specific element's box extends past the
 * right viewport edge (right column bleed on mobile).
 */
export function detectHorizontalOverflow(snap: PageSnapshot): Finding[] {
  const out: Finding[] = [];
  if (snap.documentScrollWidth > snap.documentClientWidth + 1) {
    out.push(
      mkFinding(
        snap,
        "horizontal_overflow",
        "document",
        `Page scrolls horizontally: scrollWidth ${snap.documentScrollWidth}px > ` +
          `clientWidth ${snap.documentClientWidth}px at ${snap.viewport.width}x${snap.viewport.height}.`,
      ),
    );
  }
  for (const sel of snap.overflowingSelectors) {
    out.push(
      mkFinding(
        snap,
        "horizontal_overflow",
        sel,
        `Element ${sel} extends past the right viewport edge (${snap.viewport.width}px wide).`,
      ),
    );
  }
  return out;
}

/**
 * C3 — wrong entity. The rendered avatar carries a data-petdx-entity-id (or
 * data-entity-id) that does not match the page's active entity. This catches
 * an avatar being drawn for the wrong partner.
 */
export function detectWrongEntityAvatars(snap: PageSnapshot): Finding[] {
  const out: Finding[] = [];
  if (snap.activeEntityId == null) return out;
  for (const a of snap.avatars) {
    // Only meaningful for the page's primary/active avatar slots that claim to
    // BE the active entity but resolve a different id.
    const claimed = a.petdxEntityId ?? a.entityId;
    if (claimed == null) continue;
    if (a.isBoundPartner && a.entityId === snap.activeEntityId && claimed !== snap.activeEntityId) {
      out.push(
        mkFinding(
          snap,
          "wrong_entity_avatar",
          `avatar[data-entity-id="${a.entityId}"]`,
          `Active entity #${snap.activeEntityId} slot renders avatar for entity #${claimed}.`,
        ),
      );
    }
  }
  return out;
}

/**
 * C4 — broken image. <img> whose naturalWidth is 0 (failed to decode), whose
 * src is empty, or which the onerror handler hid (chat.html sets display:none).
 */
export function detectBrokenImages(snap: PageSnapshot): Finding[] {
  const out: Finding[] = [];
  for (const img of snap.images) {
    const emptySrc = !img.src || img.src.trim() === "";
    const failed = img.naturalWidth === 0;
    if (emptySrc || failed || img.hiddenByError) {
      const reason = emptySrc
        ? "empty src"
        : failed
          ? "naturalWidth=0 (failed to load)"
          : "hidden by onerror handler";
      out.push(
        mkFinding(
          snap,
          "broken_image",
          img.selector,
          `Broken image ${img.selector}: ${reason}` +
            (img.src ? ` (src="${img.src.slice(0, 120)}")` : ""),
        ),
      );
    }
  }
  return out;
}

/** C5 — text overflow: content spills out of its container box. */
export function detectTextOverflow(snap: PageSnapshot): Finding[] {
  const out: Finding[] = [];
  for (const t of snap.textBoxes) {
    if (t.overflows) {
      out.push(
        mkFinding(
          snap,
          "text_overflow",
          t.selector,
          `Text in ${t.selector} overflows its container box.`,
        ),
      );
    }
  }
  return out;
}

/**
 * C6 — empty placeholder masking a load failure. An empty-state region that is
 * visible AND whose data-load errored: the UI shows "nothing here" when it
 * should show an error, hiding the failure from the user (and from API crons).
 */
export function detectEmptyPlaceholders(snap: PageSnapshot): Finding[] {
  const out: Finding[] = [];
  for (const e of snap.emptyStates) {
    if (e.isEmpty && e.loadErrored) {
      out.push(
        mkFinding(
          snap,
          "empty_placeholder",
          e.selector,
          `Empty placeholder ${e.selector} is shown while its data load errored — ` +
            `a silent failure an API health check cannot see.`,
        ),
      );
    }
  }
  return out;
}

/** Run all six detectors over one page snapshot. */
export function detectAll(snap: PageSnapshot): Finding[] {
  return [
    ...detectFallbackAvatars(snap),
    ...detectHorizontalOverflow(snap),
    ...detectWrongEntityAvatars(snap),
    ...detectBrokenImages(snap),
    ...detectTextOverflow(snap),
    ...detectEmptyPlaceholders(snap),
  ];
}
