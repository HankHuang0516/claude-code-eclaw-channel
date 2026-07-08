/**
 * Visual/UX patrol — card-opener unit tests.
 *
 * Verifies the pure request builders and the three-step open flow (create card
 * -> upload screenshot -> attach fileId) using an injected fake fetch, so no
 * network is touched. Also proves the card body carries the dedup signature.
 */

import { describe, expect, test } from "bun:test";
import {
  buildAttachFileRequest,
  buildCreateCardRequest,
  buildScreenshotUpload,
  findingToCardDraft,
  openCardForFinding,
  type FetchLike,
  type PatrolAuth,
} from "../patrol/card-opener.ts";
import { SIGNATURE_MARKER } from "../patrol/dedup.ts";
import { buildSignature, type Finding, type Viewport } from "../patrol/visual-detector.ts";

const MOBILE: Viewport = { width: 390, height: 844 };
const AUTH: PatrolAuth = {
  apiBase: "https://eclawbot.test",
  deviceId: "dev-uuid",
  botSecret: "botsecret",
  entityId: 2,
};

function finding(): Finding {
  return {
    surface: "card-holder",
    viewport: MOBILE,
    defectClass: "fallback_avatar",
    selector: "entity-avatar-emoji[data-entity-id=2]",
    evidence: "Bound entity #2 rendered emoji fallback",
    signature: buildSignature("card-holder", MOBILE, "fallback_avatar", "sel"),
  };
}

describe("findingToCardDraft", () => {
  test("draft has stable [Auto][視覺巡檢] title + embedded signature marker", () => {
    const draft = findingToCardDraft(finding());
    expect(draft.title).toContain("[Auto][視覺巡檢]");
    expect(draft.title).toContain("card-holder");
    expect(draft.description).toContain(SIGNATURE_MARKER);
    expect(draft.description).toContain(finding().signature);
    expect(draft.assignedBots).toEqual([2]);
  });
});

describe("request builders", () => {
  test("create-card request targets /api/mission/card with botSecret body", () => {
    const req = buildCreateCardRequest(AUTH, findingToCardDraft(finding()));
    expect(req.url).toBe("https://eclawbot.test/api/mission/card");
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ deviceId: "dev-uuid", entityId: 2, botSecret: "botsecret" });
    expect(body.title).toContain("視覺巡檢");
  });

  test("attach-file request targets /card/:id/file with fileId", () => {
    const req = buildAttachFileRequest(AUTH, "card_abc", "file_123");
    expect(req.url).toBe("https://eclawbot.test/api/mission/card/card_abc/file");
    expect(JSON.parse(req.body)).toMatchObject({ fileId: "file_123", deviceId: "dev-uuid" });
  });

  test("screenshot upload is multipart with file + creds", () => {
    const { url, form } = buildScreenshotUpload(AUTH, "shot.png", new Uint8Array([1, 2, 3]));
    expect(url).toBe("https://eclawbot.test/api/files/upload");
    expect(form.get("deviceId")).toBe("dev-uuid");
    expect(form.get("botSecret")).toBe("botsecret");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });
});

describe("openCardForFinding — three-step flow with fake fetch", () => {
  test("creates card, uploads screenshot, attaches fileId", async () => {
    const calls: string[] = [];
    const fakeFetch: FetchLike = async (url) => {
      calls.push(url);
      if (url.endsWith("/api/mission/card")) {
        return { ok: true, status: 200, json: async () => ({ card: { id: "card_new" } }) };
      }
      if (url.endsWith("/api/files/upload")) {
        return { ok: true, status: 200, json: async () => ({ fileId: "file_xyz" }) };
      }
      if (url.endsWith("/card/card_new/file")) {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const result = await openCardForFinding(AUTH, finding(), new Uint8Array([9, 9]), fakeFetch);
    expect(result.cardId).toBe("card_new");
    expect(result.screenshotAttached).toBe(true);
    expect(calls).toEqual([
      "https://eclawbot.test/api/mission/card",
      "https://eclawbot.test/api/files/upload",
      "https://eclawbot.test/api/mission/card/card_new/file",
    ]);
  });

  test("no screenshot → card created, nothing uploaded", async () => {
    const calls: string[] = [];
    const fakeFetch: FetchLike = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ card: { id: "card_x" } }) };
    };
    const result = await openCardForFinding(AUTH, finding(), null, fakeFetch);
    expect(result.cardId).toBe("card_x");
    expect(result.screenshotAttached).toBe(false);
    expect(calls).toEqual(["https://eclawbot.test/api/mission/card"]);
  });

  test("card create failure returns an error, does not throw", async () => {
    const fakeFetch: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const result = await openCardForFinding(AUTH, finding(), null, fakeFetch);
    expect(result.cardId).toBeNull();
    expect(result.error).toContain("HTTP 500");
  });
});
