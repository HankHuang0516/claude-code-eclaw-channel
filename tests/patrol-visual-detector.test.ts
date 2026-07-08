/**
 * Visual/UX patrol — detector unit tests.
 *
 * These are the closeable, CI-gated deliverable: they prove the detector
 * distinguishes a HEALTHY page (drawn canvas avatar) from REGRESSED pages
 * (fallback emoji, blank canvas, broken img, overflow, wrong entity, empty
 * placeholder) using fixture snapshots — no browser, no live auth.
 */

import { describe, expect, test } from "bun:test";
import {
  buildSignature,
  detectAll,
  detectBrokenImages,
  detectEmptyPlaceholders,
  detectFallbackAvatars,
  detectHorizontalOverflow,
  detectTextOverflow,
  detectWrongEntityAvatars,
  viewportBucket,
  type AvatarSnapshot,
  type PageSnapshot,
  type Viewport,
} from "../patrol/visual-detector.ts";

const MOBILE: Viewport = { width: 390, height: 844 };
const DESKTOP: Viewport = { width: 1280, height: 800 };

/** A minimal healthy snapshot: bound entity #2 has a DRAWN canvas avatar. */
function healthySnapshot(): PageSnapshot {
  return {
    surface: "card-holder",
    url: "https://eclawbot.com/portal/card-holder.html",
    viewport: MOBILE,
    activeEntityId: 2,
    documentScrollWidth: 390,
    documentClientWidth: 390,
    overflowingSelectors: [],
    avatars: [
      {
        entityId: 2,
        kind: "canvas",
        petdxEntityId: 2,
        canvasDrawn: true,
        imgNaturalWidth: null,
        imgSrc: null,
        emojiText: null,
        isBoundPartner: true,
      },
    ],
    images: [{ src: "https://r2/photo.webp", naturalWidth: 200, hiddenByError: false, selector: "img.chat-photo" }],
    textBoxes: [{ selector: "div.card-title", overflows: false }],
    emptyStates: [{ selector: "div.empty-inbox", isEmpty: false, loadErrored: false }],
  };
}

function boundEmoji(entityId: number, emojiText: string): AvatarSnapshot {
  return {
    entityId,
    kind: "emoji",
    petdxEntityId: null,
    canvasDrawn: false,
    imgNaturalWidth: null,
    imgSrc: null,
    emojiText,
    isBoundPartner: true,
  };
}

describe("healthy page → zero findings", () => {
  test("a fully healthy card-holder snapshot produces no findings", () => {
    expect(detectAll(healthySnapshot())).toHaveLength(0);
  });
});

describe("C1 fallback avatar", () => {
  test("bound entity showing emoji fallback is flagged", () => {
    const snap = healthySnapshot();
    snap.avatars = [boundEmoji(2, "\u{1F99E}")]; // 🦞 default fallback
    const findings = detectFallbackAvatars(snap);
    expect(findings).toHaveLength(1);
    expect(findings[0].defectClass).toBe("fallback_avatar");
    expect(findings[0].evidence).toContain("#2");
    expect(findings[0].evidence).toContain("default");
  });

  test("bound entity with a BLANK canvas (no pixels) is flagged", () => {
    const snap = healthySnapshot();
    snap.avatars[0].canvasDrawn = false;
    const findings = detectFallbackAvatars(snap);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("blank");
  });

  test("a NON-bound entity showing emoji is legit — NOT flagged", () => {
    const snap = healthySnapshot();
    snap.avatars = [{ ...boundEmoji(9, "🐱"), isBoundPartner: false }];
    expect(detectFallbackAvatars(snap)).toHaveLength(0);
  });

  test("bound entity with a DRAWN canvas is healthy — NOT flagged", () => {
    expect(detectFallbackAvatars(healthySnapshot())).toHaveLength(0);
  });
});

describe("C2 horizontal overflow", () => {
  test("document scrollWidth exceeding clientWidth is flagged", () => {
    const snap = healthySnapshot();
    snap.documentScrollWidth = 520;
    snap.documentClientWidth = 390;
    const findings = detectHorizontalOverflow(snap);
    expect(findings).toHaveLength(1);
    expect(findings[0].defectClass).toBe("horizontal_overflow");
  });

  test("an element bleeding past the viewport edge is flagged", () => {
    const snap = healthySnapshot();
    snap.overflowingSelectors = ["div.sidebar"];
    expect(detectHorizontalOverflow(snap)[0].selector).toBe("div.sidebar");
  });

  test("a 1px rounding difference does NOT flag", () => {
    const snap = healthySnapshot();
    snap.documentScrollWidth = 391;
    snap.documentClientWidth = 390;
    expect(detectHorizontalOverflow(snap)).toHaveLength(0);
  });
});

describe("C3 wrong entity avatar", () => {
  test("active-entity slot rendering another entity's avatar is flagged", () => {
    const snap = healthySnapshot();
    snap.activeEntityId = 2;
    snap.avatars[0].petdxEntityId = 5; // slot says entity 2 but canvas is entity 5
    const findings = detectWrongEntityAvatars(snap);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("#5");
  });

  test("matching entity id is healthy", () => {
    expect(detectWrongEntityAvatars(healthySnapshot())).toHaveLength(0);
  });
});

describe("C4 broken image", () => {
  test("img with naturalWidth 0 is flagged", () => {
    const snap = healthySnapshot();
    snap.images = [{ src: "https://r2/x.webp", naturalWidth: 0, hiddenByError: false, selector: "img.chat-photo" }];
    const findings = detectBrokenImages(snap);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("naturalWidth=0");
  });

  test("img with empty src is flagged", () => {
    const snap = healthySnapshot();
    snap.images = [{ src: "", naturalWidth: 100, hiddenByError: false, selector: "img.avatar" }];
    expect(detectBrokenImages(snap)[0].evidence).toContain("empty src");
  });

  test("img hidden by onerror handler is flagged", () => {
    const snap = healthySnapshot();
    snap.images = [{ src: "https://r2/x.webp", naturalWidth: 0, hiddenByError: true, selector: "img.chat-photo" }];
    expect(detectBrokenImages(snap)).toHaveLength(1);
  });

  test("a loaded image is healthy", () => {
    expect(detectBrokenImages(healthySnapshot())).toHaveLength(0);
  });
});

describe("C5 text overflow", () => {
  test("overflowing text box is flagged", () => {
    const snap = healthySnapshot();
    snap.textBoxes = [{ selector: "div.card-title", overflows: true }];
    expect(detectTextOverflow(snap)).toHaveLength(1);
  });
});

describe("C6 empty placeholder masking a load failure", () => {
  test("empty + load-errored placeholder is flagged", () => {
    const snap = healthySnapshot();
    snap.emptyStates = [{ selector: "div.empty-inbox", isEmpty: true, loadErrored: true }];
    expect(detectEmptyPlaceholders(snap)).toHaveLength(1);
  });

  test("legitimately empty (no error) is NOT flagged", () => {
    const snap = healthySnapshot();
    snap.emptyStates = [{ selector: "div.empty-inbox", isEmpty: true, loadErrored: false }];
    expect(detectEmptyPlaceholders(snap)).toHaveLength(0);
  });
});

describe("signatures", () => {
  test("viewport buckets by mobile/desktop, not exact px", () => {
    expect(viewportBucket({ width: 390, height: 844 })).toBe("mobile");
    expect(viewportBucket({ width: 412, height: 892 })).toBe("mobile");
    expect(viewportBucket({ width: 1280, height: 800 })).toBe("desktop");
  });

  test("same defect at 390 and 412 share a signature (no dup cards)", () => {
    const s390 = buildSignature("card-holder", { width: 390, height: 844 }, "fallback_avatar", "sel");
    const s412 = buildSignature("card-holder", { width: 412, height: 892 }, "fallback_avatar", "sel");
    expect(s390).toBe(s412);
  });

  test("different viewport class → different signature", () => {
    const m = buildSignature("card-holder", MOBILE, "fallback_avatar", "sel");
    const d = buildSignature("card-holder", DESKTOP, "fallback_avatar", "sel");
    expect(m).not.toBe(d);
  });
});
